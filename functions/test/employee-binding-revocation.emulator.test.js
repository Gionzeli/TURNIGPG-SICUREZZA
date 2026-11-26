import test from "node:test";
import assert from "node:assert/strict";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { proposeEmployeeProvisioning, approveEmployeeProvisioning } from "../src/membership/employee-provisioning-service.js";
import { revokeEmployeeBinding } from "../src/membership/employee-binding-service.js";

const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const identity = (uid, nowMs) => ({ uid, emailVerified: true, authTime: Math.floor(nowMs / 1000), secondFactor: "totp" });

test("Firestore Emulator: Employee binding revocation updates both mirrors, control revision and audit atomically", { skip: !enabled }, async () => {
  const app = initializeApp({ projectId: "demo-dsm-membership" }, "employee-binding-revocation");
  const db = getFirestore(app), accountId = "synthetic-revoke-account";
  const admin = uid => ({ uid, accountId, status: "active", role: "admin", scopeType: "account", scopeIds: [] });
  const account = db.doc("accounts/" + accountId);
  const employee = db.doc("accounts/" + accountId + "/employees/employee-1");
  const byUid = db.doc("accounts/" + accountId + "/employeeBindingsByUid/member-1");
  const byEmployee = db.doc("accounts/" + accountId + "/employeeBindingsByEmployee/employee-1");
  const control = db.doc("accounts/" + accountId + "/employeeControl/employee-1");
  try {
    await Promise.all([
      account.set({ accountId, status: "active" }),
      db.doc("accounts/" + accountId + "/members/admin-a").set(admin("admin-a")),
      db.doc("accounts/" + accountId + "/members/admin-b").set(admin("admin-b")),
      db.doc("accounts/" + accountId + "/members/member-1").set({ uid: "member-1", accountId, status: "active", role: "member", scopeType: "department", scopeIds: ["dept-1"] })
    ]);
    await proposeEmployeeProvisioning({ db, accountId, actorUid: "admin-a", actorIdentity: identity("admin-a", 1000), proposalId: "proposal-1", targetUid: "member-1", employeeId: "employee-1", verificationRef: "manual-check-1", now: () => 1000 });
    await approveEmployeeProvisioning({ db, accountId, actorUid: "admin-b", actorIdentity: identity("admin-b", 2000), proposalId: "proposal-1", now: () => 2000 });
    const initial = await Promise.all([byUid.get(), byEmployee.get(), control.get()]);
    assert.equal(initial[0].data().revision, 1);
    assert.equal(initial[1].data().revision, 1);
    assert.equal(initial[2].data().bindingRevision, 1);
    await revokeEmployeeBinding({ db, accountId, actorUid: "admin-a", actorIdentity: identity("admin-a", 3000), employeeId: "employee-1", eventId: "revoke-1", now: () => 3000 });
    const [uidAfter, employeeAfter, controlAfter, audit] = await Promise.all([
      byUid.get(), byEmployee.get(), control.get(),
      db.doc("accounts/" + accountId + "/employeeAudit/revoke-binding-revoke-1").get()
    ]);
    assert.equal(uidAfter.data().status, "revoked");
    assert.equal(employeeAfter.data().status, "revoked");
    assert.equal(uidAfter.data().revision, 2);
    assert.equal(employeeAfter.data().revision, 2);
    assert.equal(controlAfter.data().bindingRevision, 2);
    assert.equal(audit.data().type, "employee.binding.revoked");
    await assert.rejects(revokeEmployeeBinding({
      db, accountId, actorUid: "admin-a", actorIdentity: identity("admin-a", 4000),
      employeeId: "employee-1", eventId: "revoke-2", now: () => 4000
    }), error => error.code === "failed-precondition");
  } finally {
    for (const name of ["members", "employees", "employeeBindingsByUid", "employeeBindingsByEmployee", "employeeControl", "employeeProvisioningProposals", "employeeAudit"]) {
      const snapshot = await db.collection("accounts/" + accountId + "/" + name).get();
      await Promise.all(snapshot.docs.map(doc => doc.ref.delete()));
    }
    await account.delete();
    await deleteApp(app);
  }
});
