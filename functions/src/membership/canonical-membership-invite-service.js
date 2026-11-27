import { createHash } from "node:crypto";
import { validateCanonicalMembership } from "./membership-policy.js";

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LIFETIME = 24 * 60 * 60 * 1000;
const MFA_WINDOW = 300;
const fail = (code, message) => { const e = new Error(message); e.code = code; throw e; };
const validId = value => typeof value === "string" && ID.test(value);
const emailDigest = value => createHash("sha256").update(value.trim().toLowerCase()).digest("hex");

function requireAdmin(membership, uid, accountId, identity, nowMs) {
  if (!identity || identity.uid !== uid || identity.emailVerified !== true ||
      !Number.isSafeInteger(identity.authTime) || identity.secondFactor !== "totp") {
    fail("permission-denied", "Recent verified TOTP admin identity required.");
  }
  const age = Math.floor(nowMs / 1000) - identity.authTime;
  const principal = validateCanonicalMembership(membership, uid, accountId, nowMs);
  if (age < 0 || age > MFA_WINDOW || !principal || principal.role !== "admin") {
    fail("permission-denied", "Recent active account admin required.");
  }
}

/** Two-person invitation approval; raw email is never persisted. */
export async function proposeCanonicalMembershipInvite({ db, accountId, actorUid, actorIdentity, inviteId, email, siteId, now = () => Date.now() }) {
  if (!validId(accountId) || !validId(actorUid) || !validId(inviteId) || !validId(siteId) ||
      typeof email !== "string" || email.length > 254 || !EMAIL.test(email.trim())) {
    fail("invalid-argument", "A valid account, invite ID and email are required.");
  }
  const accountRef = db.doc(`accounts/${accountId}`);
  const actorRef = db.doc(`accounts/${accountId}/members/${actorUid}`);
  const siteRef = db.doc(`accounts/${accountId}/sites/${siteId}`);
  const inviteRef = db.doc(`accounts/${accountId}/membershipInviteProposals/${inviteId}`);
  return db.runTransaction(async tx => {
    const [account, actor, site, existing] = await Promise.all([tx.get(accountRef), tx.get(actorRef), tx.get(siteRef), tx.get(inviteRef)]);
    const createdAt = now();
    if (!account.exists || account.data().accountId !== accountId || account.data().status !== "active" || !Number.isSafeInteger(account.data().schemaVersion) || account.data().schemaVersion < 1 || !Number.isSafeInteger(account.data().version) || account.data().version < 1) fail("failed-precondition", "Active canonical account required.");
    requireAdmin(actor.exists ? actor.data() : null, actorUid, accountId, actorIdentity, createdAt);
    if (!site.exists || site.data().accountId !== accountId || site.data().siteId !== siteId || site.data().status !== "active" || !Number.isSafeInteger(site.data().version) || site.data().version < 1) fail("failed-precondition", "Active site in this account required.");
    if (existing.exists) fail("already-exists", "Invite ID already used.");
    const expiresAt = createdAt + LIFETIME;
    tx.create(inviteRef, {
      accountId, inviteId, emailDigest: emailDigest(email), role: "member",
      scopeType: "site", scopeIds: [siteId], status: "pending",
      proposedBy: actorUid, createdAt, expiresAt
    });
    return Object.freeze({ inviteId, status: "pending", expiresAt });
  });
}

/** A different current admin approves. This creates no membership and grants no access. */
export async function approveCanonicalMembershipInvite({ db, accountId, actorUid, actorIdentity, inviteId, now = () => Date.now() }) {
  if (![accountId, actorUid, inviteId].every(validId)) fail("invalid-argument", "Invalid invite approval selector.");
  const accountRef = db.doc(`accounts/${accountId}`);
  const actorRef = db.doc(`accounts/${accountId}/members/${actorUid}`);
  const inviteRef = db.doc(`accounts/${accountId}/membershipInviteProposals/${inviteId}`);
  const auditRef = db.doc(`accounts/${accountId}/membershipInviteAudit/approve-${inviteId}`);
  return db.runTransaction(async tx => {
    const [account, actor, invite, audit] = await Promise.all([tx.get(accountRef), tx.get(actorRef), tx.get(inviteRef), tx.get(auditRef)]);
    const approvedAt = now();
    if (!account.exists || account.data().accountId !== accountId || account.data().status !== "active" || !Number.isSafeInteger(account.data().schemaVersion) || account.data().schemaVersion < 1 || !Number.isSafeInteger(account.data().version) || account.data().version < 1) fail("failed-precondition", "Active canonical account required.");
    requireAdmin(actor.exists ? actor.data() : null, actorUid, accountId, actorIdentity, approvedAt);
    if (!invite.exists) fail("not-found", "Invite proposal not found.");
    const value = invite.data();
    if (value.accountId !== accountId || value.inviteId !== inviteId || value.status !== "pending" ||
        !validId(value.proposedBy) || value.proposedBy === actorUid ||
        typeof value.emailDigest !== "string" || !/^[a-f0-9]{64}$/.test(value.emailDigest) ||
        value.role !== "member" || value.scopeType !== "site" || !Array.isArray(value.scopeIds) ||
        !Number.isSafeInteger(value.createdAt) || !Number.isSafeInteger(value.expiresAt) ||
        value.expiresAt !== value.createdAt + LIFETIME || value.expiresAt <= approvedAt) {
      fail("failed-precondition", "Invite is invalid, expired or already processed.");
    }
    const proposerRef = db.doc(`accounts/${accountId}/members/${value.proposedBy}`);
    const proposer = await tx.get(proposerRef);
    const proposerPrincipal = proposer.exists ? validateCanonicalMembership(proposer.data(), value.proposedBy, accountId, approvedAt) : null;
    if (!proposerPrincipal || proposerPrincipal.role !== "admin") fail("failed-precondition", "Proposing admin is no longer active.");
    if (audit.exists) fail("already-exists", "Invite audit event already exists.");
    const claimExpiresAt = Math.min(value.expiresAt, approvedAt + LIFETIME);
    tx.update(inviteRef, { status: "approved_pending_claim", approvedBy: actorUid, approvedAt, claimExpiresAt });
    tx.create(auditRef, { eventId: `approve-${inviteId}`, type: "membership.invite.approved", accountId, inviteId, proposedBy: value.proposedBy, actorUid, occurredAt: approvedAt });
    return Object.freeze({ inviteId, status: "approved_pending_claim", claimExpiresAt });
  });
}

