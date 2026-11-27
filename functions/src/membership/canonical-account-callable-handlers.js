import { verifyIdentity } from "../auth/verify-identity.js";
import { resolveCanonicalMembership } from "./membership-policy.js";

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function bearer(request) {
  const header = request?.rawRequest?.headers?.authorization;
  const match = typeof header === "string" ? /^Bearer ([^\s]+)$/i.exec(header) : null;
  if (!match) fail("unauthenticated", "Bearer ID token required.");
  return match[1];
}

function validAccount(account, accountId) {
  return Boolean(account && account.accountId === accountId &&
    account.status === "active" &&
    Number.isSafeInteger(account.schemaVersion) && account.schemaVersion >= 1 &&
    Number.isSafeInteger(account.version) && account.version >= 1);
}

/**
 * Returns only canonical accounts in which the verified caller has an
 * active membership. Legacy root-level /members records are never consulted.
 */
export function createCanonicalAccountCallableHandlers({ db, verifyToken, now = () => Date.now() } = {}) {
  if (!db || typeof db.collectionGroup !== "function" ||
      typeof db.doc !== "function" || typeof verifyToken !== "function" ||
      typeof now !== "function") {
    throw new TypeError("Trusted Firestore, token verifier and clock required.");
  }

  return Object.freeze({
    async listMine(request) {
      let identity;
      try {
        identity = await verifyIdentity(bearer(request), verifyToken);
      } catch {
        fail("unauthenticated", "Identity verification failed.");
      }

      const snapshot = await db.collectionGroup("members")
        .where("uid", "==", identity.uid)
        .limit(101)
        .get();
      if (snapshot.size > 100) fail("resource-exhausted", "Account membership result exceeds the safe bound.");

      const matches = [];
      for (const memberDoc of snapshot.docs) {
        const segments = String(memberDoc.ref?.path || "").split("/");
        if (segments.length !== 4 || segments[0] !== "accounts" ||
            segments[2] !== "members" || segments[3] !== identity.uid) continue;
        const accountId = segments[1];
        const membership = memberDoc.data();
        if (membership?.accountId !== accountId || membership?.uid !== identity.uid) continue;
        const principal = resolveCanonicalMembership({
          uid: identity.uid, accountId, membership, nowMs: now()
        });
        if (!principal) continue;
        const accountSnapshot = await db.doc(`accounts/${accountId}`).get();
        if (!accountSnapshot.exists || !validAccount(accountSnapshot.data(), accountId)) continue;
        matches.push(Object.freeze({
          accountId,
          role: principal.role,
          scopeType: principal.scopeType,
          scopeIds: [...principal.scopeIds],
          permissions: [...principal.permissions]
        }));
      }
      matches.sort((a, b) => a.accountId.localeCompare(b.accountId));
      return Object.freeze(matches);
    }
  });
}
