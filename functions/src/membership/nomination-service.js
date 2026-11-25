import { validateCanonicalMembership } from "./membership-policy.js";

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const ROLES = new Set(["member", "manager", "admin"]);
const SCOPE_TYPES = new Set(["account", "site", "department"]);

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}
function validId(value) {
  return typeof value === "string" && ID_PATTERN.test(value);
}
function validRequest({ targetUid, role, scopeType, scopeIds }) {
  if (!validId(targetUid) || !ROLES.has(role) || !SCOPE_TYPES.has(scopeType)) return false;
  if (!Array.isArray(scopeIds) || scopeIds.some(id => !validId(id)) || new Set(scopeIds).size !== scopeIds.length) return false;
  if (role === "admin") return scopeType === "account" && scopeIds.length === 0;
  if (role === "manager") return scopeType === "site" && scopeIds.length > 0;
  return scopeType !== "account" && scopeIds.length > 0;
}
function requireAdmin(membership, uid, accountId) {
  const normalized = validateCanonicalMembership(membership, uid, accountId);
  if (!normalized || normalized.role !== "admin") fail("permission-denied", "Active account admin required.");
  return normalized;
}

/**
 * Creates a pending nomination. Only active canonical account admins can propose.
 * expiresAt is a required server-supplied epoch-millisecond deadline. The maximum
 * permitted lifetime remains a policy decision to settle before callable exposure.
 */
export async function createAdminNomination({ db, accountId, actorUid, nominationId, targetUid, role, scopeType, scopeIds, expiresAt, now = () => Date.now() }) {
  if (!validId(accountId) || !validId(actorUid) || !validId(nominationId) || !validRequest({ targetUid, role, scopeType, scopeIds })) fail("invalid-argument", "Invalid nomination fields.");
  const nominationRef = db.doc(`accounts/${accountId}/adminNominations/${nominationId}`);
  const actorRef = db.doc(`accounts/${accountId}/members/${actorUid}`);
  return db.runTransaction(async tx => {
    const [actorSnap, nominationSnap] = await Promise.all([tx.get(actorRef), tx.get(nominationRef)]);
    requireAdmin(actorSnap.exists ? actorSnap.data() : null, actorUid, accountId);
    if (nominationSnap.exists) fail("already-exists", "Nomination ID already used.");
    const createdAt = now();
    if (!Number.isSafeInteger(createdAt) || !Number.isSafeInteger(expiresAt) || expiresAt <= createdAt) {
      fail("invalid-argument", "A finite future nomination expiresAt timestamp is required.");
    }
    const record = { accountId, nominationId, targetUid, role, scopeType, scopeIds: [...scopeIds], status: "pending", nominatedBy: actorUid, createdAt, expiresAt };
    tx.create(nominationRef, record);
    return Object.freeze({ ...record, scopeIds: Object.freeze([...scopeIds]) });
  });
}

