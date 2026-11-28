import test from "node:test";
import assert from "node:assert/strict";
import { createMailboxScheduleIngestionWorker } from "../src/membership/mailbox-schedule-ingestion-worker.js";

const accountId = "synthetic-account";
const connectionId = "synthetic-mailbox";

function harness(overrides = {}) {
  const calls = { ingested: [], checkpoints: [], released: 0, fetched: 0 };
  const connection = { accountId, connectionId, provider: "imap", status: "active" };
  const worker = createMailboxScheduleIngestionWorker({
    listDueConnections: async () => [{ accountId, connectionId, cursor: "cursor-0" }],
    loadConnection: async () => connection,
    acquireLease: async () => ({ acquired: true, ownerId: "synthetic_worker_identifier", fencingToken: 1, expiresAt: 5000 }),
    renewLease: async ({ lease, timestamp }) => ({ ...lease, expiresAt: timestamp + 120000 }),
    releaseLease: async () => { calls.released++; },
    providerAdapters: { imap: { fetchMessages: async () => {
      calls.fetched++;
      return { messages: [{ message: { messageId: "message-1" }, attachments: [{ filename: "a.pdf" }] }], nextCursor: "cursor-1" };
    } } },
    ingestMessage: async input => { calls.ingested.push(input); return [{ status: "proposals_created" }]; },
    saveCheckpoint: async input => { calls.checkpoints.push(input); },
    now: () => 100,
    ...overrides
  });
  return { worker, calls };
}

test("worker processes messages and advances cursor only after ingestion", async () => {
  const { worker, calls } = harness();
  const result = await worker.run({ accountId });
  assert.deepEqual(result, [{ connectionId, status: "processed", messageCount: 1, attachmentCount: 1 }]);
  assert.equal(calls.ingested.length, 1);
  assert.deepEqual(calls.checkpoints[0], {
    accountId, connectionId, expectedCursor: "cursor-0", nextCursor: "cursor-1", lease: { acquired: true, ownerId: "synthetic_worker_identifier", fencingToken: 1, expiresAt: 120100 }, timestamp: 100
  });
  assert.equal(calls.released, 1);
});

test("failed ingestion leaves provider cursor unchanged for safe retry", async () => {
  const { worker, calls } = harness({ ingestMessage: async () => { throw new Error("synthetic failure"); } });
  const result = await worker.run({ accountId });
  assert.equal(result[0].status, "retry_required");
  assert.equal(calls.checkpoints.length, 0);
  assert.equal(calls.released, 1);
});

test("revocation during batch prevents cursor advancement", async () => {
  let reads = 0;
  const { worker, calls } = harness({
    loadConnection: async () => (++reads === 1
      ? { accountId, connectionId, provider: "imap", status: "active" }
      : { accountId, connectionId, provider: "imap", status: "revoked" })
  });
  const result = await worker.run({ accountId });
  assert.equal(result[0].status, "revoked_during_batch");
  assert.equal(calls.checkpoints.length, 0);
});

test("lease contention skips mailbox without provider access", async () => {
  const { worker, calls } = harness({ acquireLease: async () => ({ acquired: false }) });
  const result = await worker.run({ accountId });
  assert.equal(result[0].status, "skipped_locked");
  assert.equal(calls.fetched, 0);
  assert.equal(calls.released, 0);
});

test("invalid or duplicate due connections fail before side effects", async () => {
  const { worker, calls } = harness({
    listDueConnections: async () => [
      { accountId, connectionId, cursor: null },
      { accountId, connectionId, cursor: null }
    ]
  });
  await assert.rejects(worker.run({ accountId }), { code: "failed-precondition" });
  assert.equal(calls.fetched, 0);
  assert.equal(calls.released, 0);
});

test("invalid batch bounds are rejected", async () => {
  const { worker } = harness();
  await assert.rejects(worker.run({ accountId, limit: 101 }), { code: "invalid-argument" });
});

test("invalid persisted cursor is rejected before acquiring a lease", async () => {
  const calls = { leases: 0 };
  const { worker } = harness({
    listDueConnections: async () => [{ accountId, connectionId, cursor: { unsafe: true } }],
    acquireLease: async () => { calls.leases++; return { acquired: true }; }
  });
  await assert.rejects(worker.run({ accountId }), { code: "failed-precondition" });
  assert.equal(calls.leases, 0);
});

test("lease renewal failure blocks ingestion and checkpoint", async () => {
  const { worker, calls } = harness({ renewLease: async () => { throw new Error("synthetic lease loss"); } });
  const result = await worker.run({ accountId });
  assert.equal(result[0].status, "retry_required");
  assert.equal(calls.ingested.length, 0);
  assert.equal(calls.checkpoints.length, 0);
  assert.equal(calls.released, 1);
});

test("expired renewal proof blocks provider fetch", async () => {
  const { worker, calls } = harness({
    renewLease: async ({ lease, timestamp }) => ({ ...lease, expiresAt: timestamp })
  });
  const result = await worker.run({ accountId });
  assert.equal(result[0].status, "retry_required");
  assert.equal(calls.fetched, 0);
  assert.equal(calls.ingested.length, 0);
  assert.equal(calls.checkpoints.length, 0);
  assert.equal(calls.released, 1);
});
