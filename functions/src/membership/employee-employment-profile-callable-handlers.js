import { verifyIdentity } from "../auth/verify-identity.js";
import { createOwnEmploymentProfileLoader } from "./employee-employment-profile-firestore-loader.js";

const ID = /^[A-Za-z0-9_-]{1,128}$/;
function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
export function createOwnEmploymentProfileCallableHandlers({ db, verifyToken, now = () => Date.now() }) {
  if (!db || typeof verifyToken !== "function") throw new TypeError("Trusted Firestore and token verifier required.");
  const loader = createOwnEmploymentProfileLoader({ db, now });
  return Object.freeze({
    async read(request) {
      const data = request?.data;
      if (!data || typeof data !== "object" || Array.isArray(data) ||
          Object.keys(data).some(key => key !== "accountId") ||
          typeof data.accountId !== "string" || !ID.test(data.accountId)) {
        fail("invalid-argument", "Only a valid accountId selector is accepted.");
      }
      const header = request?.rawRequest?.headers?.authorization;
      const match = typeof header === "string" ? /^Bearer ([^\s]+)$/i.exec(header) : null;
      if (!match) fail("unauthenticated", "Bearer ID token required.");
      let identity;
      try { identity = await verifyIdentity(match[1], verifyToken); }
      catch { fail("unauthenticated", "Identity verification failed."); }
      return loader.read({ accountId: data.accountId, uid: identity.uid });
    }
  });
}
