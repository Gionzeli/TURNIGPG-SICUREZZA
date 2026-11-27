import test from "node:test";
import assert from "node:assert/strict";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createOwnEmploymentProfileCallableHandlers } from "../src/membership/employee-employment-profile-callable-handlers.js";

const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
test("Firestore Emulator: own employment profile callable resolves reciprocal binding and returns only D-01 fields", { skip: !enabled }, async () => {
  const app = initializeApp({ projectId: "demo-dsm-membership" }, "own-employment-profile");
  const db = getFirestore(app);
  const accountId = "synthetic-employment-account", uid = "synthetic-employment-member";
  const employeeId = "synthetic-employment-employee";
  const root = db.doc(`accounts/${accountId}`);
  const handlers = createOwnEmploymentProfileCallableHandlers({
    db, now: () => Date.UTC(2026, 10, 27),
    verifyToken: async token => token === "synthetic-token"
      ? { uid, email: "employee@example.invalid", email_verified: true }
      : null
  });
  const request = (data = { accountId }) => ({
    rawRequest: { headers: { authorization: "Bearer synthetic-token" } }, data
  });
  try {
    await root.set({ accountId, status: "active", schemaVersion: 1, version: 1 });
    await db.doc(`accounts/${accountId}/members/${uid}`).set({
      uid, accountId, status: "active", validFrom: new Date(0), validUntil: null,
      role: "member", scopeType: "department", scopeIds: ["synthetic-department"]
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
    await db.doc(`accounts/${accountId}/employees/${employeeId}/employmentProfiles/current`).set({
      accountId, employeeId, status: "active", schemaVersion: 1, revision: 1,
      ccnl: "HV17", section: "vigilanza_armata", level: "4",
      role: "Guardia particolare giurata", effectiveDate: "2026-09-01",
      payroll: { salary: 9999 }, iban: "must-not-leak",
      health: { diagnosis: "must-not-leak" }, privateNotes: "must-not-leak"
    });

    const result = await handlers.read(request());
    assert.equal(result.employeeId, employeeId);
    assert.deepEqual(result.employmentProfile, {
      ccnl: "HV17", section: "vigilanza_armata", level: "4",
      role: "Guardia particolare giurata", effectiveDate: "2026-09-01"
    });
    const serialized = JSON.stringify(result);
    for (const secret of ["payroll", "9999", "iban", "health", "diagnosis", "privateNotes", "must-not-leak"]) {
      assert.equal(serialized.includes(secret), false);
    }

    await assert.rejects(handlers.read(request({ accountId, employeeId: "another-employee" })),
      error => error.code === "invalid-argument");
    await db.doc(`accounts/${accountId}/employeeBindingsByEmployee/${employeeId}`).update({ status: "revoked" });
    await assert.rejects(handlers.read(request()), error => error.code === "permission-denied");
  } finally {
    await db.recursiveDelete(root);
    await deleteApp(app);
  }
});

test("own employment profile callable rejects client-selected employee and extra fields", async () => {
  const app = initializeApp({ projectId: "demo-dsm-membership" }, "own-employment-profile-input");
  const db = getFirestore(app);
  const handlers = createOwnEmploymentProfileCallableHandlers({
    db, verifyToken: async () => ({ uid: "synthetic-user", email_verified: true })
  });
  try {
    await assert.rejects(handlers.read({
      rawRequest: { headers: { authorization: "Bearer synthetic-token" } },
      data: { accountId: "synthetic-account", employeeId: "other" }
    }), error => error.code === "invalid-argument");
  } finally { await deleteApp(app); }
});
