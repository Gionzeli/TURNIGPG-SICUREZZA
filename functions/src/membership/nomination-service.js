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

/** Creates a pending nomination. Only active canonical account admins can propose. */
export async function createAdminNomination({ db, accountId, actorUid, nominationId, targetUid, role, scopeType, scopeIds, now = () => Date.now() }) {
  if (!validId(accountId) || !validId(actorUid) || !validId(nominationId) || !validRequest({ targetUid, role, scopeType, scopeIds })) fail("invalid-argument", "Invalid nomination fields.");
  const nominationRef = db.doc(`accounts/${accountId}/adminNominations/${nominationId}`);
  const actorRef = db.doc(`accounts/${accountId}/members/${actorUid}`);
  return db.runTransaction(async tx => {
    const [actorSnap, nominationSnap] = await Promise.all([tx.get(actorRef), tx.get(nominationRef)]);
    requireAdmin(actorSnap.exists ? actorSnap.data() : null, actorUid, accountId);
    if (nominationSnap.exists) fail("already-exists", "Nomination ID already used.");
    const record = { accountId, nominationId, targetUid, role, scopeType, scopeIds: [...scopeIds], status: "pending", nominatedBy: actorUid, createdAt: now() };
    tx.create(nominationRef, record);
    return Object.freeze({ ...record, scopeIds: Object.freeze([...scopeIds]) });
  });
}

/** Approves a pending nomination by a distinct active admin; approval and membership write are atomic. */
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
    if (nomination.nominatedBy === actorUid) fail("permission-denied", "A different admin must approve.");
    if (!validRequest(nomination)) fail("failed-precondition", "Nomination fields are invalid.");
    const targetRef = db.doc(`accounts/${accountId}/members/${nomination.targetUid}`);
    const targetSnap = await tx.get(targetRef);
    if (targetSnap.exists && targetSnap.data()?.status === "active") fail("already-exists", "Target already has active membership.");
    const membership = { uid: nomination.targetUid, accountId, status: "active", role: nomination.role, scopeType: nomination.scopeType, scopeIds: [...nomination.scopeIds], grantedBy: nomination.nominatedBy, approvedBy: actorUid, activatedAt: now() };
    if (!validateCanonicalMembership(membership, nomination.targetUid, accountId)) fail("failed-precondition", "Proposed membership violates role/scope policy.");
    tx.set(targetRef, membership);
    tx.update(nominationRef, { status: "approved", approvedBy: actorUid, approvedAt: now() });
    return Object.freeze({ status: "approved", targetUid: nomination.targetUid, role: nomination.role, approvedBy: actor.uid });
  });
}
