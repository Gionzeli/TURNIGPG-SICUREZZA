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
    assert.equal(proposals[0].changes[0].shift.post, "Postazione A");
    const rejected = await handlers.rejectOwnProposal(proposalRequest({ accountId, proposalId: proposed.proposalId }));
    assert.deepEqual(rejected, { proposalId: proposed.proposalId, status: "rejected" });
    proposals = await handlers.listOwnProposals(proposalRequest({ accountId }));
    assert.equal(proposals[0].status, "rejected");
    const liveSchedule = await collection.where("date", "==", "2026-06-22").get();
    assert.equal(liveSchedule.size, 0, "proposal submission/rejection must never mutate the live schedule");
  } finally {
    await db.recursiveDelete(root);
    await deleteApp(app);
  }
});
