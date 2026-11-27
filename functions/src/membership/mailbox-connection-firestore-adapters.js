import { randomUUID } from "node:crypto";

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STATUSES = new Set(["active", "revocation_pending", "revoked"]);
const MODES = new Set(["personal", "shared"]);
const PROVIDERS = new Set(["imap", "gmail_api", "microsoft_graph", "custom_api"]);
const CONNECTION_KEYS = new Set([
  "accountId", "connectionId", "provider", "mode", "status", "mailboxAddress",
  "allowedSenders", "ownerUid", "ownerEmployeeId", "createdByUid", "createdAt",
  "updatedAt", "credentialSecretRef", "consent", "revokedAt"
]);

function invalid(message) {
  const error = new Error(message);
  error.code = "invalid-argument";
  throw error;
}
function validId(value) { return typeof value === "string" && ID.test(value); }
function normalizedEmail(value) {
  return typeof value === "string" && value.length <= 254 &&
    value === value.trim().toLowerCase() && EMAIL.test(value);
}
function validateConnection(accountId, connectionId, value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some(key => !CONNECTION_KEYS.has(key))) {
    invalid("Mailbox connection metadata contains unsupported fields.");
  }
  if (value.accountId !== accountId || value.connectionId !== connectionId ||
      !PROVIDERS.has(value.provider) || !MODES.has(value.mode) ||
      !STATUSES.has(value.status) || !normalizedEmail(value.mailboxAddress) ||
      !validId(value.createdByUid) || !Number.isSafeInteger(value.createdAt) ||
      !Number.isSafeInteger(value.updatedAt) || value.createdAt < 1 ||
      value.updatedAt < value.createdAt ||
      (value.status === "revoked"
        ? value.credentialSecretRef !== null
        : (typeof value.credentialSecretRef !== "string" ||
           value.credentialSecretRef.length < 1 || value.credentialSecretRef.length > 512)) ||
      !Array.isArray(value.allowedSenders) || value.allowedSenders.length < 1 ||
      value.allowedSenders.length > 30 ||
      value.allowedSenders.some(item => !normalizedEmail(item)) ||
      new Set(value.allowedSenders).size !== value.allowedSenders.length) {
    invalid("Mailbox connection metadata is malformed.");
  }
  if (value.mode === "personal" &&
      (!validId(value.ownerUid) || !validId(value.ownerEmployeeId) ||
       value.createdByUid !== value.ownerUid)) {
    invalid("Personal mailbox ownership metadata is invalid.");
  }
  if (value.mode === "shared" &&
      (value.ownerUid !== null || value.ownerEmployeeId !== null)) {
    invalid("Shared mailbox cannot carry a personal Employee owner.");
  }
  if (!value.consent || typeof value.consent !== "object" || Array.isArray(value.consent) ||
      Object.keys(value.consent).some(key => !["grantedByUid", "grantedAt", "version"].includes(key)) ||
      Object.keys(value.consent).length !== 3 ||
      value.consent.grantedByUid !== value.createdByUid ||
      !Number.isSafeInteger(value.consent.grantedAt) || value.consent.grantedAt < 1 ||
      value.consent.grantedAt !== value.createdAt || value.consent.version !== 1) {
    invalid("Mailbox consent metadata is invalid.");
  }
  if (value.status === "revoked" &&
      (!Number.isSafeInteger(value.revokedAt) || value.revokedAt < value.updatedAt || value.credentialSecretRef !== null)) {
    invalid("Revoked mailbox must not retain a credential reference.");
  }
  if (value.status !== "revoked" && value.revokedAt !== undefined) {
    invalid("Only revoked mailboxes may have a revokedAt timestamp.");
  }
}
function sameImmutableFields(before, after) {
  return ["accountId", "connectionId", "provider", "mode", "mailboxAddress",
    "allowedSenders", "ownerUid", "ownerEmployeeId", "createdByUid", "createdAt",
    "consent"].every(key =>
      JSON.stringify(before[key]) === JSON.stringify(after[key]));
}
function allowedTransition(before, after) {
  if (!before) return after.status === "active";
  if (!sameImmutableFields(before, after)) return false;
  if (before.status === "active") return after.status === "revocation_pending" &&
    after.credentialSecretRef === before.credentialSecretRef;
  if (before.status === "revocation_pending") {
    return (after.status === "revocation_pending" &&
        after.credentialSecretRef === before.credentialSecretRef) ||
      (after.status === "revoked" && before.credentialSecretRef !== null &&
        after.credentialSecretRef === null);
  }
  return after.status === "revoked";
}

