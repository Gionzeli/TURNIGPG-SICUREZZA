import test from "node:test";
import assert from "node:assert/strict";
import { createEmployeeScheduleEmailIngestionFirestorePersistence } from "../src/membership/employee-schedule-email-ingestion-firestore-persistence.js";

const accountId = "synthetic-account";
const employeeId = "employee-1";
const uid = "employee-uid-1";
const attachmentSha256 = "c".repeat(64);
const now = 1_800_000_000_000;

function canonicalFirestore() {
  const values = new Map();
  const put = (path, value) => values.set(path, value);
  put(`accounts/${accountId}`, {
    accountId, status: "active", schemaVersion: 1, version: 1
  });
  put(`accounts/${accountId}/members/${uid}`, {
    uid, accountId, status: "active", role: "member", scopeType: "site",
    scopeIds: ["site-1"], validFrom: new Date(1), validUntil: null
  });
  put(`accounts/${accountId}/employeeBindingsByUid/${uid}`, {
    accountId, uid, employeeId, status: "active", revision: 3
  });
  put(`accounts/${accountId}/employeeBindingsByEmployee/${employeeId}`, {
    accountId, uid, employeeId, status: "active", revision: 3
  });
  put(`accounts/${accountId}/employees/${employeeId}`, {
    accountId, employeeId, status: "active"
  });
  put(`accounts/${accountId}/employeeControl/${employeeId}`, {
    accountId, employeeId, bindingRevision: 3
  });
  put(`accounts/${accountId}/employees/${employeeId}/placements/placement-1`, {
    accountId, employeeId, placementId: "placement-1", siteId: "site-1",
    departmentId: "department-1", validFrom: "2026-01-01", validUntil: null, revision: 1
  });

  const db = {
    values,
    doc(path) { return { path, id: path.split("/").at(-1) }; },
    collection(path) {
      return { path, limit(count) { return { __query: true, path, count }; } };
    },
    async runTransaction(callback) {
      return callback({
        async get(ref) {
          if (ref.__query) {
            const docs = [...values.entries()]
              .filter(([path]) => path.startsWith(ref.path + "/"))
              .slice(0, ref.count)
              .map(([path, value]) => ({
                id: path.split("/").at(-1), exists: true, data: () => value
              }));
            return { size: docs.length, docs };
          }
          const value = values.get(ref.path);
          return {
            id: ref.id, exists: value !== undefined,
            data: () => value
          };
        },
        create(ref, value) {
          if (values.has(ref.path)) {
            const error = new Error("Document already exists.");
            error.code = "already-exists";
            throw error;
          }
          values.set(ref.path, value);
        },
        update(ref, patch) {
          const current = values.get(ref.path);
          if (!current) throw new Error("Missing document.");
          values.set(ref.path, { ...current, ...patch });
        }
      });
    }
  };
  return db;
}

const proposalFields = {
  source: "employer_email", sourceVerified: true, proposerUid: uid,
  receivedAt: now, sender: "turni@example.test",
  changes: [{
    operation: "create",
    shift: {
      date: "2026-12-01", type: "turno", post: "A",
      start_time: "08:00", end_time: "16:00", hours: 8
    }
  }],
  before: [null]
};

test("email ingestion persistence composes durable jobs and employee proposals without side effects", () => {
  let touched = 0;
  const db = {
    doc() { touched++; throw new Error("Firestore must not be accessed during composition."); },
    runTransaction() { touched++; throw new Error("Firestore must not be accessed during composition."); }
  };
  const persistence = createEmployeeScheduleEmailIngestionFirestorePersistence({ db, now: () => now });
  assert.equal(typeof persistence.claimIngestionJob, "function");
  assert.equal(typeof persistence.finishIngestionJob, "function");
  assert.equal(typeof persistence.createEmployeeProposal, "function");
  assert.equal(touched, 0);
});

test("composed persistence claims a job, authorizes the reciprocal employee binding, creates a proposal and finishes", async () => {
  const db = canonicalFirestore();
  const persistence = createEmployeeScheduleEmailIngestionFirestorePersistence({ db, now: () => now });
  const idempotencyKey = "a".repeat(64);
  const claim = await persistence.claimIngestionJob({
    accountId, connectionId: "mailbox-1", provider: "gmail_api",
    messageId: "message-1", attachmentSha256, idempotencyKey
  });
  assert.equal(claim.duplicate, false);

  const proposal = await persistence.createEmployeeProposal({
    accountId, employeeId, employeeUid: uid, ...proposalFields,
    ingestionJobId: claim.jobId, ingestionLeaseToken: claim.leaseToken,
    ingestionFencingToken: claim.fencingToken, attachmentSha256,
    idempotencyKey: claim.jobId + "_" + employeeId
  });
  assert.equal(proposal.status, "pending");
  assert.equal(proposal.duplicate, false);

  const saved = [...db.values.entries()].find(([path]) =>
    path.startsWith(`accounts/${accountId}/employeeShiftProposals/`));
  assert.ok(saved);
  assert.equal(saved[1].employeeId, employeeId);
  assert.equal(saved[1].proposerUid, uid);

  const finished = await persistence.finishIngestionJob({
    accountId, jobId: claim.jobId, leaseToken: claim.leaseToken,
    status: "proposals_created", proposalCount: 1, blockedCount: 0
  });
  assert.equal(finished.status, "proposals_created");
  assert.equal(finished.duplicate, false);
});

test("composed persistence rejects a proposal for an employee other than the UID's canonical binding", async () => {
  const db = canonicalFirestore();
  const persistence = createEmployeeScheduleEmailIngestionFirestorePersistence({ db, now: () => now });
  const idempotencyKey = "d".repeat(64);
  const claim = await persistence.claimIngestionJob({
    accountId, connectionId: "mailbox-1", provider: "gmail_api",
    messageId: "message-2", attachmentSha256, idempotencyKey
  });
  await assert.rejects(persistence.createEmployeeProposal({
    accountId, employeeId: "employee-2", employeeUid: uid, ...proposalFields,
    ingestionJobId: claim.jobId, ingestionLeaseToken: claim.leaseToken,
    ingestionFencingToken: claim.fencingToken, attachmentSha256,
    idempotencyKey: claim.jobId + "_employee-2"
  }), { code: "permission-denied" });
  assert.equal([...db.values.keys()].some(path =>
    path.startsWith(`accounts/${accountId}/employeeShiftProposals/`)), false);
});
