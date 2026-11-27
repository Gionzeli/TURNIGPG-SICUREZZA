import test from "node:test";
import assert from "node:assert/strict";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { resolveOwnEmployeeFromFirestore } from "../src/membership/employee-firestore-loaders.js";

const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

test("Firestore Emulator: resolves consistent active UID↔Employee bindings without exposing document fields", { skip: !enabled }, async () => {
  const app = initializeApp({ projectId: "demo-dsm-membership" }, "employee-firestore-loaders");
  const db = getFirestore(app);
  const accountId = "synthetic-employee-account";
  const uid = "synthetic-employee-uid";
  const employeeId = "synthetic-employee-01";
  const byUid = db.doc(`accounts/${accountId}/employeeBindingsByUid/${uid}`);
  const byEmployee = db.doc(`accounts/${accountId}/employeeBindingsByEmployee/${employeeId}`);
  const account = db.doc(`accounts/${accountId}`);
  const employee = db.doc(`accounts/${accountId}/employees/${employeeId}`);
  const principal = Object.freeze({
    uid, accountId, role: "member", permissions: ["dsm:read:own-scope"]
  });
  const binding = {
    uid, accountId, employeeId, status: "active", revision: 1
  };

  try {
    await Promise.all([
      account.set({ accountId, status: "active", revision: 1 }),
      byUid.set(binding),
      byEmployee.set(binding),
      employee.set({ employeeId, accountId, status: "active", revision: 1, ccnl: "SYNTHETIC-CCNL", section: "SYNTHETIC-SECTION", level: "SYNTHETIC-LEVEL", role: "SYNTHETIC-ROLE", effective_date: "2026-01-01", basePay: 999999, iban: "SYNTHETIC-IBAN", absenceReason: "SYNTHETIC-HEALTH-DATA" })
    ]);
    const resolved = await resolveOwnEmployeeFromFirestore({ db, principal });
    assert.deepEqual(resolved, {
      uid, accountId, profileId: employeeId, bindingRevision: 1
    });

    await byEmployee.update({ employeeId: "synthetic-other-employee" });
    await assert.rejects(
      resolveOwnEmployeeFromFirestore({ db, principal }),
      error => error.code === "permission-denied"
    );

    await byEmployee.set(binding);
    await employee.update({ status: "suspended" });
    await assert.rejects(
      resolveOwnEmployeeFromFirestore({ db, principal }),
      error => error.code === "permission-denied"
    );

    await employee.update({ status: "active" });
    await account.update({ status: "suspended" });
    await assert.rejects(
      resolveOwnEmployeeFromFirestore({ db, principal }),
      error => error.code === "permission-denied"
    );
    await account.update({ status: "active" });
    await byEmployee.delete();
    await assert.rejects(
      resolveOwnEmployeeFromFirestore({ db, principal }),
      error => error.code === "permission-denied"
    );
    await byEmployee.set(binding);
    await byUid.update({ status: "revoked", revision: 2 });
    await byEmployee.update({ status: "revoked", revision: 2 });
    await assert.rejects(
      resolveOwnEmployeeFromFirestore({ db, principal }),
      error => error.code === "permission-denied"
    );
  } finally {
    await Promise.all([account.delete(), byUid.delete(), byEmployee.delete(), employee.delete()]);
    await deleteApp(app);
  }
});
