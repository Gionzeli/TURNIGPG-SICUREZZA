import test from "node:test";
import assert from "node:assert/strict";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { proposeEmployeeProvisioning, approveEmployeeProvisioning } from "../src/membership/employee-provisioning-service.js";

const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const identity = (uid, nowMs) => ({
  uid, emailVerified: true, authTime: Math.floor(nowMs / 1000), secondFactor: "totp"
});

test("Firestore Emulator: Employee provisioning requires two admins and atomically reserves both binding directions", { skip: !enabled }, async () => {
  const app = initializeApp({ projectId: "demo-dsm-membership" }, "employee-provisioning-integration");
  const db = getFirestore(app);
  const accountId = "synthetic-provisioning-account";
  const admin = uid => ({
    uid, accountId, status: "active", role: "admin", scopeType: "account", scopeIds: []
  });
  const account = db.doc(`accounts/${accountId}`);
  const proposer = db.doc(`accounts/${accountId}/members/admin-proposer`);
  const approver = db.doc(`accounts/${accountId}/members/admin-approver`);
  const member = db.doc(`accounts/${accountId}/members/member-target`);
  const proposal = db.doc(`accounts/${accountId}/employeeProvisioningProposals/proposal-1`);
  const employee = db.doc(`accounts/${accountId}/employees/employee-1`);
  const byUid = db.doc(`accounts/${accountId}/employeeBindingsByUid/member-target`);
  const byEmployee = db.doc(`accounts/${accountId}/employeeBindingsByEmployee/employee-1`);
  const audit = db.doc(`accounts/${accountId}/employeeAudit/provision-proposal-1`);
  try {
    await Promise.all([
      account.set({ accountId, status: "active" }),
      proposer.set(admin("admin-proposer")),
      approver.set(admin("admin-approver")),
      member.set({ uid: "member-target", accountId, status: "active", role: "member", scopeType: "department", scopeIds: ["dept-1"] })
    ]);
    await proposeEmployeeProvisioning({
      db, accountId, actorUid: "admin-proposer",
      actorIdentity: identity("admin-proposer", 1000),
      proposalId: "proposal-1", targetUid: "member-target",
      employeeId: "employee-1", verificationRef: "manual-check-001", now: () => 1000
    });
    await assert.rejects(
      approveEmployeeProvisioning({
        db, accountId, actorUid: "admin-proposer",
        actorIdentity: identity("admin-proposer", 2000),
        proposalId: "proposal-1", now: () => 2000
      }),
      error => error.code === "permission-denied"
    );
    await approveEmployeeProvisioning({
      db, accountId, actorUid: "admin-approver",
      actorIdentity: identity("admin-approver", 2000),
      proposalId: "proposal-1", now: () => 2000
    });
    const [employeeSnap, uidSnap, employeeBindingSnap, proposalSnap, auditSnap] = await Promise.all([
      employee.get(), byUid.get(), byEmployee.get(), proposal.get(), audit.get()
    ]);
    assert.equal(employeeSnap.data().status, "active");
    assert.equal(uidSnap.data().employeeId, "employee-1");
    assert.equal(employeeBindingSnap.data().uid, "member-target");
    assert.equal(uidSnap.data().revision, employeeBindingSnap.data().revision);
    assert.equal(proposalSnap.data().status, "approved");
    assert.equal(auditSnap.data().type, "employee.provisioned");

    await proposeEmployeeProvisioning({
      db, accountId, actorUid: "admin-proposer",
      actorIdentity: identity("admin-proposer", 3000),
      proposalId: "proposal-2", targetUid: "member-target",
      employeeId: "employee-2", verificationRef: "manual-check-002", now: () => 3000
    });
    await assert.rejects(
      approveEmployeeProvisioning({
        db, accountId, actorUid: "admin-approver",
        actorIdentity: identity("admin-approver", 4000),
        proposalId: "proposal-2", now: () => 4000
      }),
      error => error.code === "already-exists"
    );
    assert.equal((await db.doc(`accounts/${accountId}/employees/employee-2`).get()).exists, false);
  } finally {
    const collections = [
      db.collection(`accounts/${accountId}/members`),
      db.collection(`accounts/${accountId}/employees`),
      db.collection(`accounts/${accountId}/employeeBindingsByUid`),
      db.collection(`accounts/${accountId}/employeeBindingsByEmployee`),
      db.collection(`accounts/${accountId}/employeeProvisioningProposals`),
      db.collection(`accounts/${accountId}/employeeAudit`)
    ];
    for (const collection of collections) {
      const snapshot = await collection.get();
      await Promise.all(snapshot.docs.map(doc => doc.ref.delete()));
    }
    await account.delete();
    await deleteApp(app);
  }
});
