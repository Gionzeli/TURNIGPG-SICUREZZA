import test from "node:test";
import assert from "node:assert/strict";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { createEmployeeScheduleEmailIngestionFirestorePersistence } from "../src/membership/employee-schedule-email-ingestion-firestore-persistence.js";

const emulatorAvailable = typeof process.env.FIRESTORE_EMULATOR_HOST === "string" &&
  process.env.FIRESTORE_EMULATOR_HOST.length > 0;

test("Firestore Emulator persists a fenced job and proposal only for the reciprocal active Employee", {
  skip: !emulatorAvailable
}, async () => {
  const projectId = process.env.GCLOUD_PROJECT || "demo-dsm-mailbox";
  const app = initializeApp({ projectId }, "schedule-ingestion-emulator-" + process.pid);
  const db = getFirestore(app);
  const suffix = process.pid + "_" + Date.now();
  const accountId = "it_account_" + suffix;
  const employeeId = "it_employee_" + suffix;
  const uid = "it_uid_" + suffix;
  const connectionId = "it_mailbox_" + suffix;
  const jobKey = "a".repeat(64);
  const attachmentSha256 = "b".repeat(64);
  const accountRef = db.doc(`accounts/${accountId}`);
  const refs = [
    accountRef,
    db.doc(`accounts/${accountId}/members/${uid}`),
    db.doc(`accounts/${accountId}/employeeBindingsByUid/${uid}`),
    db.doc(`accounts/${accountId}/employeeBindingsByEmployee/${employeeId}`),
    db.doc(`accounts/${accountId}/employees/${employeeId}`),
    db.doc(`accounts/${accountId}/employeeControl/${employeeId}`),
    db.doc(`accounts/${accountId}/employees/${employeeId}/placements/placement-1`)
  ];
  try {
    await Promise.all([
      refs[0].create({ accountId, status: "active", schemaVersion: 1, version: 1 }),
      refs[1].create({
        uid, accountId, status: "active", role: "member", scopeType: "site",
        scopeIds: ["site-1"], validFrom: Timestamp.fromMillis(1), validUntil: null
      }),
      refs[2].create({ accountId, uid, employeeId, status: "active", revision: 1 }),
      refs[3].create({ accountId, uid, employeeId, status: "active", revision: 1 }),
      refs[4].create({ accountId, employeeId, status: "active" }),
      refs[5].create({ accountId, employeeId, bindingRevision: 1 }),
      refs[6].create({
        accountId, employeeId, placementId: "placement-1", siteId: "site-1",
        departmentId: "department-1", validFrom: "2026-01-01", validUntil: null, revision: 1
      })
    ]);
    const persistence = createEmployeeScheduleEmailIngestionFirestorePersistence({ db });
    const claim = await persistence.claimIngestionJob({
      accountId, connectionId, provider: "gmail_api",
      messageId: "synthetic-message", attachmentSha256, idempotencyKey: jobKey
    });
    assert.equal(claim.duplicate, false);

    await assert.rejects(persistence.createEmployeeProposal({
      accountId, employeeId: "it_other_employee_" + suffix,
      employeeUid: uid, proposerUid: uid,
      source: "employer_email", sourceVerified: true,
      ingestionJobId: claim.jobId, ingestionLeaseToken: claim.leaseToken,
      ingestionFencingToken: claim.fencingToken, attachmentSha256,
      receivedAt: Date.now(), sender: "turni@example.test",
      idempotencyKey: claim.jobId + "_it_other_employee_" + suffix,
      changes: [{
        operation: "create",
        shift: {
          date: "2026-12-02", type: "turno", post: "B",
          start_time: "09:00", end_time: "17:00", hours: 8
        }
      }],
      before: [null]
    }), { code: "permission-denied" });

    const created = await persistence.createEmployeeProposal({
      accountId, employeeId, employeeUid: uid, proposerUid: uid,
      source: "employer_email", sourceVerified: true,
      ingestionJobId: claim.jobId, ingestionLeaseToken: claim.leaseToken,
      ingestionFencingToken: claim.fencingToken, attachmentSha256,
      receivedAt: Date.now(), sender: "turni@example.test",
      idempotencyKey: claim.jobId + "_" + employeeId,
      changes: [{
        operation: "create",
        shift: {
          date: "2026-12-01", type: "turno", post: "A",
          start_time: "08:00", end_time: "16:00", hours: 8
        }
      }],
      before: [null]
    });
    assert.equal(created.status, "pending");
    assert.equal(created.duplicate, false);

    const proposalRef = db.doc(`accounts/${accountId}/employeeShiftProposals/${created.proposalId}`);
    const proposal = (await proposalRef.get()).data();
    assert.equal(proposal.employeeId, employeeId);
    assert.equal(proposal.proposerUid, uid);
    assert.equal(proposal.status, "pending");

    const finished = await persistence.finishIngestionJob({
      accountId, jobId: claim.jobId, leaseToken: claim.leaseToken,
      status: "proposals_created", proposalCount: 1, blockedCount: 0
    });
    assert.equal(finished.status, "proposals_created");
    assert.equal((await db.doc(`accounts/${accountId}/scheduleIngestionJobs/${jobKey}`).get()).data().status, "proposals_created");
  } finally {
    const collections = [
      `accounts/${accountId}/employeeShiftProposals`,
      `accounts/${accountId}/scheduleIngestionJobs`
    ];
    for (const collectionPath of collections) {
      const snapshot = await db.collection(collectionPath).get();
      await Promise.all(snapshot.docs.map(doc => doc.ref.delete()));
    }
    await Promise.all(refs.map(ref => ref.delete()));
    await deleteApp(app);
  }
});
