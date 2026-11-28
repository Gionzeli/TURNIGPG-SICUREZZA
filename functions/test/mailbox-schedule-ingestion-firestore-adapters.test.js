import test from "node:test";
import assert from "node:assert/strict";
import { createMailboxScheduleIngestionFirestoreAdapters } from "../src/membership/mailbox-schedule-ingestion-firestore-adapters.js";

function fakeFirestore(seed = {}) {
  const values = new Map(Object.entries(seed));
  const refs = path => ({
    path,
    get: async () => ({ exists: values.has(path), data: () => values.get(path) }),
  });
  const db = {
    values,
    doc: path => refs(path),
    collection: path => {
      const query = { collectionPath: path, filter: null, count: 100,
        where(field, op, value) { this.filter = { field, op, value }; return this; },
        orderBy(field, direction) { this.order = { field, direction }; return this; },
        limit(count) { this.count = count; return this; },
        get: async () => ({
          docs: [...values.entries()].filter(([docPath, data]) =>
            docPath.startsWith(path + "/") && data[query.filter.field] <= query.filter.value
          ).sort((a, b) => a[1][query.order.field] - b[1][query.order.field]).slice(0, query.count).map(([docPath, data]) => ({
            id: docPath.split("/").at(-1), data: () => data
          }))
        })
      };
      return query;
    },
    runTransaction: async callback => callback({
      get: async ref => ({ exists: values.has(ref.path), data: () => values.get(ref.path) }),
      update: (ref, patch) => values.set(ref.path, { ...values.get(ref.path), ...patch }),
      create: (ref, value) => { if (values.has(ref.path)) { const error = new Error('exists'); error.code = 'already-exists'; throw error; } values.set(ref.path, value); }
    }),
    nowValue: 1000
  };
  return db;
}
function pathPrefix(path) {
  const parts = path.split("/");
  return parts.slice(0, 3).join("/") + "/mailboxPolling/";
}
const accountId = "synthetic-account";
const connectionId = "synthetic-mailbox";
const pollingPath = `accounts/${accountId}/mailboxPolling/${connectionId}`;
const connectionPath = `accounts/${accountId}/mailboxConnections/${connectionId}`;
const leasePath = `accounts/${accountId}/mailboxRefreshLeases/${connectionId}`;

function harness(overrides = {}) {
  const db = fakeFirestore({
    [pollingPath]: { accountId, connectionId, cursor: "cursor-0", nextPollAt: 900 },
    [connectionPath]: { accountId, connectionId, provider: "imap", status: "active" },
    [leasePath]: { ownerId: "synthetic_owner_identifier", fencingToken: 1, expiresAt: 5000 }
  });
  const leaseCalls = { acquired: 0, released: 0 };
  const leaseService = {
    acquire: async () => { leaseCalls.acquired++; return { ownerId: "synthetic_owner_identifier", fencingToken: 1, expiresAt: 5000 }; },
    release: async () => { leaseCalls.released++; return true; }
  };
  const adapters = createMailboxScheduleIngestionFirestoreAdapters({
    db, leaseService,
    connectionRefForConnection: ({ accountId, connectionId }) => db.doc(`accounts/${accountId}/mailboxConnections/${connectionId}`),
    leaseRefForConnection: ({ accountId, connectionId }) => db.doc(`accounts/${accountId}/mailboxRefreshLeases/${connectionId}`),
    now: () => 1000, pollIntervalMs: 300000, ...overrides
  });
  return { db, adapters, leaseCalls };
}

test("lists only due mailbox polling state with bounded cursor metadata", async () => {
  const { adapters } = harness();
  const due = await adapters.listDueConnections({ accountId, limit: 5 });
  assert.deepEqual(due, [{ accountId, connectionId, cursor: "cursor-0", nextPollAt: 900 }]);
});

