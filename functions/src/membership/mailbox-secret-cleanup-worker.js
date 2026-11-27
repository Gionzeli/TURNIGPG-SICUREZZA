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
  listPending, revokeSecret, completeCleanup, recordFailure,
  alert, now = () => Date.now()
}) {
  for (const [name, fn] of Object.entries({
    listPending, revokeSecret, completeCleanup, recordFailure, alert
  })) if (typeof fn !== "function") throw new TypeError(name + " dependency is required.");

  return Object.freeze({
    async runOnce({ limit = 50 } = {}) {
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_BATCH) {
        const error = new Error("Cleanup batch size must be between 1 and 100.");
        error.code = "invalid-argument";
        throw error;
      }
      const tickets = await listPending({ limit });
      const summary = { scanned: 0, completed: 0, deferred: 0, exhausted: 0 };
      for (const ticket of tickets) {
        summary.scanned++;
        if (!ticket || typeof ticket.accountId !== "string" ||
            typeof ticket.connectionId !== "string" ||
            typeof ticket.secretRef !== "string" || ticket.secretRef.length < 1 ||
            ticket.status !== "pending" || !Number.isInteger(ticket.attempts) ||
            ticket.attempts < 1) {
          summary.deferred++;
          continue;
        }
        if (Number.isSafeInteger(ticket.nextAttemptAt) && ticket.nextAttemptAt > now()) {
          summary.deferred++;
          continue;
        }
        try {
          await revokeSecret({
            accountId: ticket.accountId,
            connectionId: ticket.connectionId,
            secretRef: ticket.secretRef
          });
          await completeCleanup({
            accountId: ticket.accountId, connectionId: ticket.connectionId,
            timestamp: now()
          });
          summary.completed++;
        } catch (error) {
          const attempts = ticket.attempts + 1;
          const timestamp = now();
          const exhausted = attempts >= MAX_ATTEMPTS;
          const nextAttemptAt = exhausted ? null : timestamp + retryDelay(attempts);
          try {
            await recordFailure({
              accountId: ticket.accountId, connectionId: ticket.connectionId,
              secretRef: ticket.secretRef, attempts, nextAttemptAt,
              lastErrorCode: safeCode(error), timestamp
            });
          } catch {
            // Ticket remains pending; do not surface sensitive backend details.
          }
          if (exhausted) {
            summary.exhausted++;
            try {
              await alert({ accountId: ticket.accountId, connectionId: ticket.connectionId,
                attempts, code: safeCode(error) });
            } catch {}
          } else summary.deferred++;
        }
      }
      return summary;
    }
  });
}
