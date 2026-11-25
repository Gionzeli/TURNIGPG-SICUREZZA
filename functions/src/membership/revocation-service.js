import { validateCanonicalMembership } from "./membership-policy.js";

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}
function validId(value) { return typeof value === "string" && ID_PATTERN.test(value); }

/**
 * Revokes an active canonical membership and appends an audit event atomically.
 * actorUid must come from a verified, revocation-checked identity token.
 * eventId is a caller-supplied unique event selector, not an idempotency key or authority claim; duplicate IDs are rejected.
 */
export async function revokeMembership({ db, accountId, actorUid, targetUid, eventId, now = () => Date.now() }) {
  if (!validId(accountId) || !validId(actorUid) || !validId(targetUid) || !validId(eventId)) {
    fail("invalid-argument", "Invalid revocation selector.");
  }
  const actorRef = db.doc(`accounts/${accountId}/members/${actorUid}`);
  const targetRef = db.doc(`accounts/${accountId}/members/${targetUid}`);
  const eventRef = db.doc(`accounts/${accountId}/membershipAudit/${eventId}`);
  const adminsQuery = db.collection(`accounts/${accountId}/members`)
    .where("role", "==", "admin")
    .where("status", "==", "active");

  return db.runTransaction(async tx => {
    const [actorSnap, targetSnap, adminsSnap, eventSnap] = await Promise.all([
      tx.get(actorRef), tx.get(targetRef), tx.get(adminsQuery), tx.get(eventRef)
    ]);
    const actor = validateCanonicalMembership(actorSnap.exists ? actorSnap.data() : null, actorUid, accountId);
    if (!actor || actor.role !== "admin") fail("permission-denied", "Active canonical account admin required.");
    if (!targetSnap.exists) fail("not-found", "Membership not found.");
    if (eventSnap.exists) fail("already-exists", "Audit event ID already used.");

    const target = targetSnap.data();
    const canonicalTarget = validateCanonicalMembership(target, targetUid, accountId);
    if (!canonicalTarget) fail("failed-precondition", "Target membership is not active or canonical.");

    // Count only fully valid active account admins; malformed documents never preserve admin availability.
    const activeAdminUids = new Set();
    for (const doc of adminsSnap.docs) {
      const data = doc.data();
      const candidateUid = data?.uid;
      const canonical = validateCanonicalMembership(data, candidateUid, accountId);
      if (canonical?.role === "admin" && canonical.scopeType === "account" && canonical.scopeIds.length === 0) {
        activeAdminUids.add(candidateUid);
      }
    }
    if (target.role === "admin" && activeAdminUids.size <= 1) {
      fail("failed-precondition", "Cannot revoke the last active canonical admin.");
    }

    const revokedAt = now();
    const auditEvent = Object.freeze({
      eventId, type: "membership.revoked", accountId, targetUid,
      targetRole: target.role, actorUid, occurredAt: revokedAt
    });
    tx.update(targetRef, { status: "revoked", revokedBy: actorUid, revokedAt });
    tx.create(eventRef, auditEvent);
    return Object.freeze({ status: "revoked", targetUid, role: target.role, revokedBy: actorUid, revokedAt, eventId });
  });
}
