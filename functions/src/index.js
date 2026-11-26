import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { verifyIdentity } from "./auth/verify-identity.js";
import { resolveCanonicalMembership } from "./membership/membership-policy.js";
import { createEmployeeProvisioningHandlers } from "./membership/employee-provisioning-callable-handlers.js";

initializeApp();

const employeeProvisioning = createEmployeeProvisioningHandlers({
  db: getFirestore(),
  verifyToken: (token, checkRevoked) => getAuth().verifyIdToken(token, checkRevoked)
});

function callableError(error) {
  const allowed = new Set([
    "unauthenticated", "invalid-argument", "permission-denied", "not-found",
    "already-exists", "failed-precondition", "resource-exhausted"
  ]);
  if (error instanceof HttpsError) return error;
  if (allowed.has(error?.code)) return new HttpsError(error.code, error.message);
  return new HttpsError("internal", "Employee provisioning operation failed.");
}

export const health = onCall(async () => ({
  status: "ok",
  mode: "isolated-scaffold",
  identityAndMembershipResolutionImplemented: true,
  protectedDataApisImplemented: false,
  authorizationImplemented: false,
  bootstrapImplemented: false,
  employeeProvisioningCallablesImplemented: true
}));

export const resolveAuthorization = onCall(async (request) => {
  const authorization = request.rawRequest.headers.authorization ?? "";
  const match = authorization.match(/^Bearer (.+)$/i);
  if (!match) throw new HttpsError("unauthenticated", "Bearer ID token required.");
  let identity;
  try {
    identity = await verifyIdentity(match[1], (token, checkRevoked) =>
      getAuth().verifyIdToken(token, checkRevoked)
    );
  } catch {
    throw new HttpsError("unauthenticated", "Identity verification failed.");
  }
  const accountId = request.data?.accountId;
  if (typeof accountId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(accountId)) {
    throw new HttpsError("invalid-argument", "A valid accountId selector is required.");
  }
  try {
    const snapshot = await getFirestore().doc(`accounts/${accountId}/members/${identity.uid}`).get();
    if (!snapshot.exists) throw new HttpsError("permission-denied", "Active membership required.");
    const principal = resolveCanonicalMembership({ uid: identity.uid, accountId, membership: snapshot.data() });
    if (!principal) throw new HttpsError("permission-denied", "Membership is inactive or malformed.");
    return { principal, authorizationSource: "server", expiresAt: Date.now() + 5 * 60 * 1000 };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", "Authorization lookup failed.");
  }
});

export const proposeEmployeeProvisioning = onCall(async request => {
  try { return await employeeProvisioning.propose(request); }
  catch (error) { throw callableError(error); }
});

export const approveEmployeeProvisioning = onCall(async request => {
  try { return await employeeProvisioning.approve(request); }
  catch (error) { throw callableError(error); }
});

export const revokeEmployeeBinding = onCall(async request => {
  try { return await employeeProvisioning.revoke(request); }
  catch (error) { throw callableError(error); }
});
