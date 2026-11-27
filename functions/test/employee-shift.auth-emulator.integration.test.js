import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const authEmulator = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const firestoreEmulator = process.env.FIRESTORE_EMULATOR_HOST;
const functionsEmulator = process.env.DSM_FUNCTIONS_EMULATOR_HOST;
const enabled = Boolean(authEmulator && firestoreEmulator && functionsEmulator);

test("Auth + Functions + Firestore Emulators: own shift date-range callable enforces identity, placement scope, DTO allowlist and disabled direct mutations", {
  skip: !enabled,
  timeout: 30000
}, async () => {
  const projectId = process.env.GCLOUD_PROJECT || "demo-dsm-membership";
  const app = initializeApp({ projectId }, `own-employee-shifts-${randomUUID()}`);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const suffix = randomUUID().replaceAll("-", "").slice(0, 20);
  const accountId = `own-shifts-${suffix}`;
  const employeeId = `employee-${suffix}`;
  const departmentId = `department-${suffix}`;
  const siteId = `site-${suffix}`;
  const placementId = `placement-${suffix}`;
  const email = `own-shifts-${suffix}@example.invalid`;
  const password = `Synthetic-${randomUUID()}-9a!`;
  const accountRef = db.doc(`accounts/${accountId}`);
  let uid;

  async function signIn() {
    const response = await fetch(
      `http://${authEmulator}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, returnSecureToken: true })
      }
    );
    const body = await response.json();
    assert.equal(response.ok, true, `Auth Emulator sign-in failed: ${body.error?.message || response.status}`);
    return body.idToken;
  }

  async function callFunction(name, token, data) {
    return fetch(`http://${functionsEmulator}/${projectId}/us-central1/${name}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ data })
    });
  }

  async function errorStatus(response) {
    const body = await response.json();
    return { status: body.error?.status, body };
  }

  try {
    const signUp = await fetch(
      `http://${authEmulator}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, returnSecureToken: true })
      }
    );
    const created = await signUp.json();
    assert.equal(signUp.ok, true, `Auth Emulator sign-up failed: ${created.error?.message || signUp.status}`);
    uid = created.localId;

    await auth.updateUser(uid, { emailVerified: true });
    const idToken = await signIn();

    await accountRef.set({ accountId, status: "active", schemaVersion: 1, version: 1 });
    await db.doc(`accounts/${accountId}/members/${uid}`).set({
      uid, accountId, status: "active", validFrom: new Date(0), validUntil: null,
      role: "member", scopeType: "department", scopeIds: [departmentId]
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
    await db.doc(`accounts/${accountId}/employees/${employeeId}/placements/${placementId}`).set({
      accountId, employeeId, placementId, siteId, departmentId,
      validFrom: "2024-01-01", validUntil: null, revision: 1
    });
    await db.doc(`accounts/${accountId}/sites/${siteId}`).set({
      accountId, siteId, status: "active", version: 1
    });
    await db.doc(`accounts/${accountId}/departments/${departmentId}`).set({
      accountId, departmentId, siteId, status: "active", version: 1
    });

    const shifts = db.collection(`accounts/${accountId}/employeeShifts`);
    await Promise.all([
      shifts.doc("in-range-1").set({
        accountId, employeeId, date: "2026-06-04", type: "turno", status: "active",
        placementId, siteId, departmentId, revision: 1, hours: 8, post: "Postazione sintetica",
        ownerUid: "must-not-leak", compensation: 9999, medicalReason: "must-not-leak",
        absenceNotes: "must-not-leak", internalAudit: { actorUid: "must-not-leak" }
      }),
      shifts.doc("in-range-2").set({
        accountId, employeeId, date: "2026-06-18", type: "turno", status: "active",
        placementId, siteId, departmentId, revision: 1, hours: 6
      }),
      shifts.doc("out-of-range").set({
        accountId, employeeId, date: "2026-07-01", type: "turno", status: "active",
        placementId, siteId, departmentId, revision: 1, hours: 8
      })
    ]);

    const response = await callFunction("listOwnEmployeeShifts", idToken, {
      accountId, fromDate: "2026-06-01", toDate: "2026-06-30"
    });
    const body = await response.json();
    assert.equal(response.ok, true, JSON.stringify(body));
    assert.deepEqual(body.result.map(item => item.date), ["2026-06-04", "2026-06-18"]);
    assert.equal(body.result[0].post, "Postazione sintetica");
    const serialized = JSON.stringify(body.result);
    for (const secret of ["ownerUid", "compensation", "9999", "medicalReason", "absenceNotes", "internalAudit", "must-not-leak"]) {
      assert.equal(serialized.includes(secret), false, `Sensitive shift field leaked: ${secret}`);
    }

    const selectedEmployee = await callFunction("listOwnEmployeeShifts", idToken, {
      accountId, employeeId, fromDate: "2026-06-01", toDate: "2026-06-30"
    });
    assert.equal((await errorStatus(selectedEmployee)).status, "INVALID_ARGUMENT");

    const directCreate = await callFunction("createOwnEmployeeShift", idToken, {
      accountId, data: { date: "2026-06-20", type: "turno", hours: 8 }
    });
    assert.equal((await errorStatus(directCreate)).status, "FAILED_PRECONDITION");

    const directUpdate = await callFunction("updateOwnEmployeeShift", idToken, {
      accountId, shiftId: "in-range-1", expectedRevision: 1, changes: { hours: 7 }
    });
    assert.equal((await errorStatus(directUpdate)).status, "FAILED_PRECONDITION");

    const directDelete = await callFunction("deleteOwnEmployeeShift", idToken, {
      accountId, shiftId: "in-range-1", expectedRevision: 1
    });
    assert.equal((await errorStatus(directDelete)).status, "FAILED_PRECONDITION");

    const unchanged = (await shifts.doc("in-range-1").get()).data();
    assert.equal(unchanged.hours, 8);
    assert.equal(unchanged.revision, 1);
    assert.equal((await db.collection(`accounts/${accountId}/employeeAudit`).get()).size, 0);
  } finally {
    await db.recursiveDelete(accountRef).catch(() => {});
    if (uid) await auth.deleteUser(uid).catch(() => {});
    await deleteApp(app);
  }
});