/** Approves a pending, unexpired nomination by a distinct active admin; writes are atomic. */
export async function approveAdminNomination({ db, accountId, actorUid, nominationId, now = () => Date.now() }) {
  if (!validId(accountId) || !validId(actorUid) || !validId(nominationId)) fail("invalid-argument", "Invalid approval selector.");
  const nominationRef = db.doc(`accounts/${accountId}/adminNominations/${nominationId}`);
  const actorRef = db.doc(`accounts/${accountId}/members/${actorUid}`);
  return db.runTransaction(async tx => {
    const [actorSnap, nominationSnap] = await Promise.all([tx.get(actorRef), tx.get(nominationRef)]);
    const actor = requireAdmin(actorSnap.exists ? actorSnap.data() : null, actorUid, accountId);
    if (!nominationSnap.exists) fail("not-found", "Nomination not found.");
    const nomination = nominationSnap.data();
    if (nomination.status !== "pending") fail("failed-precondition", "Nomination is not pending.");
    if (nomination.accountId !== accountId || nomination.nominationId !== nominationId || !validRequest(nomination)) {
      fail("failed-precondition", "Nomination fields are invalid.");
    }
    const approvedAt = now();
    if (!Number.isSafeInteger(approvedAt)) fail("failed-precondition", "Trusted clock returned an invalid approval timestamp.");
    if (!Number.isSafeInteger(nomination.expiresAt) || nomination.expiresAt <= approvedAt) {
      fail("failed-precondition", "Nomination has expired or has an invalid expiry.");
    }
    if (nomination.nominatedBy === actorUid) fail("permission-denied", "A different admin must approve.");
    const targetRef = db.doc(`accounts/${accountId}/members/${nomination.targetUid}`);
    const targetSnap = await tx.get(targetRef);
    if (targetSnap.exists && targetSnap.data()?.status === "active") fail("already-exists", "Target already has active membership.");
    const membership = { uid: nomination.targetUid, accountId, status: "active", role: nomination.role, scopeType: nomination.scopeType, scopeIds: [...nomination.scopeIds], grantedBy: nomination.nominatedBy, approvedBy: actorUid, activatedAt: approvedAt };
    if (!validateCanonicalMembership(membership, nomination.targetUid, accountId)) fail("failed-precondition", "Proposed membership violates role/scope policy.");
    tx.set(targetRef, membership);
    tx.update(nominationRef, { status: "approved", approvedBy: actorUid, approvedAt });
    return Object.freeze({ status: "approved", targetUid: nomination.targetUid, role: nomination.role, approvedBy: actor.uid });
  });
}

/**
 * Cancels a pending nomination. Policy: only its original proposer, while still
 * an active canonical account admin, may cancel. Cancellation and audit append
 * are committed in one Firestore transaction. The free-text reason must not
 * contain personal, account, or other sensitive data.
 */
export async function cancelAdminNomination({ db, accountId, actorUid, nominationId, eventId, reason, now = () => Date.now() }) {
  if (!validId(accountId) || !validId(actorUid) || !validId(nominationId) || !validId(eventId)) {
    fail("invalid-argument", "Invalid cancellation selector.");
  }
  if (typeof reason !== "string" || reason.trim().length < 1 || reason.trim().length > 500) {
    fail("invalid-argument", "Cancellation reason must be 1–500 characters.");
  }
  const cleanReason = reason.trim();
  const nominationRef = db.doc(`accounts/${accountId}/adminNominations/${nominationId}`);
  const actorRef = db.doc(`accounts/${accountId}/members/${actorUid}`);
  const auditRef = db.doc(`accounts/${accountId}/membershipAudit/${eventId}`);
  return db.runTransaction(async tx => {
    const [actorSnap, nominationSnap, auditSnap] = await Promise.all([
      tx.get(actorRef), tx.get(nominationRef), tx.get(auditRef)
    ]);
    requireAdmin(actorSnap.exists ? actorSnap.data() : null, actorUid, accountId);
    if (!nominationSnap.exists) fail("not-found", "Nomination not found.");
    const nomination = nominationSnap.data();
    if (nomination.status !== "pending") fail("failed-precondition", "Nomination is not pending.");
    if (nomination.accountId !== accountId || nomination.nominationId !== nominationId || !validRequest(nomination)) {
      fail("failed-precondition", "Nomination fields are invalid.");
    }
    if (nomination.nominatedBy !== actorUid) fail("permission-denied", "Only the proposing admin may cancel this nomination.");
    if (auditSnap.exists) fail("already-exists", "Audit event ID already used.");
    const timestamp = now();
    const audit = {
      eventId, type: "admin_nomination_cancelled", accountId, nominationId,
      actorUid, reason: cleanReason, occurredAt: timestamp
    };
    tx.update(nominationRef, {
      status: "cancelled", cancelledBy: actorUid, cancelledAt: timestamp,
      cancellationReason: cleanReason, cancellationEventId: eventId
    });
    tx.create(auditRef, audit);
    return Object.freeze({ status: "cancelled", nominationId, cancelledBy: actorUid, cancelledAt: timestamp, eventId });
  });
}
