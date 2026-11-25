import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { verifyIdentity } from "./auth/verify-identity.js";

initializeApp();

export const health = onCall(async () => ({
  status: "ok",
  mode: "isolated-scaffold",
  authorizationImplemented: false
}));

// Deliberately fail closed: membership and authorization are not implemented yet.
export const resolveAuthorization = onCall(async (request) => {
  const authorization = request.rawRequest.headers.authorization ?? "";
  const match = authorization.match(/^Bearer (.+)$/i);
  if (!match) throw new HttpsError("unauthenticated", "Bearer ID token required.");

  try {
    await verifyIdentity(match[1], (token, checkRevoked) =>
      getAuth().verifyIdToken(token, checkRevoked)
    );
  } catch {
    throw new HttpsError("unauthenticated", "Identity verification failed.");
  }
  throw new HttpsError("failed-precondition", "Authorization resolution is not implemented.");
});
