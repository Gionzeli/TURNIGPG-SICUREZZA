import test from "node:test";
import assert from "node:assert/strict";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createMailboxTokenFirestoreLeaseService } from "../src/membership/mailbox-token-firestore-lease-service.js";
import { createMailboxScheduleIngestionFirestoreAdapters } from "../src/membership/mailbox-schedule-ingestion-firestore-adapters.js";
import { createMailboxScheduleIngestionWorker } from "../src/membership/mailbox-schedule-ingestion-worker.js";

const emulatorAvailable = typeof process.env.FIRESTORE_EMULATOR_HOST === "string" &&
  process.env.FIRESTORE_EMULATOR_HOST.length > 0;

test("Firestore Emulator composes mailbox polling, fenced lease and ingestion checkpoint", {
  skip: !emulatorAvailable
}, async () => {
  const projectId = process.env.GCLOUD_PROJECT || "demo-dsm-mailbox";
  const app = initializeApp({ projectId }, "mailbox-polling-emulator-" + process.pid);
  const db = getFirestore(app);
  const suffix = process.pid + "-" + Date.now();
  const accountId = "it_account_" + suffix;
  const connectionId = "it_connection_" + suffix;
  const connectionRef = db.doc(`accounts/${accountId}/mailboxConnections/${connectionId}`);
  const pollingRef = db.doc(`accounts/${accountId}/mailboxPolling/${connectionId}`);
  const leaseRef = db.doc(`accounts/${accountId}/mailboxRefreshLeases/${connectionId}`);
  const leaseService = createMailboxTokenFirestoreLeaseService({
    firestore: db,
    leaseRefForConnection: () => leaseRef
  });
  const adapters = createMailboxScheduleIngestionFirestoreAdapters({
    db, leaseService,
    connectionRefForConnection: () => connectionRef,
    leaseRefForConnection: () => leaseRef
  });
  try {
    await connectionRef.create({
      accountId, connectionId, provider: "imap", status: "active"
    });
    await adapters.initializePollingState({ accountId, connectionId, timestamp: Date.now() });
    const worker = createMailboxScheduleIngestionWorker({
      listDueConnections: adapters.listDueConnections,
      loadConnection: adapters.loadConnection,
      acquireLease: adapters.acquireLease,
      renewLease: adapters.renewLease,
      releaseLease: adapters.releaseLease,
      providerAdapters: {
        imap: { fetchMessages: async () => ({
          messages: [{
            message: { id: "synthetic-message-1", receivedAt: 12345 },
            attachments: [{ id: "synthetic-attachment-1", filename: "shift.pdf" }]
          }],
          nextCursor: "synthetic-cursor-1"
        }) }
      },
      ingestMessage: async ({ message, attachments }) => {
        assert.equal(message.id, "synthetic-message-1");
        assert.equal(attachments.length, 1);
        return [{ status: "synthetic_processed" }];
      },
      saveCheckpoint: adapters.saveCheckpoint
    });
    const result = await worker.run({ accountId, limit: 5 });
    assert.deepEqual(result, [{
      connectionId, status: "processed", messageCount: 1, attachmentCount: 1
    }]);
    const polling = (await pollingRef.get()).data();
    assert.equal(polling.cursor, "synthetic-cursor-1");
    assert.ok(polling.nextPollAt > polling.updatedAt);

    await pollingRef.update({ nextPollAt: Date.now() - 1 });
    await leaseService.disable({ accountId, connectionId });
    const skipped = await worker.run({ accountId, limit: 5 });
    assert.deepEqual(skipped, [{ connectionId, status: "skipped_locked" }]);
  } finally {
    await Promise.all([connectionRef.delete(), pollingRef.delete(), leaseRef.delete()]);
    await deleteApp(app);
  }
});
