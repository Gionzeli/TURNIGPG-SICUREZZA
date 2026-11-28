import { createHash } from "node:crypto";

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
function validSecretRef(value, accountId, connectionId) {
  if (typeof value !== "string" || value.length > 512) return false;
  const match = /^mailbox\/([A-Za-z0-9_-]{1,128})\/([A-Za-z0-9_-]{1,128})\/([A-Za-z0-9_-]{16,128})$/.exec(value);
  return !!match && match[1] === accountId && match[2] === connectionId;
}
function normalizedEmail(value) {
  return typeof value === "string" && value.length <= 254 &&
    value === value.trim().toLowerCase() && EMAIL.test(value);
}
function validPendingCleanupState(value) {
  if (!Number.isSafeInteger(value.attempts) || value.attempts < 1 || value.attempts >= 12) return false;
  if (value.attempts === 1) {
    return (value.nextAttemptAt === null || value.nextAttemptAt === undefined) &&
      (value.lastErrorCode === null || value.lastErrorCode === undefined);
  }
  return Number.isSafeInteger(value.nextAttemptAt) && value.nextAttemptAt >= 1 &&
    typeof value.lastErrorCode === "string" &&
    /^[a-z0-9_-]{1,64}$/.test(value.lastErrorCode);
}
function validPendingAlertState(value) {
  const attempts = value.alertAttempts ?? 0;
  if (!Number.isSafeInteger(attempts) || attempts < 0 ||
      !Number.isSafeInteger(value.updatedAt) || value.updatedAt < 1) return false;
  const initial = attempts === 0;
  const retryScheduled = Number.isSafeInteger(value.alertNextAttemptAt) &&
    value.alertNextAttemptAt >= value.updatedAt &&
    typeof value.alertLastErrorCode === "string" &&
    /^[a-z0-9_-]{1,64}$/.test(value.alertLastErrorCode);
  const noTerminalTimestamp =
    (value.alertDeliveredAt === null || value.alertDeliveredAt === undefined) &&
    (value.alertResolvedAt === null || value.alertResolvedAt === undefined);
  if (!noTerminalTimestamp) return false;
  if (initial) {
    return (value.alertNextAttemptAt === null || value.alertNextAttemptAt === undefined) &&
      (value.alertLastErrorCode === null || value.alertLastErrorCode === undefined);
  }
  return retryScheduled;
}
function validExhaustedCleanupState(value) {
  if (!Number.isSafeInteger(value.attempts) || value.attempts < 12 ||
      value.nextAttemptAt !== null ||
      typeof value.lastErrorCode !== "string" ||
      !/^[a-z0-9_-]{1,64}$/.test(value.lastErrorCode)) return false;
  if (value.alertStatus === "pending") return validPendingAlertState(value) &&
    (value.alertDeliveredAt === null || value.alertDeliveredAt === undefined) &&
    (value.alertResolvedAt === null || value.alertResolvedAt === undefined);
  if (value.alertStatus === "delivered") {
    const attempts = value.alertAttempts ?? 0;
    return Number.isSafeInteger(attempts) && attempts >= 0 &&
      (value.alertNextAttemptAt === null || value.alertNextAttemptAt === undefined) &&
      (value.alertLastErrorCode === null || value.alertLastErrorCode === undefined ||
        (typeof value.alertLastErrorCode === "string" &&
         /^[a-z0-9_-]{1,64}$/.test(value.alertLastErrorCode))) &&
      Number.isSafeInteger(value.alertDeliveredAt) && value.alertDeliveredAt >= 1 &&
      (value.alertResolvedAt === null || value.alertResolvedAt === undefined);
  }
  if (value.alertStatus === "resolved") {
    const attempts = value.alertAttempts ?? 0;
    const validRetryHistory = Number.isSafeInteger(attempts) && attempts >= 0 &&
      (attempts === 0
        ? (value.alertLastErrorCode === null || value.alertLastErrorCode === undefined)
        : typeof value.alertLastErrorCode === "string" &&
          /^[a-z0-9_-]{1,64}$/.test(value.alertLastErrorCode));
    return validRetryHistory &&
      Number.isSafeInteger(value.alertResolvedAt) && value.alertResolvedAt >= 1 &&
      (value.alertNextAttemptAt === null || value.alertNextAttemptAt === undefined) &&
      (value.alertDeliveredAt === null || value.alertDeliveredAt === undefined);
  }
  return false;
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
        : !validSecretRef(value.credentialSecretRef, accountId, connectionId)) ||
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
  // Revoked is terminal. A stale concurrent finalization is handled as
  // an idempotent no-op by saveConnection; no later write may rewrite it.
  return false;
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
        if (previous?.status === "revoked" && connection.status === "revoked" &&
            sameImmutableFields(previous, connection) &&
            previous.credentialSecretRef === null && connection.credentialSecretRef === null) {
          // A concurrent retry may have loaded revocation_pending before
          // another request committed revoked. Preserve the first final state.
          return;
        }
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
          !validSecretRef(secretRef, accountId, connectionId) ||
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
        .where("status", "==", "pending").orderBy("nextAttemptAt", "asc").limit(limit).get();
      return snapshot.docs.map(doc => {
        const value = doc.data();
        if (!value || value.accountId !== accountId ||
            typeof value.connectionId !== "string" || !validId(value.connectionId) ||
            !validSecretRef(value.secretRef, accountId, value.connectionId) ||
            value.status !== "pending" || !validPendingCleanupState(value)) return null;
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
          !validSecretRef(value.secretRef, accountId, connectionId) ||
          !["pending", "exhausted", "complete"].includes(value.status) ||
          !Number.isSafeInteger(value.attempts) || value.attempts < 1 ||
          (value.status === "pending" && !validPendingCleanupState(value)) ||
          (value.status === "exhausted" && !validExhaustedCleanupState(value))) return null;
      return value;
    },

    async recordSecretCleanupFailure({ accountId, connectionId, secretRef, attempts, nextAttemptAt, lastErrorCode, timestamp = Date.now() }) {
      if (!validId(accountId) || !validId(connectionId) ||
          !validSecretRef(secretRef, accountId, connectionId) ||
          !Number.isSafeInteger(attempts) || attempts < 2 || attempts > 1000 ||
          !(attempts >= 12
            ? nextAttemptAt === null
            : Number.isSafeInteger(nextAttemptAt) && nextAttemptAt >= timestamp) ||
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
            !validPendingCleanupState(previous) || attempts !== previous.attempts + 1) {
          const error = new Error("Cleanup retry ticket is stale or conflicting.");
          error.code = "failed-precondition";
          throw error;
        }
        const exhausted = attempts >= 12;
        tx.set(ref, {
          ...previous,
          status: exhausted ? "exhausted" : "pending",
          attempts,
          nextAttemptAt: exhausted ? null : nextAttemptAt,
          lastErrorCode,
          alertStatus: exhausted ? "pending" : null,
          alertAttempts: exhausted ? 0 : null,
          alertNextAttemptAt: exhausted ? null : null,
          alertLastErrorCode: null,
          alertDeliveredAt: null,
          updatedAt: timestamp
        });
      });
    },

    async listPendingCleanupAlerts({ accountId, limit = 50 }) {
      if (!validId(accountId) || !Number.isInteger(limit) || limit < 1 || limit > 100) {
        invalid("Cleanup alert query is malformed.");
      }
      if (typeof db.collection !== "function") {
        const error = new Error("Firestore collection queries are unavailable.");
        error.code = "failed-precondition";
        throw error;
      }
      const snapshot = await db.collection("accounts/" + accountId + "/mailboxCredentialCleanup")
        .where("status", "==", "exhausted")
        .where("alertStatus", "==", "pending")
        .orderBy("alertNextAttemptAt", "asc").limit(limit).get();
      return snapshot.docs.map(doc => {
        const value = doc.data();
        if (!value || value.accountId !== accountId ||
            typeof value.connectionId !== "string" || !validId(value.connectionId) ||
            value.status !== "exhausted" || value.alertStatus !== "pending" ||
            !validExhaustedCleanupState(value)) return null;
        // Alert consumers receive a strict DTO; never expose secretRef,
        // provider metadata, or unrelated ticket fields to the notifier.
        return {
          accountId: value.accountId,
          connectionId: value.connectionId,
          status: value.status,
          alertStatus: value.alertStatus,
          attempts: value.attempts,
          lastErrorCode: value.lastErrorCode,
          alertAttempts: value.alertAttempts ?? 0,
          alertNextAttemptAt: value.alertNextAttemptAt ?? null,
          alertLastErrorCode: value.alertLastErrorCode ?? null
        };
      }).filter(Boolean);
    },

    async recordCleanupAlertFailure({ accountId, connectionId, attempts, nextAttemptAt, lastErrorCode, timestamp = Date.now() }) {
      if (!validId(accountId) || !validId(connectionId) ||
          !Number.isSafeInteger(attempts) || attempts < 1 ||
          !Number.isSafeInteger(nextAttemptAt) || nextAttemptAt < timestamp ||
          typeof lastErrorCode !== "string" || !/^[a-z0-9_-]{1,64}$/.test(lastErrorCode) ||
          !Number.isSafeInteger(timestamp) || timestamp < 1) {
        invalid("Cleanup alert retry update is malformed.");
      }
      const ref = db.doc("accounts/" + accountId + "/mailboxCredentialCleanup/" + connectionId);
      await db.runTransaction(async tx => {
        const snapshot = await tx.get(ref);
        if (!snapshot.exists) {
          const error = new Error("Cleanup alert ticket not found.");
          error.code = "not-found";
          throw error;
        }
        const previous = snapshot.data();
        if (previous.accountId !== accountId || previous.connectionId !== connectionId ||
            previous.status !== "exhausted" || previous.alertStatus !== "pending" ||
            !validPendingAlertState(previous) || attempts !== (previous.alertAttempts ?? 0) + 1) {
          const error = new Error("Cleanup alert retry is stale or conflicting.");
          error.code = "failed-precondition";
          throw error;
        }
        tx.set(ref, {
          ...previous, alertAttempts: attempts, alertNextAttemptAt: nextAttemptAt,
          alertLastErrorCode: lastErrorCode, updatedAt: timestamp
        });
      });
    },

    async markCleanupAlertDelivered({ accountId, connectionId, timestamp = Date.now() }) {
      if (!validId(accountId) || !validId(connectionId) ||
          !Number.isSafeInteger(timestamp) || timestamp < 1) {
        invalid("Cleanup alert acknowledgement is malformed.");
      }
      const ref = db.doc("accounts/" + accountId + "/mailboxCredentialCleanup/" + connectionId);
      await db.runTransaction(async tx => {
        const snapshot = await tx.get(ref);
        if (!snapshot.exists) {
          const error = new Error("Cleanup alert ticket not found.");
          error.code = "not-found";
          throw error;
        }
        const previous = snapshot.data();
        if (previous.accountId !== accountId || previous.connectionId !== connectionId ||
            previous.status !== "exhausted") {
          const error = new Error("Cleanup alert ticket is not exhausted.");
          error.code = "failed-precondition";
          throw error;
        }
        if (previous.alertStatus === "delivered") {
          const validDelivered = validExhaustedCleanupState({
            ...previous, status: "exhausted"
          });
          if (!validDelivered) {
            const error = new Error("Delivered cleanup alert metadata is malformed.");
            error.code = "failed-precondition";
            throw error;
          }
          return;
        }
        if (previous.alertStatus !== "pending" || !validPendingAlertState(previous)) {
          const error = new Error("Cleanup alert is not pending.");
          error.code = "failed-precondition";
          throw error;
        }
        tx.set(ref, { ...previous, alertStatus: "delivered", alertDeliveredAt: timestamp, alertNextAttemptAt: null, updatedAt: timestamp });
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
            !validSecretRef(previous.secretRef, accountId, connectionId)) {
          const error = new Error("Cleanup record is malformed.");
          error.code = "failed-precondition";
          throw error;
        }
        if (previous.status === "complete") {
          const alertStateValid = (previous.alertStatus === undefined || previous.alertStatus === null)
            ? (previous.alertAttempts === null || previous.alertAttempts === undefined) &&
              (previous.alertNextAttemptAt === null || previous.alertNextAttemptAt === undefined) &&
              (previous.alertLastErrorCode === null || previous.alertLastErrorCode === undefined) &&
              (previous.alertDeliveredAt === null || previous.alertDeliveredAt === undefined) &&
              (previous.alertResolvedAt === null || previous.alertResolvedAt === undefined)
            : (previous.alertStatus === "delivered" && validExhaustedCleanupState({
                ...previous, status: "exhausted"
              })) ||
              (previous.alertStatus === "resolved" && validExhaustedCleanupState({
                ...previous, status: "exhausted"
              }));
          if (!Number.isSafeInteger(previous.completedAt) || previous.completedAt < 1 ||
              !Number.isSafeInteger(previous.updatedAt) || previous.updatedAt < previous.completedAt ||
              !alertStateValid) {
            const error = new Error("Completed cleanup record metadata is malformed.");
            error.code = "failed-precondition";
            throw error;
          }
          return;
        }
        if (!["pending", "exhausted"].includes(previous.status)) {
          const error = new Error("Cleanup record is not pending or exhausted.");
          error.code = "failed-precondition";
          throw error;
        }
        if ((previous.status === "pending" && !validPendingCleanupState(previous)) ||
            (previous.status === "exhausted" && !validExhaustedCleanupState(previous))) {
          const error = new Error("Cleanup ticket retry metadata is malformed.");
          error.code = "failed-precondition";
          throw error;
        }
        if (previous.status === "exhausted" &&
            previous.alertStatus !== "pending" && previous.alertStatus !== "delivered") {
          const error = new Error("Exhausted cleanup alert state is invalid for completion.");
          error.code = "failed-precondition";
          throw error;
        }
        if (previous.alertStatus === "pending" && !validPendingAlertState(previous)) {
          const error = new Error("Pending cleanup alert metadata is malformed.");
          error.code = "failed-precondition";
          throw error;
        }
        if (previous.alertStatus !== undefined && previous.alertStatus !== null &&
            previous.alertStatus !== "pending" && previous.alertStatus !== "delivered") {
          const error = new Error("Cleanup alert state is not valid for completion.");
          error.code = "failed-precondition";
          throw error;
        }
        if (previous.alertStatus === "delivered" &&
            (!Number.isSafeInteger(previous.alertDeliveredAt) || previous.alertDeliveredAt < 1 ||
             (previous.alertNextAttemptAt !== null && previous.alertNextAttemptAt !== undefined))) {
          const error = new Error("Delivered cleanup alert metadata is malformed.");
          error.code = "failed-precondition";
          throw error;
        }
        // A later successful/manual deletion may recover a ticket after the
        // automated retry ceiling. Resolve its undelivered exhaustion alert.
        tx.set(ref, {
          ...previous, status: "complete", completedAt: timestamp, updatedAt: timestamp,
          ...(previous.alertStatus === "pending"
            ? {alertStatus: "resolved", alertResolvedAt: timestamp, alertNextAttemptAt: null}
            : {})
        });
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
      // Stable event identity makes retries idempotent. Timestamp is not
      // part of the key because a retry may happen later than the first write.
      const eventKey = createHash("sha256")
        .update([event.accountId, event.connectionId, event.action].join("\\0"))
        .digest("hex");
      const ref = db.doc(
        `accounts/${event.accountId}/mailboxConnectionAudit/${eventKey}`
      );
      const record = {
        accountId: event.accountId,
        actorUid: event.actorUid,
        action: event.action,
        connectionId: event.connectionId,
        mode: event.mode,
        provider: event.provider,
        timestamp: event.timestamp
      };
      try {
        await ref.create(record);
      } catch (error) {
        if (error?.code !== "already-exists" && error?.code !== 6 && error?.code !== "6") {
          throw error;
        }
        const existing = await ref.get();
        const previous = existing.exists ? existing.data() : null;
        const sameEvent = previous &&
          ["accountId", "actorUid", "action", "connectionId", "mode", "provider"]
            .every(key => previous[key] === record[key]) &&
          Number.isSafeInteger(previous.timestamp) && previous.timestamp > 0;
        if (!sameEvent) {
          const conflict = new Error("A conflicting immutable mailbox audit event exists.");
          conflict.code = "failed-precondition";
          throw conflict;
        }
        // Keep the first timestamp; repeated delivery is an acknowledgement,
        // not a new audit event.
      }
    }
  });
}
