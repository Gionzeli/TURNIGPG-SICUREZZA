const MAX_BATCH = 100;
const MAX_ATTEMPTS = 12;
const MAX_BACKOFF_MS = 6 * 60 * 60 * 1000;

function safeCode(error) {
  const value = typeof error?.code === "string" ? error.code : "unknown";
  return /^[a-z0-9_-]{1,64}$/.test(value) ? value : "unknown";
}
function retryDelay(attempt) {
  const exponent = Math.max(0, Math.min(20, attempt - 1));
  return Math.min(60_000 * (2 ** exponent), MAX_BACKOFF_MS);
}

/**
 * Server-only retry worker. Dependencies must be trusted adapters; vault delete
 * must be idempotent (including already-absent secrets). This worker does not
 * log secret references or provider errors.
 */
export function createMailboxSecretCleanupWorker({
  cleanupAdapters, credentialVault, alert, now = () => Date.now()
}) {
  const required = [
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
        if (!ticket || ticket.accountId !== accountId ||
            typeof ticket.connectionId !== "string" ||
            !/^[A-Za-z0-9_-]{1,128}$/.test(ticket.connectionId) ||
            typeof ticket.secretRef !== "string" || ticket.secretRef.length < 1 ||
            ticket.secretRef.length > 2048 || ticket.status !== "pending" ||
            !Number.isSafeInteger(ticket.attempts) || ticket.attempts < 1 ||
            !(ticket.nextAttemptAt === null ||
              (Number.isSafeInteger(ticket.nextAttemptAt) && ticket.nextAttemptAt >= 1)) ||
            !(ticket.lastErrorCode === undefined || ticket.lastErrorCode === null ||
              (typeof ticket.lastErrorCode === "string" &&
               /^[a-z0-9_-]{1,64}$/.test(ticket.lastErrorCode)))) {
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
        if (Number.isSafeInteger(ticket.nextAttemptAt) && ticket.nextAttemptAt > now()) {
          summary.deferred++;
          continue;
        }
        try {
          await credentialVault.revokeSecret({
            accountId: ticket.accountId,
            connectionId: ticket.connectionId,
            secretRef: ticket.secretRef
          });
          await cleanupAdapters.completeSecretCleanup({
            accountId: ticket.accountId, connectionId: ticket.connectionId,
            timestamp: now()
          });
          summary.completed++;
        } catch (error) {
          const attempts = ticket.attempts + 1;
          const timestamp = now();
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
        if (!ticket || ticket.accountId !== accountId ||
            typeof ticket.connectionId !== "string" ||
            !/^[A-Za-z0-9_-]{1,128}$/.test(ticket.connectionId) ||
            ticket.status !== "exhausted" || ticket.alertStatus !== "pending" ||
            !Number.isSafeInteger(ticket.attempts) || ticket.attempts < MAX_ATTEMPTS ||
            typeof ticket.lastErrorCode !== "string" ||
            !/^[a-z0-9_-]{1,64}$/.test(ticket.lastErrorCode) ||
            !Number.isSafeInteger(ticket.alertAttempts ?? 0) || (ticket.alertAttempts ?? 0) < 0 ||
            !(ticket.alertNextAttemptAt === null || ticket.alertNextAttemptAt === undefined ||
              (Number.isSafeInteger(ticket.alertNextAttemptAt) && ticket.alertNextAttemptAt >= 1)) ||
            !(ticket.alertLastErrorCode === null || ticket.alertLastErrorCode === undefined ||
              (typeof ticket.alertLastErrorCode === "string" &&
               /^[a-z0-9_-]{1,64}$/.test(ticket.alertLastErrorCode)))) continue;
        if (Number.isSafeInteger(ticket.alertNextAttemptAt) && ticket.alertNextAttemptAt > now()) continue;
        const alertId = accountId + ":" + ticket.connectionId + ":cleanup-exhausted";
        try {
          await alert({
            alertId, accountId, connectionId: ticket.connectionId,
            attempts: ticket.attempts, code: ticket.lastErrorCode
          });
          await cleanupAdapters.markCleanupAlertDelivered({
            accountId, connectionId: ticket.connectionId, timestamp: now()
          });
        } catch (error) {
          // Persist bounded exponential backoff; the durable alert remains pending.
          const attempts = (ticket.alertAttempts ?? 0) + 1;
          const timestamp = now();
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
