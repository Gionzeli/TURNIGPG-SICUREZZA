import { verifyIdentity } from "../auth/verify-identity.js";
import {
  proposeCanonicalMembershipInvite,
  approveCanonicalMembershipInvite,
  claimCanonicalMembershipInvite
} from "./canonical-membership-invite-service.js";

const fail = (code, message) => { const error = new Error(message); error.code = code; throw error; };
function bearer(request) {
  const header = request?.rawRequest?.headers?.authorization;
  const match = typeof header === "string" ? /^Bearer ([^\s]+)$/i.exec(header) : null;
  if (!match) fail("unauthenticated", "Bearer ID token required.");
  return match[1];
}
function dataObject(request, keys) {
  const data = request?.data;
  if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).some(key => !keys.includes(key))) {
    fail("invalid-argument", "Callable data contains unsupported fields.");
  }
  return data;
}
export function createCanonicalMembershipInviteHandlers({ db, verifyToken, now = () => Date.now() } = {}) {
  if (!db || typeof db.doc !== "function" || typeof db.runTransaction !== "function" ||
      typeof verifyToken !== "function" || typeof now !== "function") throw new TypeError("Trusted Firestore, token verifier and clock required.");
  async function identity(request) {
    try { return await verifyIdentity(bearer(request), verifyToken); }
    catch { fail("unauthenticated", "Identity verification failed."); }
  }
  return Object.freeze({
    async propose(request) {
      const data = dataObject(request, ["accountId", "inviteId", "email", "siteId"]);
      const actor = await identity(request);
      return proposeCanonicalMembershipInvite({ db, accountId: data.accountId, inviteId: data.inviteId, email: data.email, siteId: data.siteId, actorUid: actor.uid, actorIdentity: actor, now });
    },
    async approve(request) {
      const data = dataObject(request, ["accountId", "inviteId"]);
      const actor = await identity(request);
      return approveCanonicalMembershipInvite({ db, accountId: data.accountId, inviteId: data.inviteId, actorUid: actor.uid, actorIdentity: actor, now });
    },
    async claim(request) {
      const data = dataObject(request, ["accountId", "inviteId"]);
      const actor = await identity(request);
      return claimCanonicalMembershipInvite({ db, accountId: data.accountId, inviteId: data.inviteId, actorUid: actor.uid, actorIdentity: actor, now });
    }
  });
}
