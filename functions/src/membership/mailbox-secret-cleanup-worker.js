const MAX_BATCH = 100;
const MAX_ATTEMPTS = 12;
const MAX_BACKOFF_MS = 6 * 60 * 60 * 1000;
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
function validSecretRef(value, accountId, connectionId) {
  if (typeof value !== "string" || value.length > 512) return false;
  const match = /^mailbox\/([A-Za-z0-9_-]{1,128})\/([A-Za-z0-9_-]{1,128})\/([A-Za-z0-9_-]{16,128})$/.exec(value);
  return !!match && match[1] === accountId && match[2] === connectionId;
}

function validPendingTicket(ticket, accountId) {
  if (!ticket || ticket.accountId !== accountId ||
      typeof ticket.connectionId !== "string" || !ID_RE.test(ticket.connectionId) ||
      !validSecretRef(ticket.secretRef, accountId, ticket.connectionId) ||
      ticket.status !== "pending" ||
      typeof ticket.reason !== "string" || !/^[a-z0-9_-]{1,64}$/.test(ticket.reason) ||
      !Number.isSafeInteger(ticket.createdAt) || ticket.createdAt < 1 ||
      !Number.isSafeInteger(ticket.updatedAt) || ticket.updatedAt < ticket.createdAt ||
      !Number.isSafeInteger(ticket.attempts) || ticket.attempts < 1 ||
      ticket.attempts > MAX_ATTEMPTS ||
      !(ticket.lastErrorCode === undefined || ticket.lastErrorCode === null ||
        (typeof ticket.lastErrorCode === "string" && /^[a-z0-9_-]{1,64}$/.test(ticket.lastErrorCode)))) {
    return false;
  }
  if (ticket.attempts === 1) {
    return (ticket.nextAttemptAt === null || ticket.nextAttemptAt === undefined) &&
      (ticket.lastErrorCode === null || ticket.lastErrorCode === undefined);
  }
  return ticket.attempts < MAX_ATTEMPTS
    ? Number.isSafeInteger(ticket.nextAttemptAt) && ticket.nextAttemptAt >= ticket.updatedAt &&
      typeof ticket.lastErrorCode === "string"
    : ticket.nextAttemptAt === null && typeof ticket.lastErrorCode === "string";
}

function validPendingAlertTicket(ticket, accountId) {
  const attempts = ticket?.alertAttempts ?? 0;
  const nextAttemptAt = ticket?.alertNextAttemptAt ?? null;
  const lastErrorCode = ticket?.alertLastErrorCode ?? null;
  if (!ticket || ticket.accountId !== accountId ||
      typeof ticket.connectionId !== "string" || !ID_RE.test(ticket.connectionId) ||
      ticket.status !== "exhausted" || ticket.alertStatus !== "pending" ||
      !Number.isSafeInteger(ticket.createdAt) || ticket.createdAt < 1 ||
      !Number.isSafeInteger(ticket.updatedAt) || ticket.updatedAt < ticket.createdAt ||
      !Number.isSafeInteger(ticket.attempts) || ticket.attempts < MAX_ATTEMPTS ||
      ticket.nextAttemptAt !== null ||
      typeof ticket.lastErrorCode !== "string" || !/^[a-z0-9_-]{1,64}$/.test(ticket.lastErrorCode) ||
      !Number.isSafeInteger(attempts) || attempts < 0 || attempts >= Number.MAX_SAFE_INTEGER ||
      (attempts === 0
        ? nextAttemptAt !== null || lastErrorCode !== null
        : !Number.isSafeInteger(nextAttemptAt) || nextAttemptAt < ticket.updatedAt ||
          typeof lastErrorCode !== "string" || !/^[a-z0-9_-]{1,64}$/.test(lastErrorCode)) ||
      (ticket.alertDeliveredAt !== null && ticket.alertDeliveredAt !== undefined) ||
      (ticket.alertResolvedAt !== null && ticket.alertResolvedAt !== undefined)) return false;
  return true;
}

