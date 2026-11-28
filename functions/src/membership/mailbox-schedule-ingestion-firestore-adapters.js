const ID = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_BATCH = 100;
const DEFAULT_POLL_INTERVAL_MS = 5 * 60 * 1000;

function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function validCursor(value) { return value === null || (typeof value === "string" && value.length <= 2048); }

/**
 * Trusted Firestore adapters for the provider-neutral mailbox polling worker.
 * Polling state is deliberately separate from immutable mailbox connection
 * metadata. Lease acquisition/release is delegated to the fenced lease service.
 */
export function createMailboxScheduleIngestionFirestoreAdapters({
  db, leaseService, connectionRefForConnection, leaseRefForConnection,
  now = () => Date.now(), pollIntervalMs = DEFAULT_POLL_INTERVAL_MS
}) {
  if (!db || typeof db.collection !== "function" || typeof db.doc !== "function" ||
      typeof db.runTransaction !== "function" ||
      !leaseService || typeof leaseService.acquire !== "function" || typeof leaseService.release !== "function" ||
      typeof connectionRefForConnection !== "function" || typeof leaseRefForConnection !== "function") {
    throw new TypeError("Trusted Firestore mailbox worker dependencies are required.");
  }
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 1000 || pollIntervalMs > 24 * 60 * 60 * 1000) {
    throw new TypeError("Mailbox polling interval is invalid.");
  }
  function scope(accountId, connectionId) {
    if (!ID.test(accountId ?? "") || !ID.test(connectionId ?? "")) fail("invalid-argument", "Mailbox polling scope is invalid.");
    const pollingRef = db.doc(`accounts/${accountId}/mailboxPolling/${connectionId}`);
    const connectionRef = connectionRefForConnection({ accountId, connectionId });
    const leaseRef = leaseRefForConnection({ accountId, connectionId });
    if (!pollingRef || !connectionRef || !leaseRef) throw new TypeError("Mailbox worker document references are invalid.");
    return { pollingRef, connectionRef, leaseRef };
  }
  function readNow() {
    const value = now();
    if (!Number.isSafeInteger(value) || value < 1) fail("unavailable", "Mailbox worker clock is invalid.");
    return value;
  }
  return Object.freeze({
    async listDueConnections({ accountId, limit = 20 }) {
      if (!ID.test(accountId ?? "") || !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_BATCH) {
        fail("invalid-argument", "Mailbox due query is invalid.");
      }
      const timestamp = readNow();
      const query = db.collection(`accounts/${accountId}/mailboxPolling`)
        .where("nextPollAt", "<=", timestamp).orderBy("nextPollAt", "asc").limit(limit);
      const snapshot = await query.get();
      if (!snapshot || !Array.isArray(snapshot.docs) || snapshot.docs.length > limit) {
        fail("unavailable", "Mailbox due query returned an invalid result.");
      }
      return snapshot.docs.map(doc => {
        const value = doc.data();
        if (!doc.id || !ID.test(doc.id) || !value || value.accountId !== accountId ||
            value.connectionId !== doc.id || !validCursor(value.cursor) ||
            !Number.isSafeInteger(value.nextPollAt) || value.nextPollAt < 1) {
          fail("failed-precondition", "Mailbox polling state is malformed.");
        }
        return Object.freeze({ accountId, connectionId: doc.id, cursor: value.cursor, nextPollAt: value.nextPollAt });
      });
    },
    async loadConnection({ accountId, connectionId }) {
      const { connectionRef } = scope(accountId, connectionId);
      const snapshot = await connectionRef.get();
      if (!snapshot?.exists) return null;
      const value = snapshot.data();
      return value?.accountId === accountId && value?.connectionId === connectionId ? value : null;
    },
    async acquireLease({ accountId, connectionId }) {
      scope(accountId, connectionId);
      try {
        const lease = await leaseService.acquire({ accountId, connectionId, ttlMs: 120_000 });
        return Object.freeze({ ...lease, acquired: true });
      } catch (error) {
        if (error?.code === "lease-held" || error?.code === "failed-precondition") {
          return Object.freeze({ acquired: false });
        }
        throw error;
      }
    },
    async releaseLease({ accountId, connectionId, lease }) {
      return leaseService.release({ accountId, connectionId, lease });
    },
    async saveCheckpoint({ accountId, connectionId, expectedCursor, nextCursor, timestamp }) {
      const { pollingRef, leaseRef } = scope(accountId, connectionId);
      if (!validCursor(expectedCursor) || typeof nextCursor !== "string" || nextCursor.length > 2048 ||
          !Number.isSafeInteger(timestamp) || timestamp < 1 ||
          !Number.isSafeInteger(timestamp + pollIntervalMs)) {
        fail("invalid-argument", "Mailbox checkpoint is invalid.");
      }
      try {
        await db.runTransaction(async tx => {
          const [pollingSnapshot, leaseSnapshot] = await Promise.all([tx.get(pollingRef), tx.get(leaseRef)]);
          if (!pollingSnapshot?.exists || !leaseSnapshot?.exists) fail("failed-precondition", "Mailbox checkpoint state is missing.");
          const polling = pollingSnapshot.data();
          const lease = leaseSnapshot.data();
          if (!polling || polling.accountId !== accountId || polling.connectionId !== connectionId ||
              !validCursor(polling.cursor) || polling.cursor !== expectedCursor ||
              !Number.isSafeInteger(polling.nextPollAt) || polling.nextPollAt < 1) {
            fail("conflict", "Mailbox cursor changed; stale worker cannot advance it.");
          }
          if (!lease || lease.revocationPending === true ||
              (lease.revocationPending !== undefined && typeof lease.revocationPending !== "boolean") ||
              typeof lease.ownerId !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(lease.ownerId) ||
              !Number.isSafeInteger(lease.fencingToken) || lease.fencingToken < 1 ||
              !Number.isSafeInteger(lease.expiresAt) || lease.expiresAt <= timestamp) {
            fail("failed-precondition", "Mailbox checkpoint requires a live, non-revoked lease.");
          }
          tx.update(pollingRef, { cursor: nextCursor, nextPollAt: timestamp + pollIntervalMs, updatedAt: timestamp });
        });
      } catch (error) {
        if (["invalid-argument", "failed-precondition", "conflict"].includes(error?.code)) throw error;
        fail("unavailable", "Mailbox checkpoint could not be saved.");
      }
    }
  });
}