/** Invitee self-claims only with a revocation-checked, verified Firebase email identity. */
export async function claimCanonicalMembershipInvite({ db, accountId, inviteId, actorUid, actorIdentity, now = () => Date.now() }) {
  if (![accountId, inviteId, actorUid].every(validId) || !actorIdentity ||
      actorIdentity.uid !== actorUid || actorIdentity.emailVerified !== true ||
      typeof actorIdentity.email !== "string" || !EMAIL.test(actorIdentity.email)) {
    fail("unauthenticated", "Verified invitee identity required.");
  }
  const accountRef = db.doc(`accounts/${accountId}`);
  const inviteRef = db.doc(`accounts/${accountId}/membershipInviteProposals/${inviteId}`);
  const memberRef = db.doc(`accounts/${accountId}/members/${actorUid}`);
  const auditRef = db.doc(`accounts/${accountId}/membershipInviteAudit/claim-${inviteId}`);
  return db.runTransaction(async tx => {
    const [account, invite, member, audit] = await Promise.all([tx.get(accountRef), tx.get(inviteRef), tx.get(memberRef), tx.get(auditRef)]);
    const claimedAt = now();
    if (!account.exists || account.data().accountId !== accountId || account.data().status !== "active" || !Number.isSafeInteger(account.data().schemaVersion) || account.data().schemaVersion < 1 || !Number.isSafeInteger(account.data().version) || account.data().version < 1) fail("failed-precondition", "Active canonical account required.");
    if (!invite.exists) fail("not-found", "Invite not found.");
    const value = invite.data();
    if (value.accountId !== accountId || value.inviteId !== inviteId ||
        value.status !== "approved_pending_claim" || !Number.isSafeInteger(value.claimExpiresAt) ||
        value.claimExpiresAt <= claimedAt || value.emailDigest !== emailDigest(actorIdentity.email)) {
      fail("permission-denied", "Invite is not claimable by this verified identity.");
    }
    if (member.exists) fail("already-exists", "This UID already has a membership in the account.");
    if (!Array.isArray(value.scopeIds) || value.scopeIds.length !== 1 || !validId(value.scopeIds[0])) fail("failed-precondition", "Invite scope is malformed.");
    const claimedSiteRef = db.doc(`accounts/${accountId}/sites/${value.scopeIds[0]}`);
    const claimedSite = await tx.get(claimedSiteRef);
    if (!claimedSite.exists || claimedSite.data().accountId !== accountId || claimedSite.data().siteId !== value.scopeIds[0] || claimedSite.data().status !== "active" || !Number.isSafeInteger(claimedSite.data().version) || claimedSite.data().version < 1) fail("failed-precondition", "Invited site is no longer active.");
    if (audit.exists) fail("already-exists", "Invite claim audit event already exists.");
    const membership = {
      accountId, uid: actorUid, status: "active", role: "member",
      scopeType: "site", scopeIds: [value.scopeIds[0]], validFrom: new Date(claimedAt), validUntil: null,
      inviteId, createdAt: claimedAt, approvedBy: value.approvedBy
    };
    tx.create(memberRef, { ...membership, status: "active" });
    tx.update(inviteRef, { status: "claimed", claimedBy: actorUid, claimedAt });
    tx.create(auditRef, { eventId: `claim-${inviteId}`, type: "membership.invite.claimed", accountId, inviteId, actorUid, occurredAt: claimedAt });
    return Object.freeze({ inviteId, status: "claimed" });
  });
}