function safeCode(error) {
  const value = typeof error?.code === "string" ? error.code : "unknown";
  return /^[a-z0-9_-]{1,64}$/.test(value) ? value : "unknown";
}
function retryDelay(attempt) {
  const exponent = Math.max(0, Math.min(20, attempt - 1));
  return Math.min(60_000 * (2 ** exponent), MAX_BACKOFF_MS);
}
function readWorkerTimestamp(now) {
  const timestamp = now();
  if (!Number.isSafeInteger(timestamp) || timestamp < 1 ||
      timestamp > Number.MAX_SAFE_INTEGER - MAX_BACKOFF_MS) {
    const error = new Error("Cleanup worker clock returned an invalid timestamp.");
    error.code = "failed-precondition";
    throw error;
  }
  return timestamp;
}

/**
 * Server-only retry worker. Dependencies must be trusted adapters; vault delete
 * must be idempotent (including already-absent secrets). This worker does not
 * log secret references or provider errors.
 */
export function createMailboxSecretCleanupWorker({
  cleanupAdapters, credentialVault, assertRevocationPending, alert, now = () => Date.now()
}) {
  const required = [
    ["assertRevocationPending", assertRevocationPending],
    ["listPendingSecretCleanup", cleanupAdapters?.listPendingSecretCleanup],
    ["completeSecretCleanup", cleanupAdapters?.completeSecretCleanup],
    ["recordSecretCleanupFailure", cleanupAdapters?.recordSecretCleanupFailure],
    ["listPendingCleanupAlerts", cleanupAdapters?.listPendingCleanupAlerts],
    ["recordCleanupAlertFailure", cleanupAdapters?.recordCleanupAlertFailure],
    ["markCleanupAlertDelivered", cleanupAdapters?.markCleanupAlertDelivered],
    ["revokeSecret", credentialVault?.revokeSecret],
    ["alert", alert]
  ];
  for (const [name, fn] of required) {
    if (typeof fn !== "function") throw new TypeError(name + " dependency is required.");
  }

  return Object.freeze({
    async runOnce({ accountId, limit = 50 } = {}) {
      if (typeof accountId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(accountId)) {
        const error = new Error("A valid account scope is required.");
        error.code = "invalid-argument";
        throw error;
      }
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_BATCH) {
        const error = new Error("Cleanup batch size must be between 1 and 100.");
        error.code = "invalid-argument";
        throw error;
      }
      const runTimestamp = readWorkerTimestamp(now);
      const tickets = await cleanupAdapters.listPendingSecretCleanup({ accountId, limit });
      if (!Array.isArray(tickets) || tickets.length > limit ||
          tickets.some(ticket => !ticket || typeof ticket.connectionId !== "string") ||
          new Set(tickets.map(ticket => ticket.connectionId)).size !== tickets.length) {
        const error = new Error("Cleanup adapter returned an invalid or duplicate batch.");
        error.code = "failed-precondition";
        throw error;
      }
      const summary = { scanned: 0, completed: 0, deferred: 0, exhausted: 0 };
      for (const ticket of tickets) {
        summary.scanned++;
        if (!validPendingTicket(ticket, accountId)) {
          summary.deferred++;
          continue;
        }
        // Defensive compatibility for a pending ticket already at the retry
        // ceiling (for example, from a legacy adapter). The Firestore adapter
        // transitions exhausted tickets out of the pending query.
        if (ticket.attempts >= MAX_ATTEMPTS && ticket.nextAttemptAt === null) {
          summary.exhausted++;
          continue;
        }
        if (Number.isSafeInteger(ticket.nextAttemptAt) && ticket.nextAttemptAt > runTimestamp) {
          summary.deferred++;
          continue;
        }
        try {
          // A durable cleanup ticket is not itself proof that refresh has
          // been fenced. Verify the monotonic revocation gate before deletion.
          const gate = await assertRevocationPending({
            accountId: ticket.accountId, connectionId: ticket.connectionId
          });
          if (gate?.status !== "revocation_pending") {
            const error = new Error("Mailbox cleanup revocation gate was not confirmed.");
            error.code = "failed-precondition";
            throw error;
          }
          await credentialVault.revokeSecret({
            accountId: ticket.accountId,
            connectionId: ticket.connectionId,
            secretRef: ticket.secretRef
          });
          await cleanupAdapters.completeSecretCleanup({
            accountId: ticket.accountId, connectionId: ticket.connectionId,
            timestamp: readWorkerTimestamp(now)
          });
          summary.completed++;
        } catch (error) {
          const attempts = ticket.attempts + 1;
          let timestamp;
          try { timestamp = readWorkerTimestamp(now); }
          catch { summary.deferred++; continue; }
          const exhausted = attempts >= MAX_ATTEMPTS;
          const nextAttemptAt = exhausted ? null : timestamp + retryDelay(attempts);
          let retryRecorded = false;
          try {
            await cleanupAdapters.recordSecretCleanupFailure({
              accountId: ticket.accountId, connectionId: ticket.connectionId,
              secretRef: ticket.secretRef, attempts, nextAttemptAt,
              lastErrorCode: safeCode(error), timestamp
            });
            retryRecorded = true;
          } catch {
            // Ticket remains pending; do not surface sensitive backend details.
          }
          if (exhausted && retryRecorded) summary.exhausted++;
          else summary.deferred++;
        }
      }

      // Deliver alerts from the durable outbox. Sending before acknowledging
      // gives at-least-once delivery: providers should deduplicate by alertId.
      let pendingAlerts = [];
      try {
        pendingAlerts = await cleanupAdapters.listPendingCleanupAlerts({ accountId, limit });
        if (!Array.isArray(pendingAlerts) || pendingAlerts.length > limit ||
            pendingAlerts.some(ticket => !ticket || typeof ticket.connectionId !== "string") ||
            new Set(pendingAlerts.map(ticket => ticket.connectionId)).size !== pendingAlerts.length) {
          return summary;
        }
      } catch {
        return summary;
      }
      for (const ticket of pendingAlerts) {
        if (!validPendingAlertTicket(ticket, accountId)) continue;
        const alertAttempts = ticket.alertAttempts ?? 0;
        const alertNextAttemptAt = ticket.alertNextAttemptAt ?? null;
        let alertTimestamp;
        try { alertTimestamp = readWorkerTimestamp(now); }
        catch { return summary; }
        if (Number.isSafeInteger(alertNextAttemptAt) && alertNextAttemptAt > alertTimestamp) continue;
        const alertId = accountId + ":" + ticket.connectionId + ":cleanup-exhausted";
        try {
          await alert({
            alertId, accountId, connectionId: ticket.connectionId,
            attempts: ticket.attempts, code: ticket.lastErrorCode
          });
        } catch (error) {
          const attempts = (ticket.alertAttempts ?? 0) + 1;
          let timestamp;
          try { timestamp = readWorkerTimestamp(now); }
          catch { continue; }
          try {
            await cleanupAdapters.recordCleanupAlertFailure({
              accountId, connectionId: ticket.connectionId, attempts,
              nextAttemptAt: timestamp + retryDelay(attempts),
              lastErrorCode: safeCode(error), timestamp
            });
          } catch {
            // If persistence fails, leave the prior pending record unchanged.
          }
          continue;
        }

        // Sending succeeded. If the clock or acknowledgement fails now, leave
        // the durable alert pending and retry with the same idempotency key.
        let deliveredAt;
        try { deliveredAt = readWorkerTimestamp(now); }
        catch { continue; }
        try {
          await cleanupAdapters.markCleanupAlertDelivered({
            accountId, connectionId: ticket.connectionId, timestamp: deliveredAt
          });
        } catch (error) {
          const attempts = (ticket.alertAttempts ?? 0) + 1;
          let timestamp;
          try { timestamp = readWorkerTimestamp(now); }
          catch { continue; }
          try {
            await cleanupAdapters.recordCleanupAlertFailure({
              accountId, connectionId: ticket.connectionId, attempts,
              nextAttemptAt: timestamp + retryDelay(attempts),
              lastErrorCode: safeCode(error), timestamp
            });
          } catch {
            // If persistence fails, leave the prior pending record unchanged.
          }
        }
      }
      return summary;
    }
  });
}
