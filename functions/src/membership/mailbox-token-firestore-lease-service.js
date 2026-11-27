import { randomUUID } from "node:crypto";

const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_TTL_MS = 5 * 60 * 1000;
function leaseError(code, message) { const error = new Error(message); error.code = code; return error; }

export function createMailboxTokenFirestoreLeaseService({
  firestore, leaseRefForConnection, now = () => Date.now(), createOwnerId = randomUUID
}) {
  if (!firestore || typeof firestore.runTransaction !== "function" ||
      typeof leaseRefForConnection !== "function") {
    throw new TypeError("Firestore lease dependencies are required.");
  }

  function getRef(accountId, connectionId) {
    if (typeof accountId !== "string" || !ID_RE.test(accountId) ||
        typeof connectionId !== "string" || !ID_RE.test(connectionId)) {
      throw leaseError("invalid-argument", "Mailbox lease scope is invalid.");
    }
    const ref = leaseRefForConnection({accountId, connectionId});
    if (!ref || typeof ref.get !== "function") throw new TypeError("Trusted lease reference is invalid.");
    return ref;
  }

  function readClock() {
    const value = now();
    if (!Number.isSafeInteger(value) || value < 0) {
      throw leaseError("unavailable", "Mailbox lease clock is invalid.");
    }
    return value;
  }

  function validateTtl(ttlMs) {
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1_000 || ttlMs > MAX_TTL_MS) {
      throw leaseError("invalid-argument", "Mailbox lease duration is invalid.");
    }
  }

  async function acquire({accountId, connectionId, ttlMs = 60_000}) {
    validateTtl(ttlMs);
    const ref = getRef(accountId, connectionId);
    const ownerId = createOwnerId();
    if (typeof ownerId !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(ownerId)) {
      throw new Error("Mailbox lease owner generation failed.");
    }
    const acquiredAt = readClock();
    if (!Number.isSafeInteger(acquiredAt + ttlMs)) {
      throw leaseError("unavailable", "Mailbox lease expiry is invalid.");
    }
    let lease;
    try {
      await firestore.runTransaction(async transaction => {
        const snapshot = await transaction.get(ref);
        const current = snapshot?.data?.() || {};
        if (snapshot?.exists && (!Number.isSafeInteger(current.fencingToken) ||
            current.fencingToken < 0 || !Number.isSafeInteger(current.expiresAt))) {
          throw leaseError("unavailable", "Mailbox lease record is malformed.");
        }
        if (snapshot?.exists && current.revocationPending === true) {
          throw leaseError("failed-precondition", "Mailbox connection is being revoked.");
        }
        if (snapshot?.exists && current.expiresAt > acquiredAt) {
          throw leaseError("lease-held", "Mailbox refresh is already in progress.");
        }
        const previousFence = snapshot?.exists ? current.fencingToken : 0;
        if (previousFence >= Number.MAX_SAFE_INTEGER) {
          throw leaseError("unavailable", "Mailbox lease fencing limit reached.");
        }
        lease = Object.freeze({
          ownerId, fencingToken: previousFence + 1,
          acquiredAt, expiresAt: acquiredAt + ttlMs
        });
        if (snapshot?.exists) transaction.update(ref, lease);
        else transaction.create(ref, lease);
      });
    } catch (error) {
      if (["lease-held", "failed-precondition", "invalid-argument", "unavailable"].includes(error?.code)) throw error;
      throw leaseError("unavailable", "Mailbox lease acquisition failed.");
    }
    return lease;
  }

  async function renew({accountId, connectionId, lease, ttlMs = 60_000}) {
    if (!lease || typeof lease.ownerId !== "string" || !Number.isSafeInteger(lease.fencingToken)) {
      throw leaseError("invalid-argument", "Mailbox lease renewal is invalid.");
    }
    validateTtl(ttlMs);
    const ref = getRef(accountId, connectionId);
    const renewedAt = readClock();
    if (!Number.isSafeInteger(renewedAt + ttlMs)) {
      throw leaseError("unavailable", "Mailbox lease expiry is invalid.");
    }
    const next = Object.freeze({...lease, expiresAt: renewedAt + ttlMs});
    try {
      await firestore.runTransaction(async transaction => {
        const snapshot = await transaction.get(ref);
        const current = snapshot?.data?.() || {};
        if (!snapshot?.exists || current.revocationPending === true ||
            current.ownerId !== lease.ownerId ||
            current.fencingToken !== lease.fencingToken ||
            !Number.isSafeInteger(current.expiresAt) || current.expiresAt <= renewedAt) {
          throw leaseError("lease-lost", "Mailbox lease is no longer owned.");
        }
        transaction.update(ref, {expiresAt: next.expiresAt});
      });
      return next;
    } catch (error) {
      if (error?.code === "lease-lost") throw error;
      throw leaseError("unavailable", "Mailbox lease renewal failed.");
    }
  }

  async function disable({accountId, connectionId}) {
    const ref = getRef(accountId, connectionId);
    const disabledAt = readClock();
    try {
      await firestore.runTransaction(async transaction => {
        const snapshot = await transaction.get(ref);
        const current = snapshot?.data?.() || {};
        if (snapshot?.exists && (!Number.isSafeInteger(current.fencingToken) ||
            current.fencingToken < 0 || !Number.isSafeInteger(current.expiresAt))) {
          throw leaseError("unavailable", "Mailbox lease record is malformed.");
        }
        if (snapshot?.exists && current.revocationPending === true) return;
        const disabled = {
          ownerId: current.ownerId ?? null,
          fencingToken: snapshot?.exists ? current.fencingToken : 0,
          acquiredAt: current.acquiredAt ?? disabledAt,
          expiresAt: current.expiresAt ?? 0,
          revocationPending: true,
          revocationRequestedAt: disabledAt
        };
        if (snapshot?.exists) transaction.update(ref, disabled);
        else transaction.create(ref, disabled);
      });
      return Object.freeze({status: "revocation_pending"});
    } catch (error) {
      if (error?.code === "unavailable") throw error;
      throw leaseError("unavailable", "Mailbox refresh disable failed.");
    }
  }

  async function release({accountId, connectionId, lease}) {
    if (!lease || typeof lease.ownerId !== "string" || !Number.isSafeInteger(lease.fencingToken)) return false;
    const ref = getRef(accountId, connectionId);
    try {
      return await firestore.runTransaction(async transaction => {
        const snapshot = await transaction.get(ref);
        const current = snapshot?.data?.() || {};
        if (!snapshot?.exists || current.ownerId !== lease.ownerId ||
            current.fencingToken !== lease.fencingToken) return false;
        transaction.update(ref, {ownerId: null, expiresAt: 0});
        return true;
      });
    } catch {
      throw leaseError("unavailable", "Mailbox lease release failed.");
    }
  }

  return Object.freeze({acquire, renew, release, disable});
}
