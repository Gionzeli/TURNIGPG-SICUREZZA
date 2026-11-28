import test from "node:test";
import assert from "node:assert/strict";
import { createEmployeeScheduleProposalFirestoreAdapter } from "../src/membership/employee-schedule-proposal-firestore-adapter.js";

const accountId = "synthetic-account";
const jobId = "a".repeat(64);
const leaseToken = "b".repeat(64);
const employeeId = "synthetic-employee";
const employeeUid = "synthetic-uid";
const input = {
  accountId, employeeId, employeeUid, proposerUid: employeeUid,
  source: "employer_email", sourceVerified: true, ingestionJobId: jobId,
  ingestionLeaseToken: leaseToken, ingestionFencingToken: 2,
  attachmentSha256: "c".repeat(64), receivedAt: 1_000,
  sender: "schedules@example.test", idempotencyKey: jobId + "_" + employeeId,
  changes: [{ operation: "create", shift: { date: "2026-12-01", type: "turno", post: "A", start_time: "08:00", end_time: "16:00", hours: 8 } }],
  before: [null]
};

function harness({ employeeStatus = "active" } = {}) {
  const values = new Map([
    [`accounts/${accountId}`, { status: "active" }],
    [`accounts/${accountId}/scheduleIngestionJobs/${jobId}`, {
      jobId, idempotencyKey: jobId, attachmentSha256: input.attachmentSha256, accountId, status: "processing", leaseToken, fencingToken: 2, leaseExpiresAt: 20_000
    }]
  ]);
  const db = {
    values,
    doc: path => ({ path, id: path.split("/").at(-1) }),
    runTransaction: callback => callback({
      get: async ref => ({ exists: values.has(ref.path), id: ref.id, data: () => values.get(ref.path) }),
      create: (ref, value) => {
        if (values.has(ref.path)) { const error = new Error("exists"); error.code = "already-exists"; throw error; }
        values.set(ref.path, value);
      }
    })
  };
  const adapter = createEmployeeScheduleProposalFirestoreAdapter({
    db, now: () => 10_000,
    authorizeEmployee: async (_tx, args) => ({
      accountId: args.accountId, employeeId: args.employeeId, uid: args.employeeUid, status: employeeStatus
    })
  });
  return { adapter, db };
}

test("creates a proposal only under a live matching fenced ingestion lease", async () => {
  const { adapter, db } = harness();
  const result = await adapter.createEmployeeProposal(input);
  assert.equal(result.status, "pending");
  assert.equal(result.duplicate, false);
  assert.equal(db.values.size, 3);
  const proposal = [...db.values.entries()].find(([path]) => path.includes("/employeeShiftProposals/"))[1];
  assert.equal(proposal.sourceVerified, true);
  assert.equal(proposal.employeeId, employeeId);
});

test("retries return the same proposal without duplicating it", async () => {
  const { adapter, db } = harness();
  const first = await adapter.createEmployeeProposal(input);
  const retry = await adapter.createEmployeeProposal(input);
  assert.equal(retry.proposalId, first.proposalId);
  assert.equal(retry.duplicate, true);
  assert.equal(db.values.size, 3);
});

test("stale fencing token and expired lease cannot persist a proposal", async () => {
  const { adapter, db } = harness();
  await assert.rejects(adapter.createEmployeeProposal({ ...input, ingestionFencingToken: 1 }), { code: "failed-precondition" });
  db.values.set(`accounts/${accountId}/scheduleIngestionJobs/${jobId}`, {
    ...db.values.get(`accounts/${accountId}/scheduleIngestionJobs/${jobId}`), leaseExpiresAt: 10_000
  });
  await assert.rejects(adapter.createEmployeeProposal(input), { code: "failed-precondition" });
  assert.equal(db.values.size, 2);
});

test("inactive canonical Employee binding blocks proposal persistence", async () => {
  const { adapter, db } = harness({ employeeStatus: "suspended" });
  await assert.rejects(adapter.createEmployeeProposal(input), { code: "permission-denied" });
  assert.equal(db.values.size, 2);
});

test("same idempotency key cannot silently change proposal content", async () => {
  const { adapter } = harness();
  await adapter.createEmployeeProposal(input);
  await assert.rejects(adapter.createEmployeeProposal({
    ...input, changes: [{ operation: "create", shift: { date: "2026-12-02", type: "turno" } }]
  }), { code: "failed-precondition" });
});


test("invalid calendar dates and shift fields are rejected before transaction", async () => {
  const { adapter, db } = harness();
  await assert.rejects(adapter.createEmployeeProposal({
    ...input, changes: [{ operation: "create", shift: { ...input.changes[0].shift, date: "2026-02-30" } }]
  }), { code: "invalid-argument" });
  await assert.rejects(adapter.createEmployeeProposal({
    ...input, changes: [{ operation: "create", shift: { ...input.changes[0].shift, is_night: "false" } }]
  }), { code: "invalid-argument" });
  assert.equal(db.values.size, 2);
});
