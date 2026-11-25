import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { verifyIdentity } from "./auth/verify-identity.js";

initializeApp();

export const health = onCall({ enforceAppCheck: false }, async () => ({
  status: "ok",
  mode: "isolated-scaffold",
  authorizationImplemented: false
}));

// Deliberately fail closed: membership and authorization are not implemented yet.
export const resolveAuthorization = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  try {
    await verifyIdentity(request.auth.token, async () => request.auth.token);
  } catch {
    throw new HttpsError("unauthenticated", "Identity verification failed.");
  }
  throw new HttpsError("failed-precondition", "Authorization resolution is not implemented.");
});
