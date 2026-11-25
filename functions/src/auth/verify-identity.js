/**
 * Verifies a Firebase ID token and checks revocation.
 * The Firebase Admin verifier is injected to keep unit tests deterministic.
 */
export async function verifyIdentity(idToken, verifyIdToken) {
  if (typeof idToken !== "string" || idToken.trim() === "") {
    const error = new Error("Missing bearer ID token");
    error.code = "unauthenticated";
    throw error;
  }
  if (typeof verifyIdToken !== "function") {
    throw new TypeError("A trusted token verifier is required");
  }

  const claims = await verifyIdToken(idToken, true); // checkRevoked=true
  if (!claims || typeof claims.uid !== "string" || claims.uid.length === 0) {
    const error = new Error("Token verification returned no UID");
    error.code = "unauthenticated";
    throw error;
  }
  if (claims.email_verified !== true) {
    const error = new Error("Verified email required");
    error.code = "unauthenticated";
    throw error;
  }
  return Object.freeze({ uid: claims.uid, email: claims.email ?? null, emailVerified: true, authTime: Number.isSafeInteger(claims.auth_time) ? claims.auth_time : null, secondFactor: typeof claims.firebase?.sign_in_second_factor === "string" ? claims.firebase.sign_in_second_factor : null });
}
