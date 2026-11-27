import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createMailboxConnectionFirestoreAdapters } from '../src/membership/mailbox-connection-firestore-adapters.js';

const emulatorAvailable = typeof process.env.FIRESTORE_EMULATOR_HOST === 'string' &&
  process.env.FIRESTORE_EMULATOR_HOST.length > 0;

test('Firestore Emulator durably queues and acknowledges exhausted cleanup alerts', {
  skip: !emulatorAvailable
}, async () => {
  const projectId = process.env.GCLOUD_PROJECT || 'demo-dsm-mailbox';
  const app = initializeApp({ projectId }, 'mailbox-cleanup-alert-' + process.pid);
  const db = getFirestore(app);
  const suffix = process.pid + '-' + Date.now();
  const accountId = 'it_account_' + suffix;
  const connectionId = 'it_connection_' + suffix;
  const ref = db.doc('accounts/' + accountId + '/mailboxCredentialCleanup/' + connectionId);
  const adapters = createMailboxConnectionFirestoreAdapters(db);
  const secretRef = 'vault://synthetic/' + suffix;
  const timestamp = Date.now();

  try {
    await adapters.recordSecretCleanup({
      accountId, connectionId, secretRef, reason: 'connection_revoked', timestamp
    });
    await adapters.recordSecretCleanupFailure({
      accountId, connectionId, secretRef, attempts: 12, nextAttemptAt: null,
      lastErrorCode: 'unavailable', timestamp: timestamp + 1
    });
    const queued = await adapters.listPendingCleanupAlerts({ accountId });
    assert.equal(queued.length, 1);
    assert.equal(queued[0].connectionId, connectionId);
    assert.equal(queued[0].alertStatus, 'pending');
    assert.equal(Object.hasOwn(queued[0], 'secretRef'), false);
    assert.equal(queued[0].alertAttempts, 0);
    await adapters.recordCleanupAlertFailure({
      accountId, connectionId, attempts: 1,
      nextAttemptAt: timestamp + 60000,
      lastErrorCode: 'unavailable', timestamp: timestamp + 2
    });
    const deferred = await adapters.listPendingCleanupAlerts({ accountId });
    assert.equal(deferred.length, 1);
    assert.equal(deferred[0].alertAttempts, 1);
    assert.equal(deferred[0].alertNextAttemptAt, timestamp + 60000);

    await adapters.markCleanupAlertDelivered({
      accountId, connectionId, timestamp: timestamp + 3
    });
    assert.deepEqual(await adapters.listPendingCleanupAlerts({ accountId }), []);
    const stored = (await ref.get()).data();
    assert.equal(stored.status, 'exhausted');
    assert.equal(stored.alertStatus, 'delivered');
    assert.equal(stored.alertDeliveredAt, timestamp + 3);
  } finally {
    await ref.delete();
    await deleteApp(app);
  }
});