test("loads canonical mailbox metadata and acquires/releases fenced lease", async () => {
  const { adapters, leaseCalls } = harness();
  assert.equal((await adapters.loadConnection({ accountId, connectionId })).status, "active");
  const lease = await adapters.acquireLease({ accountId, connectionId });
  assert.equal(lease.acquired, true);
  assert.equal(await adapters.releaseLease({ accountId, connectionId, lease }), true);
  assert.deepEqual(leaseCalls, { acquired: 1, released: 1 });
});

test("lease contention and revocation fail closed as a skipped mailbox", async () => {
  const { adapters } = harness({ leaseService: {
    acquire: async () => { const error = new Error("held"); error.code = "lease-held"; throw error; },
    release: async () => true
  }});
  assert.deepEqual(await adapters.acquireLease({ accountId, connectionId }), { acquired: false });
});

test("checkpoint advances cursor transactionally only with current cursor and live lease", async () => {
  const { adapters, db } = harness();
  await adapters.saveCheckpoint({ accountId, connectionId, expectedCursor: "cursor-0", nextCursor: "cursor-1", lease: { ownerId: "synthetic_owner_identifier", fencingToken: 1 }, timestamp: 1000 });
  assert.equal(db.values.get(pollingPath).cursor, "cursor-1");
  assert.equal(db.values.get(pollingPath).nextPollAt, 301000);
});

test("stale cursor, expired lease and revocation marker block checkpoint", async () => {
  const stale = harness();
  await assert.rejects(stale.adapters.saveCheckpoint({
    accountId, connectionId, expectedCursor: "old-cursor", nextCursor: "cursor-1", lease: { ownerId: "synthetic_owner_identifier", fencingToken: 1 }, timestamp: 1000
  }), { code: "conflict" });
  const expired = harness();
  expired.db.values.set(leasePath, { ownerId: "synthetic_owner_identifier", fencingToken: 1, expiresAt: 999 });
  await assert.rejects(expired.adapters.saveCheckpoint({
    accountId, connectionId, expectedCursor: "cursor-0", nextCursor: "cursor-1", lease: { ownerId: "synthetic_owner_identifier", fencingToken: 1 }, timestamp: 1000
  }), { code: "failed-precondition" });
  const revoked = harness();
  revoked.db.values.set(leasePath, { ownerId: "synthetic_owner_identifier", fencingToken: 1, expiresAt: 5000, revocationPending: true });
  await assert.rejects(revoked.adapters.saveCheckpoint({
    accountId, connectionId, expectedCursor: "cursor-0", nextCursor: "cursor-1", lease: { ownerId: "synthetic_owner_identifier", fencingToken: 1 }, timestamp: 1000
  }), { code: "failed-precondition" });
});

test("checkpoint rejects a lease proof superseded by a newer fencing token", async () => {
  const { adapters, db } = harness();
  db.values.set(leasePath, { ownerId: "successor_owner_identifier", fencingToken: 2, expiresAt: 5000 });
  await assert.rejects(adapters.saveCheckpoint({
    accountId, connectionId, expectedCursor: "cursor-0", nextCursor: "cursor-1",
    lease: { ownerId: "synthetic_owner_identifier", fencingToken: 1 }, timestamp: 1000
  }), { code: "failed-precondition" });
  assert.equal(db.values.get(pollingPath).cursor, "cursor-0");
});

test("initializes polling state only for active canonical mailbox and is idempotent", async () => {
  const { adapters, db } = harness();
  await adapters.initializePollingState({ accountId, connectionId, timestamp: 1000 });
  assert.deepEqual(db.values.get(pollingPath), {
    accountId, connectionId, cursor: null, nextPollAt: 1000, updatedAt: 1000
  });
  await adapters.initializePollingState({ accountId, connectionId, timestamp: 2000 });
  assert.equal(db.values.get(pollingPath).nextPollAt, 1000);
});

test("does not initialize polling for revoked mailbox", async () => {
  const { adapters, db } = harness();
  db.values.set(connectionPath, { accountId, connectionId, provider: "imap", status: "revoked" });
  await assert.rejects(adapters.initializePollingState({ accountId, connectionId, timestamp: 1000 }), { code: "failed-precondition" });
  assert.equal(db.values.has(pollingPath), true);
});
