import test from "node:test";
import assert from "node:assert/strict";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createEmployeeShiftFirestoreAuthorization } from "../src/membership/employee-shift-firestore-authorization.js";

const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

test("Firestore Emulator: canonical Employee shift adapter proves self binding and active historical placement", { skip: !enabled }, async () => {
  const app = initializeApp({ projectId: "demo-dsm-membership" }, "employee-shift-authz");
  const db = getFirestore(app);
  const accountId = "synthetic-shift-authz-account";
  const uid = "synthetic-shift-member";
  const employeeId = "synthetic-shift-employee";
  const adapter = createEmployeeShiftFirestoreAuthorization({ db, now: () => Date.UTC(2026, 5, 1) });
  const root = db.doc(`accounts/${accountId}`);
  try {
    await db.recursiveDelete(root);
    await root.set({ accountId, status: "active", schemaVersion: 1, version: 1 });
    await db.doc(`accounts/${accountId}/members/${uid}`).set({
      uid, accountId, status: "active", validFrom: new Date(0), validUntil: null,
      role: "member", scopeType: "department", scopeIds: ["synthetic-shift-department"]
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
    await db.doc(`accounts/${accountId}/employees/${employeeId}/placements/synthetic-placement`).set({
      accountId, employeeId, placementId: "synthetic-placement",
      siteId: "synthetic-shift-site", departmentId: "synthetic-shift-department",
      validFrom: "2026-01-01", validUntil: null, revision: 1
    });
    await db.doc(`accounts/${accountId}/sites/synthetic-shift-site`).set({
      accountId, siteId: "synthetic-shift-site", status: "active", version: 1
    });
    await db.doc(`accounts/${accountId}/departments/synthetic-shift-department`).set({
      accountId, departmentId: "synthetic-shift-department",
      siteId: "synthetic-shift-site", status: "active", version: 1
    });

    const allowed = await db.runTransaction(tx => adapter.authorizeActor(tx, {
      accountId, actorUid: uid, operation: "create", date: "2026-02-01"
    }));
    assert.equal(allowed.employeeId, employeeId);
    assert.equal(allowed.placement.placementId, "synthetic-placement");

    await db.doc(`accounts/${accountId}/members/${uid}`).update({
      validUntil: new Date(Date.UTC(2026, 4, 31))
    });
    await assert.rejects(
      db.runTransaction(tx => adapter.authorizeActor(tx, {
        accountId, actorUid: uid, operation: "read", date: "2026-02-01"
      })),
      error => error.code === "permission-denied"
    );
    await db.doc(`accounts/${accountId}/members/${uid}`).update({ validUntil: null });

    await root.update({ status: "suspended" });
    await assert.rejects(
      db.runTransaction(tx => adapter.authorizeActor(tx, {
        accountId, actorUid: uid, operation: "read", date: "2026-02-01"
      })),
      error => error.code === "permission-denied"
    );
    await root.update({ status: "active" });

    await db.doc(`accounts/${accountId}/members/${uid}`).update({
      scopeIds: ["different-department"]
    });
    await assert.rejects(
      db.runTransaction(tx => adapter.authorizeActor(tx, {
        accountId, actorUid: uid, operation: "create", date: "2026-02-01"
      })),
      error => error.code === "permission-denied"
    );
    await db.doc(`accounts/${accountId}/members/${uid}`).update({
      scopeIds: ["synthetic-shift-department"]
    });

    await assert.rejects(
      db.runTransaction(tx => adapter.authorizeActor(tx, {
        accountId, actorUid: uid, employeeId: "client-selected-other", operation: "create", date: "2026-02-01"
      })),
      error => error.code === "permission-denied"
    );

    await db.doc(`accounts/${accountId}/members/${uid}`).update({
      role: "manager", scopeType: "site", scopeIds: ["synthetic-shift-site"]
    });
    await assert.rejects(
      db.runTransaction(tx => adapter.authorizeActor(tx, {
        accountId, actorUid: uid, operation: "read"
      })),
      error => error.code === "permission-denied"
    );

    await db.doc(`accounts/${accountId}/members/${uid}`).update({
      role: "member", scopeType: "department", scopeIds: ["synthetic-shift-department"]
    });
    await db.doc(`accounts/${accountId}/sites/synthetic-shift-site`).update({ status: "archived" });
    await assert.rejects(
      db.runTransaction(tx => adapter.authorizeActor(tx, {
        accountId, actorUid: uid, operation: "read", date: "2026-02-01"
      })),
      error => error.code === "permission-denied"
    );

    await db.doc(`accounts/${accountId}/sites/synthetic-shift-site`).update({ status: "active" });
    await db.doc(`accounts/${accountId}/employees/${employeeId}`).update({ status: "suspended" });
    await assert.rejects(
      db.runTransaction(tx => adapter.authorizeActor(tx, {
        accountId, actorUid: uid, operation: "read", date: "2026-02-01"
      })),
      error => error.code === "permission-denied"
    );
    await db.doc(`accounts/${accountId}/employees/${employeeId}`).update({ status: "active" });

    await db.doc(`accounts/${accountId}/employeeBindingsByUid/${uid}`).update({ status: "revoked", revision: 2 });
    await assert.rejects(
      db.runTransaction(tx => adapter.authorizeActor(tx, {
        accountId, actorUid: uid, operation: "read", date: "2026-02-01"
      })),
      error => error.code === "permission-denied"
    );
    await db.doc(`accounts/${accountId}/employeeBindingsByUid/${uid}`).update({ status: "active", revision: 1 });

    await db.doc(`accounts/${accountId}/employeeBindingsByEmployee/${employeeId}`).update({ revision: 2 });
    await assert.rejects(
      db.runTransaction(tx => adapter.authorizeActor(tx, {
        accountId, actorUid: uid, operation: "read", date: "2026-02-01"
      })),
      error => error.code === "permission-denied"
    );
  } finally {
    await db.recursiveDelete(root);
    await deleteApp(app);
  }
});
