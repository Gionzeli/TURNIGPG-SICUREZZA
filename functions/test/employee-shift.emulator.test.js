import test from "node:test";
import assert from "node:assert/strict";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createEmployeeShiftService } from "../src/membership/employee-shift-service.js";
const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
test("Firestore Emulator: Employee shifts bind to server-derived Employee and historical placement; writes are audited and revision-checked", { skip: !enabled }, async () => {
  const app = initializeApp({ projectId: "demo-dsm-membership" }, "employee-shift-service");
  const db = getFirestore(app), accountId = "synthetic-shift-account", shiftId = "shift-1";
  const account = db.doc("accounts/" + accountId);
  const shiftRef = db.doc("accounts/" + accountId + "/employeeShifts/" + shiftId);
  const authorizeCalls = [];
  const placement = { accountId, employeeId: "employee-1", placementId: "placement-1", siteId: "site-1", departmentId: "dept-1", validFrom: "2026-01-01", validUntil: null };
  const service = createEmployeeShiftService({
    db, now: () => 1000,
    authorizeActor: async (_tx, args) => {
      authorizeCalls.push({ operation: args.operation, employeeId: args.employeeId });
      if (args.actorUid === "other") return { employeeId: "another-employee" };
      if (args.actorUid !== "member-1" || args.operation === "delete") throw Object.assign(new Error("denied"), { code: "permission-denied" });
      return { employeeId: "employee-1" };
    },
    loadPlacementAt: async (_tx, a, e, date) => a === accountId && e === "employee-1" && date >= placement.validFrom ? placement : null
  });
  try {
    await account.set({ accountId, status: "active" });
    const created = await service.create({ accountId, actorUid: "member-1", actorIdentity: { uid: "member-1" }, shiftId, eventId: "create-1", data: { date: "2026-02-01", type: "turno", hours: 8 } });
    assert.deepEqual(created, { shiftId, employeeId: "employee-1", revision: 1, status: "active" });
    const stored = (await shiftRef.get()).data();
    assert.equal(stored.employeeId, "employee-1");
    assert.equal(stored.siteId, "site-1");
    assert.equal(stored.departmentId, "dept-1");
    assert.equal(stored.placementId, "placement-1");
    await service.update({ accountId, actorUid: "member-1", actorIdentity: { uid: "member-1" }, shiftId, eventId: "update-1", expectedRevision: 1, changes: { hours: 7.5 } });
    assert.equal((await shiftRef.get()).data().revision, 2);
    await assert.rejects(service.update({ accountId, actorUid: "member-1", actorIdentity: { uid: "member-1" }, shiftId, eventId: "stale-1", expectedRevision: 1, changes: { hours: 6 } }), e => e.code === "failed-precondition");
    await assert.rejects(service.delete({ accountId, actorUid: "member-1", actorIdentity: { uid: "member-1" }, shiftId, eventId: "delete-denied", expectedRevision: 2 }), e => e.code === "permission-denied");
    assert.equal((await shiftRef.get()).data().status, "active");
    await assert.rejects(service.update({ accountId, actorUid: "other", actorIdentity: { uid: "other" }, shiftId, eventId: "wrong-owner", expectedRevision: 2, changes: { hours: 6 } }), e => e.code === "permission-denied");
    assert.equal((await shiftRef.get()).data().revision, 2);
    assert.equal((await db.doc("accounts/" + accountId + "/employeeAudit/shift-update-1").get()).data().type, "employee.shift.updated");
    assert.equal(authorizeCalls.some(x => x.operation === "create"), true);
    assert.equal(authorizeCalls.some(x => x.operation === "update"), true);
    assert.equal(authorizeCalls.some(x => x.operation === "delete"), true);
  } finally {
    const shifts = await db.collection("accounts/" + accountId + "/employeeShifts").get();
    await Promise.all(shifts.docs.map(x => x.ref.delete()));
    const audit = await db.collection("accounts/" + accountId + "/employeeAudit").get();
    await Promise.all(audit.docs.map(x => x.ref.delete()));
    await account.delete();
    await deleteApp(app);
  }
});
