import { validateCanonicalMembership } from "./membership-policy.js";

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_LIFETIME_MS = 24 * 60 * 60 * 1000;
const MFA_WINDOW_SECONDS = 5 * 60;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}
function validId(value) { return typeof value === "string" && ID.test(value); }

function requireRecentAdmin(membership, uid, accountId, identity, nowMs) {
  if (!Number.isSafeInteger(nowMs) || !identity || identity.uid !== uid ||
      identity.emailVerified !== true || !Number.isSafeInteger(identity.authTime)) {
    fail("permission-denied", "A verified recent TOTP admin identity is required.");
  }
  const age = Math.floor(nowMs / 1000) - identity.authTime;
  if (age < 0 || age > MFA_WINDOW_SECONDS || identity.secondFactor !== "totp") {
    fail("permission-denied", "A verified recent TOTP admin identity is required.");
  }
  const normalized = validateCanonicalMembership(membership, uid, accountId);
  if (!normalized || normalized.role !== "admin") {
    fail("permission-denied", "An active canonical account admin is required.");
  }
}

/**
 * Manual two-person Employee provisioning. actorIdentity MUST be produced by
 * verifyIdentity() after Firebase token verification with checkRevoked=true.
 * verificationRef is an opaque out-of-band verification ticket, never a
 * personal identifier or a substitute for the human verification process.
 */
export async function proposeEmployeeProvisioning({
  db, accountId, actorUid, actorIdentity, proposalId, targetUid, employeeId,
  verificationRef, now = () => Date.now()
}) {
  if (![accountId, actorUid, proposalId, targetUid, employeeId, verificationRef].every(validId)) {
    fail("invalid-argument", "Invalid Employee provisioning proposal.");
  }
  const accountRef = db.doc(`accounts/${accountId}`);
  const actorRef = db.doc(`accounts/${accountId}/members/${actorUid}`);
  const proposalRef = db.doc(`accounts/${accountId}/employeeProvisioningProposals/${proposalId}`);
  return db.runTransaction(async tx => {
    const [accountSnap, actorSnap, proposalSnap] = await Promise.all([
      tx.get(accountRef), tx.get(actorRef), tx.get(proposalRef)
    ]);
    const createdAt = now();
    if (!accountSnap.exists || accountSnap.data().status !== "active") {
      fail("failed-precondition", "Active account required.");
    }
    requireRecentAdmin(actorSnap.exists ? actorSnap.data() : null, actorUid, accountId, actorIdentity, createdAt);
    if (proposalSnap.exists) fail("already-exists", "Provisioning proposal ID already used.");
    const expiresAt = createdAt + MAX_LIFETIME_MS;
    if (!Number.isSafeInteger(expiresAt)) fail("failed-precondition", "Invalid trusted expiry.");
    const record = {
      accountId, proposalId, targetUid, employeeId, verificationRef,
      status: "pending", proposedBy: actorUid, createdAt, expiresAt
    };
    tx.create(proposalRef, record);
    return Object.freeze({ proposalId, targetUid, employeeId, status: "pending", expiresAt });
  });
}

/**
 * A distinct active account admin with recent verified TOTP approves.
 * Employee creation, both unique binding reservations, proposal transition
 * and audit append commit atomically. No silent overwrite or rebinding.
 */
