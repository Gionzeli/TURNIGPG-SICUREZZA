import test from "node:test";
import assert from "node:assert/strict";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createEmployeeShiftCallableHandlers } from "../src/membership/employee-shift-callable-handlers.js";

const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

test("Firestore Emulator: listOwn applies the requested date range before the 200-result bound", { skip: !enabled }, async () => {
  const app = initializeApp({ projectId: "demo-dsm-membership" }, "employee-shift-range");
  const db = getFirestore(app);
  const accountId = "synthetic-shift-range-account";
  const uid = "synthetic-shift-range-member";
  const employeeId = "synthetic-shift-range-employee";
  const root = db.doc(`accounts/${accountId}`);
  const handlers = createEmployeeShiftCallableHandlers({
    db,
    now: () => Date.UTC(2026, 5, 1),
    verifyToken: async token => token === "synthetic-token"
      ? { uid, email: "employee@example.invalid", email_verified: true }
      : null
  });
  try {
    await root.set({ accountId, status: "active", schemaVersion: 1, version: 1 });
    await db.doc(`accounts/${accountId}/members/${uid}`).set({
      uid, accountId, status: "active", validFrom: new Date(0), validUntil: null,
      role: "member", scopeType: "department", scopeIds: ["synthetic-range-department"]
    });
    await db.doc(`accounts/${accountId}/employeeBindingsByUid/${uid}`).set({
      accountId, uid, employeeId, status: "active", revision: 1
    });
    await db.doc(`accounts/${accountId}/employeeBindingsByEmployee/${employeeId}`).set({
      accountId, uid, employeeId, status: "active", revision: 1
    });
    await db.doc(`accounts/${accountId}/employees/${employeeId}`).set({
      accountId, employeeId, status: "active"
    });
    await db.doc(`accounts/${accountId}/employeeControl/${employeeId}`).set({
      accountId, employeeId, bindingRevision: 1, placementRevision: 1
    });
    await db.doc(`accounts/${accountId}/employees/${employeeId}/placements/range-placement`).set({
      accountId, employeeId, placementId: "range-placement",
      siteId: "synthetic-range-site", departmentId: "synthetic-range-department",
      validFrom: "2024-01-01", validUntil: null, revision: 1
    });
    await db.doc(`accounts/${accountId}/sites/synthetic-range-site`).set({
      accountId, siteId: "synthetic-range-site", status: "active", version: 1
    });
    await db.doc(`accounts/${accountId}/departments/synthetic-range-department`).set({
      accountId, departmentId: "synthetic-range-department",
      siteId: "synthetic-range-site", status: "active", version: 1
    });

    const collection = db.collection(`accounts/${accountId}/employeeShifts`);
    const batch = db.batch();
    for (let i = 0; i < 205; i++) {
      const date = new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10);
      batch.set(collection.doc(`historical-${String(i).padStart(3, "0")}`), {
        accountId, employeeId, date, type: "turno", status: "active",
        placementId: "range-placement", siteId: "synthetic-range-site",
        departmentId: "synthetic-range-department", revision: 1, hours: 8
      });
    }
    for (const date of ["2026-06-04", "2026-06-18"]) {
      batch.set(collection.doc(`in-range-${date}`), {
        accountId, employeeId, date, type: "turno", status: "active",
        placementId: "range-placement", siteId: "synthetic-range-site",
        departmentId: "synthetic-range-department", revision: 1, hours: 8,
        ownerUid: "must-not-leak", compensation: 9999, medicalReason: "synthetic-sensitive",
        absenceNotes: "must-not-leak", internalAudit: { actorUid: "must-not-leak" }
      });
    }
    await batch.commit();

    const result = await handlers.listOwn({
      rawRequest: { headers: { authorization: "Bearer synthetic-token" } },
      data: { accountId, fromDate: "2026-06-01", toDate: "2026-06-30" }
    });
    assert.deepEqual(result.map(item => item.date), ["2026-06-04", "2026-06-18"]);
    assert.equal(result.length, 2);
    const allowedDtoKeys = [
      "shiftId", "date", "type", "post", "start_time", "end_time", "hours",
      "is_night", "is_sunday", "is_piantonato", "is_rest_not_enjoyed",
      "has_meal_voucher", "revision"
    ];
    for (const item of result) {
      assert.ok(Object.keys(item).every(key => allowedDtoKeys.includes(key)));
      for (const requiredKey of ["shiftId", "date", "type", "hours", "revision"]) {
        assert.equal(Object.hasOwn(item, requiredKey), true);
      }
      assert.equal(Object.hasOwn(item, "ownerUid"), false);
      assert.equal(Object.hasOwn(item, "compensation"), false);
      assert.equal(Object.hasOwn(item, "medicalReason"), false);
      assert.equal(Object.hasOwn(item, "absenceNotes"), false);
      assert.equal(Object.hasOwn(item, "internalAudit"), false);
    }

    const mutationRequest = data => ({
      rawRequest: { headers: { authorization: "Bearer synthetic-token" } }, data
    });
    await assert.rejects(
      handlers.create(mutationRequest({ accountId, data: { date: "2026-06-20", type: "turno", hours: 8 } })),
      error => error.code === "failed-precondition"
    );
    await assert.rejects(
      handlers.update(mutationRequest({ accountId, shiftId: "synthetic-shift", expectedRevision: 1, changes: { hours: 7 } })),
      error => error.code === "failed-precondition"
    );
    await assert.rejects(
      handlers.delete(mutationRequest({ accountId, shiftId: "synthetic-shift", expectedRevision: 1 })),
      error => error.code === "failed-precondition"
    );
    const audit = await db.collection(`accounts/${accountId}/employeeAudit`).get();
    assert.equal(audit.size, 0);

    const proposalRequest = data => ({
      rawRequest: { headers: { authorization: "Bearer synthetic-token" } }, data
    });
    await assert.rejects(
      handlers.proposeOwn(proposalRequest({ accountId, employeeId, source: "employee_manual", changes: [{ operation: "create", shift: { date: "2026-06-22", type: "turno" } }] })),
      error => error.code === "invalid-argument",
      "client-selected Employee identity must be rejected"
    );
    await assert.rejects(
      handlers.proposeOwn(proposalRequest({ accountId, source: "employer_email", changes: [{ operation: "create", shift: { date: "2026-06-22", type: "turno" } }] })),
      error => error.code === "invalid-argument",
      "client must not claim verified employer-email provenance"
    );
    await assert.rejects(
      handlers.proposeOwn(proposalRequest({ accountId, source: "employee_manual", changes: [{ operation: "create", shift: { date: "2026-06-22", type: "turno", compensation: 123 } }] })),
      error => error.code === "invalid-argument",
      "proposal DTO must reject fields outside the shift allowlist"
    );
    const proposed = await handlers.proposeOwn(proposalRequest({
      accountId,
      source: "employee_manual",
      changes: [{ operation: "create", shift: { date: "2026-06-22", type: "turno", post: "Postazione A", start_time: "08:00", end_time: "16:00", hours: 8 } }]
    }));
    assert.equal(proposed.status, "pending");
    assert.equal(proposed.changeCount, 1);
    let proposals = await handlers.listOwnProposals(proposalRequest({ accountId }));
    assert.equal(proposals.length, 1);
    assert.equal(proposals[0].proposalId, proposed.proposalId);
    assert.equal(proposals[0].status, "pending");
    assert.equal(proposals[0].source, "employee_manual");
    assert.equal(proposals[0].canDecide, true);
    assert.equal(proposals[0].changes[0].shift.post, "Postazione A");
    const staleProposal = await handlers.proposeOwn(proposalRequest({
      accountId, source: "employee_manual",
      changes: [
        { operation: "create", shift: { date: "2026-06-23", type: "turno", hours: 6 } },
        { operation: "update", shiftId: "in-range-2026-06-04", expectedRevision: 1, changes: { hours: 7 } }
      ]
    }));
    await collection.doc("in-range-2026-06-04").update({ revision: 2 });
    await assert.rejects(
      handlers.approveOwnProposal(proposalRequest({ accountId, proposalId: staleProposal.proposalId })),
      error => error.code === "failed-precondition",
      "stale expected revision must block the whole proposal"
    );
    assert.equal((await collection.where("date", "==", "2026-06-23").get()).size, 0,
      "failed approval must not partially create shifts");

    const unverifiedEmailProposalId = "synthetic-unverified-email";
    await db.doc(`accounts/${accountId}/employeeShiftProposals/${unverifiedEmailProposalId}`).set({
      proposalId: unverifiedEmailProposalId, accountId, employeeId, proposerUid: uid,
      source: "employer_email", sourceVerified: false, status: "pending",
      createdAt: Date.UTC(2026, 5, 1), changes: [{ operation: "create", shift: { date: "2026-06-25", type: "turno" } }]
    });
    await assert.rejects(
      handlers.approveOwnProposal(proposalRequest({ accountId, proposalId: unverifiedEmailProposalId })),
      error => error.code === "failed-precondition",
      "an email proposal without verified provenance must not be approved"
    );
    const verifiedEmailProposalId = "synthetic-verified-email";
    await db.doc(`accounts/${accountId}/employeeShiftProposals/${verifiedEmailProposalId}`).set({
      proposalId: verifiedEmailProposalId, accountId, employeeId, proposerUid: uid,
      source: "employer_email", sourceVerified: true, ingestionJobId: "synthetic-ingestion-job",
      attachmentSha256: "a".repeat(64), receivedAt: Date.UTC(2026, 5, 1),
      sender: "turni@azienda.example", status: "pending", createdAt: Date.UTC(2026, 5, 1),
      changes: [{ operation: "create", shift: { date: "2026-06-25", type: "turno", post: "Reception", hours: 6 } }],
      before: [null]
    });
    const emailProposalList = await handlers.listOwnProposals(proposalRequest({ accountId }));
    const unverifiedReview = emailProposalList.find(item => item.proposalId === unverifiedEmailProposalId);
    const verifiedReview = emailProposalList.find(item => item.proposalId === verifiedEmailProposalId);
    assert.equal(unverifiedReview.source, "unverified");
    assert.equal(unverifiedReview.canDecide, false);
    assert.equal(verifiedReview.source, "employer_email");
    assert.equal(verifiedReview.canDecide, true);
    const emailApproval = await handlers.approveOwnProposal(proposalRequest({
      accountId, proposalId: verifiedEmailProposalId
    }));
    assert.equal(emailApproval.status, "approved");
    assert.equal(emailApproval.appliedCount, 1);
    const emailDecision = (await db.doc(`accounts/${accountId}/employeeShiftProposalDecisions/${verifiedEmailProposalId}`).get()).data();
    assert.equal(emailDecision.source, "employer_email");

    const approvalProposal = await handlers.proposeOwn(proposalRequest({
      accountId, source: "employee_manual",
      changes: [
        { operation: "create", shift: { date: "2026-06-24", type: "turno", post: "Postazione B", start_time: "09:00", end_time: "17:00", hours: 8 } },
        { operation: "update", shiftId: "in-range-2026-06-04", expectedRevision: 2, changes: { hours: 7 } },
        { operation: "delete", shiftId: "in-range-2026-06-18", expectedRevision: 1 }
      ]
    }));
    const approvalReview = (await handlers.listOwnProposals(proposalRequest({ accountId })))
      .find(item => item.proposalId === approvalProposal.proposalId);
    assert.equal(approvalReview.before[1].hours, 8);
    assert.equal(approvalReview.before[1].revision, 2);
    assert.equal(approvalReview.before[2].date, "2026-06-18");
    const approved = await handlers.approveOwnProposal(proposalRequest({ accountId, proposalId: approvalProposal.proposalId }));
    assert.equal(approved.status, "approved");
    assert.equal(approved.appliedCount, 3);
    const updatedShift = (await collection.doc("in-range-2026-06-04").get()).data();
    assert.equal(updatedShift.hours, 7);
    assert.equal(updatedShift.revision, 3);
    const priorRevision = (await db.doc(`accounts/${accountId}/employeeShiftRevisions/in-range-2026-06-04_2`).get()).data();
    assert.equal(priorRevision.revision, 2);
    assert.equal(priorRevision.hours, 8);
    assert.equal(Object.hasOwn(priorRevision, "compensation"), false,
      "revision snapshots must retain only the approved schedule DTO");
    const deletedShift = (await collection.doc("in-range-2026-06-18").get()).data();
    assert.equal(deletedShift.status, "deleted");
    assert.equal(deletedShift.revision, 2);
    const createdShift = (await collection.doc(approved.shiftIds[0]).get()).data();
    assert.equal(createdShift.employeeId, employeeId);
    assert.equal(createdShift.date, "2026-06-24");
    assert.equal(createdShift.post, "Postazione B");
    assert.equal(createdShift.revision, 1);
    const approvalAudit = await db.collection(`accounts/${accountId}/employeeAudit`)
      .where("proposalId", "==", approvalProposal.proposalId).get();
    assert.equal(approvalAudit.size, 3);
    const approvalDecision = (await db.doc(`accounts/${accountId}/employeeShiftProposalDecisions/${approvalProposal.proposalId}`).get()).data();
    assert.equal(approvalDecision.decision, "approved");
    assert.equal(approvalDecision.appliedShiftIds.length, 3);
    await assert.rejects(
      handlers.approveOwnProposal(proposalRequest({ accountId, proposalId: approvalProposal.proposalId })),
      error => error.code === "failed-precondition",
      "an approved proposal cannot be applied twice"
    );

    const rejected = await handlers.rejectOwnProposal(proposalRequest({ accountId, proposalId: proposed.proposalId }));
    assert.deepEqual(rejected, { proposalId: proposed.proposalId, status: "rejected" });
    proposals = await handlers.listOwnProposals(proposalRequest({ accountId }));
    assert.equal(proposals.find(item => item.proposalId === proposed.proposalId)?.status, "rejected");
    const liveSchedule = await collection.where("date", "==", "2026-06-22").get();
    assert.equal(liveSchedule.size, 0, "proposal submission/rejection must never mutate the live schedule");
  } finally {
    await db.recursiveDelete(root);
    await deleteApp(app);
  }
});
