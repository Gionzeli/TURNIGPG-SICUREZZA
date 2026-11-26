import test from "node:test";
import assert from "node:assert/strict";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createInitialEmployeePlacement, transferEmployeePlacement } from "../src/membership/employee-placement-service.js";
const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const identity = uid => ({ uid, emailVerified: true, authTime: 1, secondFactor: "totp" });
test("Firestore Emulator: Employee placement creation and transfer preserve half-open history atomically", { skip: !enabled }, async () => {
  const app = initializeApp({ projectId: "demo-dsm-membership" }, "employee-placement-service");
  const db = getFirestore(app), accountId = "synthetic-placement-account", employeeId = "employee-1";
  const account = db.doc("accounts/" + accountId);
  const employee = db.doc("accounts/" + accountId + "/employees/" + employeeId);
  const control = db.doc("accounts/" + accountId + "/employeeControl/" + employeeId);
  const placements = db.collection("accounts/" + accountId + "/employees/" + employeeId + "/placements");
  const inverseBinding = db.doc("accounts/" + accountId + "/employeeBindingsByEmployee/" + employeeId);
  const forwardBinding = db.doc("accounts/" + accountId + "/employeeBindingsByUid/admin-1");
  const loadActiveOrg = async (_tx, a, s, d) => ({ accountId: a, siteId: s, departmentId: d, status: "active", siteStatus: "active", departmentStatus: "active" });
  const authorizeActor = async (_tx, args) => { assert.equal(args.actorUid, "admin-1"); return true; };
  const common = { db, accountId, actorUid: "admin-1", actorIdentity: identity("admin-1"), employeeId, loadActiveOrg, authorizeActor, now: () => 1000 };
  try {
    await Promise.all([
      account.set({ accountId, status: "active" }),
      employee.set({ accountId, employeeId, status: "active", revision: 1 }),
      control.set({ accountId, employeeId, bindingRevision: 1, placementRevision: 0 }),
      inverseBinding.set({ accountId, employeeId, uid: "admin-1", status: "active", revision: 1 }),
      forwardBinding.set({ accountId, employeeId, uid: "admin-1", status: "active", revision: 1 })
    ]);
    await createInitialEmployeePlacement({ ...common, placementId: "placement-1", siteId: "site-1", departmentId: "dept-1", validFrom: "2026-01-01", eventId: "create-1" });
    await transferEmployeePlacement({ ...common, placementId: "placement-2", siteId: "site-2", departmentId: "dept-2", validFrom: "2026-06-01", eventId: "transfer-1", now: () => 2000 });
    const [oldSnap, nextSnap, controlSnap, audit] = await Promise.all([
      placements.doc("placement-1").get(), placements.doc("placement-2").get(), control.get(),
      db.doc("accounts/" + accountId + "/employeeAudit/placement-transfer-1").get()
    ]);
    assert.equal(oldSnap.data().validUntil, "2026-06-01");
    assert.equal(nextSnap.data().validFrom, "2026-06-01");
    assert.equal(nextSnap.data().validUntil, null);
    assert.equal(controlSnap.data().placementRevision, 2);
    assert.equal(audit.data().type, "employee.placement.transferred");
    await assert.rejects(createInitialEmployeePlacement({ ...common, placementId: "overlap", siteId: "site-1", departmentId: "dept-1", validFrom: "2026-05-01", eventId: "overlap-1" }), e => e.code === "failed-precondition");
    assert.equal((await placements.doc("overlap").get()).exists, false);
    await inverseBinding.update({ revision: 2 });
    await assert.rejects(transferEmployeePlacement({ ...common, placementId: "mismatched-binding", siteId: "site-3", departmentId: "dept-3", validFrom: "2026-07-01", eventId: "binding-mismatch", now: () => 3000 }), e => e.code === "permission-denied");
    await inverseBinding.update({ revision: 1 });
    await forwardBinding.delete();
    await assert.rejects(transferEmployeePlacement({ ...common, placementId: "missing-mirror", siteId: "site-3", departmentId: "dept-3", validFrom: "2026-07-01", eventId: "binding-missing", now: () => 3000 }), e => e.code === "permission-denied");
    await forwardBinding.set({ accountId, employeeId, uid: "admin-1", status: "active", revision: 1 });
    await placements.doc("malformed").set({ accountId, employeeId, placementId: "not-same-id", siteId: "site-1", departmentId: "dept-1", validFrom: "bad-date", validUntil: null, revision: 1 });
    await assert.rejects(transferEmployeePlacement({ ...common, placementId: "after-malformed", siteId: "site-3", departmentId: "dept-3", validFrom: "2026-07-01", eventId: "malformed-history", now: () => 3000 }), e => e.code === "failed-precondition");
  } finally {
    const snapshot = await placements.get();
    await Promise.all(snapshot.docs.map(doc => doc.ref.delete()));
    await Promise.all([account.delete(), employee.delete(), control.delete(), inverseBinding.delete(), forwardBinding.delete()]);
    const audits = await db.collection("accounts/" + accountId + "/employeeAudit").get();
    await Promise.all(audits.docs.map(doc => doc.ref.delete()));
    await deleteApp(app);
  }
});
