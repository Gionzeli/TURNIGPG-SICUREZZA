import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createGoogleSecretManagerTokenCasBackend } from '../src/membership/google-secret-manager-token-cas-backend.js';

const emulatorAvailable = typeof process.env.FIRESTORE_EMULATOR_HOST === 'string' &&
  process.env.FIRESTORE_EMULATOR_HOST.length > 0;

test('Firestore Emulator atomically fences stale mailbox lease owners at pointer commit', {
  skip: !emulatorAvailable
}, async () => {
  const projectId = process.env.GCLOUD_PROJECT || 'demo-dsm-mailbox';
  const app = initializeApp({ projectId }, 'mailbox-cas-emulator-' + process.pid);
  const db = getFirestore(app);
  const suffix = process.pid + '-' + Date.now();
  const accountId = 'it_account_' + suffix;
  const connectionId = 'it_connection_' + suffix;
  const secretRef = 'mailbox/' + accountId + '/' + connectionId + '/abcdefghijklmnop';
  const pointerRef = db.doc('accounts/' + accountId + '/mailboxTokenPointers/' + connectionId);
  const leaseRef = db.doc('accounts/' + accountId + '/mailboxRefreshLeases/' + connectionId);
  const secretVersions = new Map();
  let nextVersion = 2;
  const secretName = 'projects/' + projectId + '/secrets/mailbox-' + suffix;
  const secretManager = {
    accessSecretVersion: async ({ name }) => {
      const version = name.split('/').at(-1);
      const payload = secretVersions.get(version);
      if (!payload) throw new Error('missing synthetic version');
      return [{ payload: { data: Buffer.from(JSON.stringify(payload)) } }];
    },
    addSecretVersion: async ({ parent, payload }) => {
      const version = String(nextVersion++);
      secretVersions.set(version, JSON.parse(Buffer.from(payload.data).toString('utf8')));
      return [{ name: parent + '/versions/' + version }];
    }
  };
  const backend = createGoogleSecretManagerTokenCasBackend({
    secretManager,
    firestore: db,
    secretNameForRef: () => secretName,
    pointerRefForRef: () => pointerRef,
    leaseRefForConnection: () => leaseRef
  });
  try {
    secretVersions.set('1', {
      accessToken: 'synthetic-access-token-version-one',
      refreshToken: 'synthetic-refresh-token-version-one',
      expiresAt: Date.now() + 60_000
    });
    await pointerRef.create({ version: '1' });
    await leaseRef.create({
      ownerId: 'original_owner_identifier',
      fencingToken: 1,
      acquiredAt: Date.now(),
      expiresAt: Date.now() + 60_000
    });

    const first = await backend.replaceSecret({
      secretRef,
      payload: {
        accessToken: 'synthetic-access-token-version-two',
        refreshToken: 'synthetic-refresh-token-version-two',
        expiresAt: Date.now() + 120_000
      },
      expectedVersion: '1',
      leaseProof: { ownerId: 'original_owner_identifier', fencingToken: 1 }
    });
    assert.equal(first.version, '2');
    assert.equal((await pointerRef.get()).data().version, '2');

    await leaseRef.update({
      ownerId: 'successor_owner_identifier',
      fencingToken: 2,
      acquiredAt: Date.now(),
      expiresAt: Date.now() + 60_000
    });

    await assert.rejects(() => backend.replaceSecret({
      secretRef,
      payload: {
        accessToken: 'synthetic-stale-access-token',
        refreshToken: 'synthetic-stale-refresh-token',
        expiresAt: Date.now() + 180_000
      },
      expectedVersion: '2',
      leaseProof: { ownerId: 'original_owner_identifier', fencingToken: 1 }
    }), { code: 'conflict' });
    assert.equal((await pointerRef.get()).data().version, '2');
  } finally {
    await Promise.all([pointerRef.delete(), leaseRef.delete()]);
    await deleteApp(app);
  }
});
