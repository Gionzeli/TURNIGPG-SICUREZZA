import { createMailboxScheduleIngestionWorker } from "./mailbox-schedule-ingestion-worker.js";
import { createMailboxScheduleIngestionFirestoreAdapters } from "./mailbox-schedule-ingestion-firestore-adapters.js";

/**
 * Composition root for scheduled mailbox ingestion.
 * Intentionally not exported as a Firebase trigger. Enablement is explicit and
 * the caller must supply provider adapters and trusted ingestion dependencies.
 */
export function createMailboxScheduleIngestionComposition({
  enabled = false,
  db, leaseService, connectionRefForConnection, leaseRefForConnection,
  providerAdapters, ingestMessage, now = () => Date.now(), pollIntervalMs
}) {
  if (enabled !== true) {
    return Object.freeze({
      enabled: false,
      async run() { const error = new Error("Mailbox scheduled ingestion is disabled."); error.code = "failed-precondition"; throw error; },
      async initializePollingState() { const error = new Error("Mailbox scheduled ingestion is disabled."); error.code = "failed-precondition"; throw error; }
    });
  }
  if (!providerAdapters || typeof providerAdapters !== "object" ||
      typeof ingestMessage !== "function") {
    throw new TypeError("Enabled mailbox ingestion requires explicit providers and ingestion handler.");
  }
  const adapters = createMailboxScheduleIngestionFirestoreAdapters({
    db, leaseService, connectionRefForConnection, leaseRefForConnection, now, pollIntervalMs
  });
  const worker = createMailboxScheduleIngestionWorker({
    ...adapters,
    providerAdapters, ingestMessage, now
  });
  return Object.freeze({
    enabled: true,
    run: worker.run,
    initializePollingState: adapters.initializePollingState
  });
}
