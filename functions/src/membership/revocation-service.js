import { validateCanonicalMembership } from "./membership-policy.js";

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}
function validId(value) { return typeof value === "string" && ID_PATTERN.test(value); }

/**
 * Revokes an active canonical membership. Admin-only operation.
 * Active-admin count is transactionally read to prevent removing the last admin.
 * The caller must pass a verified UID from server-side token verification.
 */
export async function revokeMembership({ db, accountId, actorUid, targetUid, now = () => Date.now() }) {
  if (!validId(accountId) || !validId(actorUid) || !validId(targetUid)) fail("invalid-argument", "Invalid revocation selector.");
  const actorRef = db.doc(`accounts/${accountId}/members/${actorUid}`);
  const targetRef = db.doc(`accounts/${accountId}/members/${targetUid}`);
  const adminsQuery = db.collection(`accounts/${accountId}/members`).where("role", "==", "admin").where("status", "==", "active");
  return db.runTransaction(async tx => {
    const [actorSnap, targetSnap, adminsSnap] = await Promise.all([tx.get(actorRef), tx.get(targetRef), tx.get(adminsQuery)]);
    const actor = validateCanonicalMembership(actorSnap.exists ? actorSnap.data() : null, actorUid, accountId);
    if (!actor || actor.role !== "admin") fail("permission-denied", "Active canonical account admin required.");
    if (!targetSnap.exists) fail("not-found", "Membership not found.");
    const target = targetSnap.data();
    const canonicalTarget = validateCanonicalMembership(target, targetUid, accountId);
    if (!canonicalTarget) fail("failed-precondition", "Target membership is not active or canonical.");
    if (target.role === "admin" && adminsSnap.docs.length <= 1) fail("failed-precondition", "Cannot revoke the last active admin.");
    const revokedAt = now();
    tx.update(targetRef, { status: "revoked", revokedBy: actorUid, revokedAt });
    return Object.freeze({ status: "revoked", targetUid, role: target.role, revokedBy: actorUid, revokedAt });
  });
}