/**
 * Admin-SDK persistence adapter. Call only from trusted server code: Firestore
 * Rules deny client access to this canonical subtree. Credential references
 * are retained only in server-readable metadata, never returned to clients.
 */
export function createMailboxConnectionFirestoreAdapters(db) {
  if (!db || typeof db.doc !== "function" || typeof db.runTransaction !== "function") {
    throw new TypeError("A trusted Firestore Admin database is required.");
  }
  return Object.freeze({
    async saveConnection({ accountId, connectionId, connection }) {
      if (!validId(accountId) || !validId(connectionId)) invalid("Invalid mailbox connection path.");
      validateConnection(accountId, connectionId, connection);
      const ref = db.doc(`accounts/${accountId}/mailboxConnections/${connectionId}`);
      await db.runTransaction(async tx => {
        const snapshot = await tx.get(ref);
        const previous = snapshot.exists ? snapshot.data() : null;
        if (!allowedTransition(previous, connection)) {
          const error = new Error("Mailbox connection state transition is not permitted.");
          error.code = "failed-precondition";
          throw error;
        }
        tx.set(ref, connection);
      });
    },

    async loadConnection({ accountId, connectionId }) {
      if (!validId(accountId) || !validId(connectionId)) return null;
      const snapshot = await db.doc(
        `accounts/${accountId}/mailboxConnections/${connectionId}`
      ).get();
      if (!snapshot.exists) return null;
      const connection = snapshot.data();
      try { validateConnection(accountId, connectionId, connection); }
      catch { return null; }
      return connection;
    },

    async recordSecretCleanup({ accountId, connectionId, secretRef, reason, timestamp = Date.now() }) {
      if (!validId(accountId) || !validId(connectionId) ||
          typeof secretRef !== "string" || secretRef.length < 1 || secretRef.length > 2048 ||
          typeof reason !== "string" || !/^[a-z0-9_-]{1,64}$/.test(reason) ||
          !Number.isSafeInteger(timestamp) || timestamp < 1) {
        invalid("Mailbox secret cleanup record is malformed.");
      }
      const ref = db.doc(`accounts/${accountId}/mailboxCredentialCleanup/${connectionId}`);
      await db.runTransaction(async tx => {
        const snapshot = await tx.get(ref);
        if (snapshot.exists) {
          const previous = snapshot.data();
          if (previous.accountId !== accountId || previous.connectionId !== connectionId ||
              previous.secretRef !== secretRef) {
            const error = new Error("A conflicting cleanup record already exists.");
            error.code = "failed-precondition";
            throw error;
          }
          // Re-recording the same cleanup request is idempotent. Only a
          // confirmed worker failure may advance the retry attempt counter.
          return;
        }
        tx.set(ref, {
          accountId, connectionId, secretRef, reason, status: "pending",
          attempts: 1, nextAttemptAt: null, lastErrorCode: null,
          createdAt: timestamp, updatedAt: timestamp
        });
      });
    },

    async listPendingSecretCleanup({ accountId, limit = 50 }) {
      if (!validId(accountId) || !Number.isInteger(limit) || limit < 1 || limit > 100) {
        invalid("Mailbox cleanup query is malformed.");
      }
      if (typeof db.collection !== "function") {
        const error = new Error("Firestore collection queries are unavailable.");
        error.code = "failed-precondition";
        throw error;
      }
      const snapshot = await db.collection(`accounts/${accountId}/mailboxCredentialCleanup`)
        .where("status", "==", "pending").orderBy("createdAt", "asc").limit(limit).get();
      return snapshot.docs.map(doc => {
        const value = doc.data();
        if (!value || value.accountId !== accountId ||
            typeof value.connectionId !== "string" || !validId(value.connectionId) ||
            typeof value.secretRef !== "string" || value.secretRef.length < 1 ||
            value.status !== "pending" || !Number.isSafeInteger(value.attempts) ||
            value.attempts < 1 ||
            !(value.nextAttemptAt === null ||
              (Number.isSafeInteger(value.nextAttemptAt) && value.nextAttemptAt >= 1)) ||
            !(value.lastErrorCode === null ||
              (typeof value.lastErrorCode === "string" &&
               /^[a-z0-9_-]{1,64}$/.test(value.lastErrorCode)))) return null;
        return value;
      }).filter(Boolean);
    },

    async loadSecretCleanup({ accountId, connectionId }) {
      if (!validId(accountId) || !validId(connectionId)) return null;
      const snapshot = await db.doc(
        `accounts/${accountId}/mailboxCredentialCleanup/${connectionId}`
      ).get();
      if (!snapshot.exists) return null;
      const value = snapshot.data();
      if (!value || value.accountId !== accountId || value.connectionId !== connectionId ||
          typeof value.secretRef !== "string" || value.secretRef.length < 1 ||
          !["pending", "complete"].includes(value.status) ||
          !Number.isSafeInteger(value.attempts) || value.attempts < 1) return null;
      return value;
    },

    async recordSecretCleanupFailure({ accountId, connectionId, secretRef, attempts, nextAttemptAt, lastErrorCode, timestamp = Date.now() }) {
      if (!validId(accountId) || !validId(connectionId) ||
          typeof secretRef !== "string" || secretRef.length < 1 || secretRef.length > 2048 ||
          !Number.isSafeInteger(attempts) || attempts < 2 || attempts > 1000 ||
          !(nextAttemptAt === null || (Number.isSafeInteger(nextAttemptAt) && nextAttemptAt >= timestamp)) ||
          typeof lastErrorCode !== "string" || !/^[a-z0-9_-]{1,64}$/.test(lastErrorCode) ||
          !Number.isSafeInteger(timestamp) || timestamp < 1) {
        invalid("Cleanup retry update is malformed.");
      }
      const ref = db.doc(`accounts/${accountId}/mailboxCredentialCleanup/${connectionId}`);
      await db.runTransaction(async tx => {
        const snapshot = await tx.get(ref);
        if (!snapshot.exists) {
          const error = new Error("Cleanup ticket not found.");
          error.code = "not-found";
          throw error;
        }
        const previous = snapshot.data();
        if (previous.accountId !== accountId || previous.connectionId !== connectionId ||
            previous.secretRef !== secretRef || previous.status !== "pending" ||
            attempts < previous.attempts) {
          const error = new Error("Cleanup retry ticket is stale or conflicting.");
          error.code = "failed-precondition";
          throw error;
        }
        tx.set(ref, { ...previous, attempts, nextAttemptAt, lastErrorCode, updatedAt: timestamp });
      });
    },

    async completeSecretCleanup({ accountId, connectionId, timestamp = Date.now() }) {
      if (!validId(accountId) || !validId(connectionId) ||
          !Number.isSafeInteger(timestamp) || timestamp < 1) {
        invalid("Mailbox secret cleanup completion is malformed.");
      }
      const ref = db.doc(`accounts/${accountId}/mailboxCredentialCleanup/${connectionId}`);
      await db.runTransaction(async tx => {
        const snapshot = await tx.get(ref);
        if (!snapshot.exists) {
          const error = new Error("Cleanup record not found.");
          error.code = "not-found";
          throw error;
        }
        const previous = snapshot.data();
        if (previous.accountId !== accountId || previous.connectionId !== connectionId ||
            typeof previous.secretRef !== "string") {
          const error = new Error("Cleanup record is malformed.");
          error.code = "failed-precondition";
          throw error;
        }
        if (previous.status === "complete") return;
        if (previous.status !== "pending") {
          const error = new Error("Cleanup record is not pending.");
          error.code = "failed-precondition";
          throw error;
        }
        tx.set(ref, { ...previous, status: "complete", completedAt: timestamp, updatedAt: timestamp });
      });
    },

    async writeAudit(event) {
      if (!event || !validId(event.accountId) || !validId(event.actorUid) ||
          !validId(event.connectionId) ||
          !["mailbox_connection_created", "mailbox_connection_revoked"].includes(event.action) ||
          !MODES.has(event.mode) || !PROVIDERS.has(event.provider) ||
          !Number.isSafeInteger(event.timestamp)) {
        invalid("Mailbox audit event is malformed.");
      }
      const ref = db.doc(
        `accounts/${event.accountId}/mailboxConnectionAudit/${randomUUID().replaceAll("-", "")}`
      );
      await ref.create({
        accountId: event.accountId,
        actorUid: event.actorUid,
        action: event.action,
        connectionId: event.connectionId,
        mode: event.mode,
        provider: event.provider,
        timestamp: event.timestamp
      });
    }
  });
}
