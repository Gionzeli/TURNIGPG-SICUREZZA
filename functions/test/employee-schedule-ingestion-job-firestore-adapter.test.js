import test from "node:test";
import assert from "node:assert/strict";
import { createEmployeeScheduleIngestionJobFirestoreAdapter } from "../src/membership/employee-schedule-ingestion-job-firestore-adapter.js";

const accountId = "synthetic-account";
const input = {
  accountId, connectionId: "synthetic-mailbox", provider: "imap",
  messageId: "synthetic-message", attachmentSha256: "a".repeat(64),
  idempotencyKey: "b".repeat(64), receivedAt: 1000
};
function harness() {
  const values = new Map();
  const db = {
    values,
    doc: path => ({ path }),
    runTransaction: callback => callback({
      get: async ref => ({ exists: values.has(ref.path), data: () => values.get(ref.path) }),
      create: (ref, value) => {
        if (values.has(ref.path)) { const error = new Error("exists"); error.code = "already-exists"; throw error; }
        values.set(ref.path, value);
      },
      update: (ref, patch) => values.set(ref.path, { ...values.get(ref.path), ...patch })
    })
  };
  let clock = 1000;
  let token = 0;
  const adapter = createEmployeeScheduleIngestionJobFirestoreAdapter({
    db, now: () => clock, leaseMs: 10_000,
    createLeaseToken: () => (++token).toString(16).padStart(64, "0")
  });
  return { adapter, db, setTime: value => { clock = value; } };
}

test("claims a durable job once and treats a live processing lease as duplicate", async () => {
  const { adapter, db } = harness();
  const first = await adapter.claimIngestionJob(input);
  const duplicate = await adapter.claimIngestionJob(input);
  assert.equal(first.duplicate, false);
  assert.equal(first.fencingToken, 1);
  assert.equal(duplicate.duplicate, true);
  assert.equal(db.values.size, 1);
});

test("reclaims expired processing jobs with a higher fencing token", async () => {
  const { adapter, setTime } = harness();
  const first = await adapter.claimIngestionJob(input);
  setTime(11_001);
  const retry = await adapter.claimIngestionJob(input);
  assert.equal(retry.duplicate, false);
  assert.equal(retry.fencingToken, 2);
  assert.notEqual(retry.leaseToken, first.leaseToken);
});

test("stale worker cannot finish after a reclaimed lease", async () => {
  const { adapter, setTime } = harness();
  const first = await adapter.claimIngestionJob(input);
  setTime(11_001);
  const retry = await adapter.claimIngestionJob(input);
  await assert.rejects(adapter.finishIngestionJob({
    accountId, jobId: first.jobId, leaseToken: first.leaseToken, status: "proposals_created"
  }), { code: "failed-precondition" });
  const result = await adapter.finishIngestionJob({
    accountId, jobId: retry.jobId, leaseToken: retry.leaseToken, status: "proposals_created", proposalCount: 1
  });
  assert.equal(result.duplicate, false);
});

test("terminal completion is idempotent and subsequent claim is a duplicate", async () => {
  const { adapter } = harness();
  const claim = await adapter.claimIngestionJob(input);
  const finish = { accountId, jobId: claim.jobId, leaseToken: claim.leaseToken, status: "proposals_created" };
  assert.equal((await adapter.finishIngestionJob(finish)).duplicate, false);
  assert.equal((await adapter.finishIngestionJob(finish)).duplicate, true);
  assert.equal((await adapter.claimIngestionJob(input)).duplicate, true);
});

test("malformed identity and expired completion fail closed", async () => {
  const { adapter, setTime } = harness();
  await assert.rejects(adapter.claimIngestionJob({ ...input, attachmentSha256: "bad" }), { code: "invalid-argument" });
  const claim = await adapter.claimIngestionJob(input);
  setTime(11_001);
  await assert.rejects(adapter.finishIngestionJob({
    accountId, jobId: claim.jobId, leaseToken: claim.leaseToken, status: "failed"
  }), { code: "failed-precondition" });
});