export async function approveEmployeeProvisioning({
  db, accountId, actorUid, actorIdentity, proposalId,
  now = () => Date.now()
}) {
  if (![accountId, actorUid, proposalId].every(validId)) {
    fail("invalid-argument", "Invalid Employee provisioning approval.");
  }
  const accountRef = db.doc(`accounts/${accountId}`);
  const actorRef = db.doc(`accounts/${accountId}/members/${actorUid}`);
  const proposalRef = db.doc(`accounts/${accountId}/employeeProvisioningProposals/${proposalId}`);
  return db.runTransaction(async tx => {
    const [accountSnap, actorSnap, proposalSnap] = await Promise.all([
      tx.get(accountRef), tx.get(actorRef), tx.get(proposalRef)
    ]);
    const approvedAt = now();
    if (!accountSnap.exists || accountSnap.data().status !== "active") {
      fail("failed-precondition", "Active account required.");
    }
    requireRecentAdmin(actorSnap.exists ? actorSnap.data() : null, actorUid, accountId, actorIdentity, approvedAt);
    if (!proposalSnap.exists) fail("not-found", "Provisioning proposal not found.");
    const proposal = proposalSnap.data();
    if (proposal.accountId !== accountId || proposal.proposalId !== proposalId ||
        proposal.status !== "pending" || !validId(proposal.targetUid) ||
        !validId(proposal.employeeId) || !validId(proposal.proposedBy) ||
        !validId(proposal.verificationRef) || !Number.isSafeInteger(proposal.createdAt) ||
        !Number.isSafeInteger(proposal.expiresAt) ||
        proposal.expiresAt !== proposal.createdAt + MAX_LIFETIME_MS ||
        proposal.createdAt > approvedAt || proposal.expiresAt <= approvedAt) {
      fail("failed-precondition", "Provisioning proposal is invalid, expired or no longer pending.");
    }
    if (proposal.proposedBy === actorUid) fail("permission-denied", "A different admin must approve.");
    const proposerRef = db.doc(`accounts/${accountId}/members/${proposal.proposedBy}`);
    const targetMemberRef = db.doc(`accounts/${accountId}/members/${proposal.targetUid}`);
    const employeeRef = db.doc(`accounts/${accountId}/employees/${proposal.employeeId}`);
    const byUidRef = db.doc(`accounts/${accountId}/employeeBindingsByUid/${proposal.targetUid}`);
    const byEmployeeRef = db.doc(`accounts/${accountId}/employeeBindingsByEmployee/${proposal.employeeId}`);
    const auditRef = db.doc(`accounts/${accountId}/employeeAudit/provision-${proposalId}`);
    const [proposerSnap, memberSnap, employeeSnap, byUidSnap, byEmployeeSnap, auditSnap] = await Promise.all([
      tx.get(proposerRef), tx.get(targetMemberRef), tx.get(employeeRef),
      tx.get(byUidRef), tx.get(byEmployeeRef), tx.get(auditRef)
    ]);
    const proposer = proposerSnap.exists
      ? validateCanonicalMembership(proposerSnap.data(), proposal.proposedBy, accountId) : null;
    const member = memberSnap.exists
      ? validateCanonicalMembership(memberSnap.data(), proposal.targetUid, accountId) : null;
    if (!proposer || proposer.role !== "admin") fail("failed-precondition", "Proposing admin is no longer active.");
    if (!member || member.role !== "member") fail("failed-precondition", "Target must have an active canonical member account.");
    if (employeeSnap.exists || byUidSnap.exists || byEmployeeSnap.exists) {
      fail("already-exists", "Employee or UID binding is already reserved; explicit revocation is required before rebinding.");
    }
    if (auditSnap.exists) fail("already-exists", "Provisioning audit event already exists.");
    const revision = 1;
    tx.create(employeeRef, {
      accountId, employeeId: proposal.employeeId, status: "active",
      revision, createdAt: approvedAt, createdBy: proposal.proposedBy,
      approvedBy: actorUid
    });
    const binding = {
      accountId, uid: proposal.targetUid, employeeId: proposal.employeeId,
      status: "active", revision, createdAt: approvedAt,
      createdBy: proposal.proposedBy, approvedBy: actorUid
    };
    tx.create(byUidRef, binding);
    tx.create(byEmployeeRef, binding);
    tx.update(proposalRef, { status: "approved", approvedBy: actorUid, approvedAt });
    tx.create(auditRef, {
      eventId: `provision-${proposalId}`, type: "employee.provisioned",
      accountId, employeeId: proposal.employeeId, targetUid: proposal.targetUid,
      actorUid, proposedBy: proposal.proposedBy, occurredAt: approvedAt, revision
    });
    return Object.freeze({
      status: "approved", accountId, employeeId: proposal.employeeId,
      uid: proposal.targetUid, revision, approvedBy: actorUid
    });
  });
}
