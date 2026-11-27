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

test("Auth + Functions + Firestore Emulators: own employment profile callable enforces verified identity, reciprocal Employee binding and DTO allowlist", {
  skip: !enabled,
  timeout: 30000
}, async () => {
  const projectId = process.env.GCLOUD_PROJECT || "demo-dsm-membership";
  const app = initializeApp({ projectId }, `own-employment-profile-${randomUUID()}`);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const suffix = randomUUID().replaceAll("-", "").slice(0, 20);
  const accountId = `employment-profile-${suffix}`;
  const employeeId = `employee-${suffix}`;
  const email = `employment-profile-${suffix}@example.invalid`;
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

  async function callProfile(token, data = { accountId }) {
    return fetch(
      `http://${functionsEmulator}/${projectId}/us-central1/readOwnEmployeeEmploymentProfile`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ data })
      }
    );
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
    assert.equal(typeof uid, "string");

    await accountRef.set({
      accountId, status: "active", schemaVersion: 1, version: 1
    });
    await db.doc(`accounts/${accountId}/members/${uid}`).set({
      uid, accountId, status: "active", validFrom: new Date(0), validUntil: null,
      role: "member", scopeType: "department", scopeIds: [`department-${suffix}`]
    });
    await db.doc(`accounts/${accountId}/employeeBindingsByUid/${uid}`).set({
      accountId, uid, employeeId, status: "active", revision: 1
    });
    await db.doc(`accounts/${accountId}/employeeBindingsByEmployee/${employeeId}`).set({
      accountId, uid, employeeId, status: "active", revision: 1
    });
    await db.doc(`accounts/${accountId}/employees/${employeeId}`).set({
      accountId, employeeId, status: "active", revision: 1
    });
    await db.doc(`accounts/${accountId}/employees/${employeeId}/employmentProfiles/current`).set({
      accountId, employeeId, status: "active", schemaVersion: 1, revision: 1,
      ccnl: "HV17", section: "vigilanza_armata", level: "4",
      role: "Guardia particolare giurata", effectiveDate: "2026-09-01",
      payroll: { salary: 9999 }, iban: "must-not-leak",
      health: { diagnosis: "must-not-leak" }, privateNotes: "must-not-leak"
    });

    const unverifiedToken = await signIn();
    const unverified = await callProfile(unverifiedToken);
    assert.equal((await errorStatus(unverified)).status, "UNAUTHENTICATED");

    await auth.updateUser(uid, { emailVerified: true });
    const verifiedToken = await signIn();

    const invalidSelector = await callProfile(verifiedToken, { accountId, employeeId: "client-selected" });
    assert.equal((await errorStatus(invalidSelector)).status, "INVALID_ARGUMENT");

    const accepted = await callProfile(verifiedToken);
    const acceptedBody = await accepted.json();
    assert.equal(accepted.ok, true, JSON.stringify(acceptedBody));
    assert.deepEqual(acceptedBody.result, {
      employeeId,
      employmentProfile: {
        ccnl: "HV17",
        section: "vigilanza_armata",
        level: "4",
        role: "Guardia particolare giurata",
        effectiveDate: "2026-09-01"
      }
    });
    const serialized = JSON.stringify(acceptedBody.result);
    for (const secret of ["payroll", "9999", "iban", "health", "diagnosis", "privateNotes", "must-not-leak"]) {
      assert.equal(serialized.includes(secret), false, `Sensitive field leaked: ${secret}`);
    }

    await db.doc(`accounts/${accountId}/employeeBindingsByEmployee/${employeeId}`).update({ status: "revoked" });
    const revokedBinding = await callProfile(verifiedToken);
    assert.equal((await errorStatus(revokedBinding)).status, "PERMISSION_DENIED");
  } finally {
    await db.recursiveDelete(accountRef).catch(() => {});
    if (uid) await auth.deleteUser(uid).catch(() => {});
    await deleteApp(app);
  }
});
