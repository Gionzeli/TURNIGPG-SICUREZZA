import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createGoogleSecretManagerTokenCasBackend } from '../src/membership/google-secret-manager-token-cas-backend.js';
import { createMailboxTokenFirestoreLeaseService } from '../src/membership/mailbox-token-firestore-lease-service.js';
import { createMailboxTokenLifecycleVaultAdapter } from '../src/membership/mailbox-token-lifecycle-vault-adapter.js';
import { createMailboxTokenLifecycleCoordinator } from '../src/membership/mailbox-token-lifecycle-coordinator.js';

const emulatorAvailable = typeof process.env.FIRESTORE_EMULATOR_HOST === 'string' &&
  process.env.FIRESTORE_EMULATOR_HOST.length > 0;

test('two independent coordinators serialize refresh and persist one rotated credential set', {
  skip: !emulatorAvailable
}, async () => {
  const projectId = process.env.GCLOUD_PROJECT || 'demo-dsm-mailbox';
  const app = initializeApp({ projectId }, 'mailbox-lifecycle-emulator-' + process.pid);
  const db = getFirestore(app);
  const suffix = process.pid + '-' + Date.now();
  const accountId = 'it_account_' + suffix;
  const connectionId = 'it_connection_' + suffix;
  const secretRef = 'mailbox/' + accountId + '/' + connectionId + '/abcdefghijklmnop';
  const pointerRef = db.doc('accounts/' + accountId + '/mailboxTokenPointers/' + connectionId);
  const leaseRef = db.doc('accounts/' + accountId + '/mailboxRefreshLeases/' + connectionId);
  const secretName = 'projects/' + projectId + '/secrets/mailbox-' + suffix;
  const versions = new Map();
  let nextVersion = 2;
  let refreshCalls = 0;
  let signalRefreshStarted;
  let finishRefresh;
  const refreshStarted = new Promise(resolve => { signalRefreshStarted = resolve; });
  const refreshGate = new Promise(resolve => { finishRefresh = resolve; });
  const secretManager = {
    accessSecretVersion: async ({ name }) => {
      const version = name.split('/').at(-1);
      const payload = versions.get(version);
      if (!payload) throw new Error('missing synthetic version');
      return [{ payload: { data: Buffer.from(JSON.stringify(payload)) } }];
    },
    addSecretVersion: async ({ parent, payload }) => {
      const version = String(nextVersion++);
      versions.set(version, JSON.parse(Buffer.from(payload.data).toString('utf8')));
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
  const vault = createMailboxTokenLifecycleVaultAdapter({ backend });
  const leaseServiceA = createMailboxTokenFirestoreLeaseService({
    firestore: db,
    leaseRefForConnection: () => leaseRef
  });
  const leaseServiceB = createMailboxTokenFirestoreLeaseService({
    firestore: db,
    leaseRefForConnection: () => leaseRef
  });
  const refreshService = {
    async refresh() {
      refreshCalls += 1;
      signalRefreshStarted();
      await refreshGate;
      return {
        accessToken: 'synthetic-rotated-access-token-value',
        refreshToken: 'synthetic-rotated-refresh-token-value',
        expiresInSeconds: 3600,
        scope: 'https://www.googleapis.com/auth/gmail.readonly'
      };
    }
  };
  const coordinatorA = createMailboxTokenLifecycleCoordinator({
    vault, refreshService, leaseService: leaseServiceA
  });
  const coordinatorB = createMailboxTokenLifecycleCoordinator({
    vault, refreshService, leaseService: leaseServiceB
  });

  try {
    versions.set('1', {
      accessToken: 'synthetic-expired-access-token-value',
      refreshToken: 'synthetic-initial-refresh-token-value',
      expiresAt: Date.now() - 1_000,
      scopes: ['https://www.googleapis.com/auth/gmail.readonly']
    });
    await pointerRef.create({ version: '1' });

    const firstRefresh = coordinatorA.ensureFresh({
      accountId, connectionId, provider: 'gmail_api', secretRef,
      clientId: 'synthetic-client-id', clientSecret: 'synthetic-client-secret'
    });
    await refreshStarted;

    await assert.rejects(() => coordinatorB.ensureFresh({
      accountId, connectionId, provider: 'gmail_api', secretRef,
      clientId: 'synthetic-client-id', clientSecret: 'synthetic-client-secret'
    }), error => error.code === 'unavailable');

    finishRefresh();
    const firstResult = await firstRefresh;
    assert.equal(firstResult.refreshed, true);
    assert.equal(refreshCalls, 1);
    assert.equal((await pointerRef.get()).data().version, '2');

    const retryResult = await coordinatorB.ensureFresh({
      accountId, connectionId, provider: 'gmail_api', secretRef,
      clientId: 'synthetic-client-id', clientSecret: 'synthetic-client-secret'
    });
    assert.equal(retryResult.refreshed, false);
    assert.equal(retryResult.accessToken, 'synthetic-rotated-access-token-value');
    assert.equal(refreshCalls, 1);

    const stored = await vault.loadSecret({ secretRef });
    assert.equal(stored.refreshToken, 'synthetic-rotated-refresh-token-value');
    assert.equal(stored.version, '2');
    const leaseAfterRelease = (await leaseRef.get()).data();
    assert.equal(leaseAfterRelease.ownerId, null);
    assert.equal(leaseAfterRelease.fencingToken, 1);
  } finally {
    finishRefresh();
    await Promise.all([
      pointerRef.delete(),
      leaseRef.delete().catch(() => undefined)
    ]);
    await deleteApp(app);
  }
});


test('revocation gate prevents an in-flight refresh from persisting rotated credentials', {
  skip: !emulatorAvailable
}, async () => {
  const projectId = process.env.GCLOUD_PROJECT || 'demo-dsm-mailbox';
  const suffix = process.pid + '-' + Date.now() + '-revoke';
  const app = initializeApp({ projectId }, 'mailbox-revocation-emulator-' + suffix);
  const db = getFirestore(app);
  const accountId = 'it_account_' + suffix;
  const connectionId = 'it_connection_' + suffix;
  const secretRef = 'mailbox/' + accountId + '/' + connectionId + '/abcdefghijklmnop';
  const pointerRef = db.doc('accounts/' + accountId + '/mailboxTokenPointers/' + connectionId);
  const leaseRef = db.doc('accounts/' + accountId + '/mailboxRefreshLeases/' + connectionId);
  const secretName = 'projects/' + projectId + '/secrets/mailbox-' + suffix;
  const versions = new Map();
  let nextVersion = 2;
  let refreshStartedResolve;
  let finishRefreshResolve;
  const refreshStarted = new Promise(resolve => { refreshStartedResolve = resolve; });
  const refreshGate = new Promise(resolve => { finishRefreshResolve = resolve; });
  const secretManager = {
    accessSecretVersion: async ({ name }) => {
      const version = name.split('/').at(-1);
      const payload = versions.get(version);
      if (!payload) throw new Error('missing synthetic version');
      return [{ payload: { data: Buffer.from(JSON.stringify(payload)) } }];
    },
    addSecretVersion: async ({ parent, payload }) => {
      const version = String(nextVersion++);
      versions.set(version, JSON.parse(Buffer.from(payload.data).toString('utf8')));
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
  const vault = createMailboxTokenLifecycleVaultAdapter({ backend });
  const leaseService = createMailboxTokenFirestoreLeaseService({
    firestore: db,
    leaseRefForConnection: () => leaseRef
  });
  const refreshService = {
    async refresh() {
      refreshStartedResolve();
      await refreshGate;
      return {
        accessToken: 'synthetic-revoked-access-token-value',
        refreshToken: 'synthetic-revoked-refresh-token-value',
        expiresInSeconds: 3600,
        scope: 'https://www.googleapis.com/auth/gmail.readonly'
      };
    }
  };
  const coordinator = createMailboxTokenLifecycleCoordinator({
    vault, refreshService, leaseService
  });

  try {
    versions.set('1', {
      accessToken: 'synthetic-expired-access-token-value',
      refreshToken: 'synthetic-initial-refresh-token-value',
      expiresAt: Date.now() - 1_000,
      scopes: ['https://www.googleapis.com/auth/gmail.readonly']
    });
    await pointerRef.create({ version: '1' });

    const refresh = coordinator.ensureFresh({
      accountId, connectionId, provider: 'gmail_api', secretRef,
      clientId: 'synthetic-client-id', clientSecret: 'synthetic-client-secret'
    });
    await refreshStarted;
    const leaseAtRefresh = (await leaseRef.get()).data();
    assert.equal(typeof leaseAtRefresh.ownerId, 'string');
    assert.equal(leaseAtRefresh.revocationPending, undefined);

    await leaseService.disable({ accountId, connectionId });
    assert.equal((await leaseRef.get()).data().revocationPending, true);
    finishRefreshResolve();

    await assert.rejects(refresh, error => error.code === 'unavailable');
    assert.equal((await pointerRef.get()).data().version, '1');

    await assert.rejects(() => vault.storeSecret({
      secretRef,
      secretMaterial: {
        accessToken: 'synthetic-revoked-access-token-value',
        refreshToken: 'synthetic-revoked-refresh-token-value',
        expiresAt: Date.now() + 3_600_000
      },
      expectedVersion: '1',
      leaseProof: {
        ownerId: leaseAtRefresh.ownerId,
        fencingToken: leaseAtRefresh.fencingToken
      }
    }), error => error.code === 'conflict');

    const stored = await vault.loadSecret({ secretRef });
    assert.equal(stored.version, '1');
    assert.equal(stored.refreshToken, 'synthetic-initial-refresh-token-value');
    assert.equal((await leaseRef.get()).data().revocationPending, true);
  } finally {
    finishRefreshResolve();
    await Promise.all([
      pointerRef.delete().catch(() => undefined),
      leaseRef.delete().catch(() => undefined)
    ]);
    await deleteApp(app);
  }
});
