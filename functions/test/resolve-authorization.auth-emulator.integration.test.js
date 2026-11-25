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

test("Auth + Functions + Firestore Emulators: callable enforces identity, selector, membership and token revocation", {
  skip: !enabled,
  timeout: 30000
}, async () => {
  const projectId = process.env.GCLOUD_PROJECT || "demo-dsm-membership";
  const app = initializeApp({ projectId }, `auth-callable-${randomUUID()}`);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const uidSuffix = randomUUID().replaceAll("-", "").slice(0, 20);
  const accountId = `auth-test-${uidSuffix}`;
  const members = db.collection(`accounts/${accountId}/members`);
  let uid;
  let idToken;

  async function callAuthorization({ token = idToken, selector = accountId, includeAuthorization = true } = {}) {
    const headers = { "content-type": "application/json" };
    if (includeAuthorization) headers.authorization = `Bearer ${token}`;
    return fetch(
      `http://${functionsEmulator}/${projectId}/us-central1/resolveAuthorization`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ data: { accountId: selector } })
      }
    );
  }

  async function errorStatus(response) {
    const body = await response.json();
    return { status: body.error?.status, body, httpStatus: response.status };
  }

  try {
    const signUp = await fetch(
      `http://${authEmulator}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: `dsm-emulator-${uidSuffix}@example.invalid`,
          password: `Synthetic-${randomUUID()}-9a!`,
          returnSecureToken: true
        })
      }
    );
    const created = await signUp.json();
    assert.equal(signUp.ok, true, `Auth Emulator sign-up failed: ${created.error?.message || signUp.status}`);
    uid = created.localId;
    idToken = created.idToken;
    assert.equal(typeof uid, "string");
    assert.equal(typeof idToken, "string");

    const missingBearer = await callAuthorization({ includeAuthorization: false });
    assert.equal((await errorStatus(missingBearer)).status, "UNAUTHENTICATED");

    const malformedToken = await callAuthorization({ token: "not-a-firebase-id-token" });
    assert.equal((await errorStatus(malformedToken)).status, "UNAUTHENTICATED");

    const malformedSelector = await callAuthorization({ selector: "../other-account" });
    assert.equal((await errorStatus(malformedSelector)).status, "INVALID_ARGUMENT");

    const missingMembership = await callAuthorization({ selector: `${accountId}-missing` });
    assert.equal((await errorStatus(missingMembership)).status, "PERMISSION_DENIED");

    await members.doc(uid).set({
      uid,
      accountId,
      status: "active",
      role: "member",
      scopeType: "department",
      scopeIds: ["synthetic-department"],
      permissions: ["dsm:manage:account"]
    });

    const accepted = await callAuthorization();
    const acceptedBody = await accepted.json();
    assert.equal(accepted.ok, true, JSON.stringify(acceptedBody));
    assert.equal(acceptedBody.result?.principal?.uid, uid);
    assert.equal(acceptedBody.result?.principal?.accountId, accountId);
    assert.equal(acceptedBody.result?.principal?.role, "member");
    assert.deepEqual(acceptedBody.result?.principal?.permissions, ["dsm:read:own-scope"]);

    await auth.updateUser(uid, { disabled: true });
    const disabledUser = await callAuthorization();
    assert.equal(
      (await errorStatus(disabledUser)).status,
      "UNAUTHENTICATED",
      "A disabled Auth user must not retain callable access."
    );
    await auth.updateUser(uid, { disabled: false });

    await members.doc(uid).update({ status: "revoked" });
    const inactiveMembership = await callAuthorization();
    assert.equal(
      (await errorStatus(inactiveMembership)).status,
      "PERMISSION_DENIED",
      "A disabled membership must not retain callable access."
    );
    await members.doc(uid).update({ status: "active" });

    // Ensure the ID token's auth_time predates the revocation timestamp by at least one second.
    await new Promise(resolve => setTimeout(resolve, 1100));
    await auth.revokeRefreshTokens(uid);

    const rejected = await callAuthorization();
    const rejectedBody = await rejected.json();
    assert.equal(
      rejectedBody.error?.status,
      "UNAUTHENTICATED",
      `Expected revoked ID token to be rejected; got HTTP ${rejected.status}: ${JSON.stringify(rejectedBody)}`
    );
  } finally {
    if (uid) {
      await members.doc(uid).delete().catch(() => {});
      await auth.deleteUser(uid).catch(() => {});
    }
    await deleteApp(app);
  }
});
