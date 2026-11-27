import test from "node:test";
import assert from "node:assert/strict";
import {
  proposeCanonicalMembershipInvite,
  approveCanonicalMembershipInvite,
  claimCanonicalMembershipInvite
} from "../src/membership/canonical-membership-invite-service.js";

const KEY = "synthetic-test-invite-hmac-key-000000000000000000000000";
const NOW = Date.parse("2026-11-27T12:00:00.000Z");
const admin = (uid) => ({
  accountId: "turnigpg-sicurezza", uid, status: "active", role: "admin",
  scopeType: "account", scopeIds: [], validFrom: new Date(NOW - 60_000), validUntil: null
});
const identity = uid => ({ uid, email: `${uid}@example.test`, emailVerified: true, authTime: Math.floor(NOW / 1000), secondFactor: "totp" });

function store(seed = {}) {
  const docs = new Map(Object.entries(seed));
  const db = {
    doc: path => ({ path }),
    runTransaction: fn => fn({
      get: async ref => ({ exists: docs.has(ref.path), data: () => docs.get(ref.path) }),
      create: (ref, value) => { if (docs.has(ref.path)) throw new Error("exists"); docs.set(ref.path, structuredClone(value)); },
      update: (ref, patch) => { if (!docs.has(ref.path)) throw new Error("missing"); docs.set(ref.path, { ...docs.get(ref.path), ...patch }); }
    })
  };
  return { db, docs };
}
const accountPath = "accounts/turnigpg-sicurezza";
const sitePath = `${accountPath}/sites/site-1`;
const seed = () => ({
  [accountPath]: { accountId: "turnigpg-sicurezza", status: "active", schemaVersion: 1, version: 1 },
  [sitePath]: { accountId: "turnigpg-sicurezza", siteId: "site-1", status: "active", version: 1 },
  [`${accountPath}/members/admin-a`]: admin("admin-a"),
  [`${accountPath}/members/admin-b`]: admin("admin-b")
});

test("invite needs two distinct recent admins and verified invitee email before active membership", async () => {
  const { db, docs } = store(seed());
  const proposal = await proposeCanonicalMembershipInvite({
    db, accountId: "turnigpg-sicurezza", actorUid: "admin-a", actorIdentity: identity("admin-a"),
    inviteId: "invite-1", email: "New.Member@example.test", siteId: "site-1", emailHmacKey: KEY, now: () => NOW
  });
  assert.equal(proposal.status, "pending");
  await assert.rejects(approveCanonicalMembershipInvite({
    db, accountId: "turnigpg-sicurezza", actorUid: "admin-a", actorIdentity: identity("admin-a"),
    inviteId: "invite-1", now: () => NOW
  }), e => e.code === "permission-denied");
  await approveCanonicalMembershipInvite({
    db, accountId: "turnigpg-sicurezza", actorUid: "admin-b", actorIdentity: identity("admin-b"),
    inviteId: "invite-1", now: () => NOW
  });
  await assert.rejects(claimCanonicalMembershipInvite({
    db, accountId: "turnigpg-sicurezza", inviteId: "invite-1", actorUid: "new-uid",
    actorIdentity: { ...identity("new-uid"), email: "attacker@example.test" }, emailHmacKey: KEY, now: () => NOW
  }), e => e.code === "permission-denied");
  const claimed = await claimCanonicalMembershipInvite({
    db, accountId: "turnigpg-sicurezza", inviteId: "invite-1", actorUid: "new-uid",
    actorIdentity: { ...identity("new-uid"), email: "new.member@example.test" }, emailHmacKey: KEY, now: () => NOW
  });
  assert.equal(claimed.status, "claimed");
  const member = docs.get(`${accountPath}/members/new-uid`);
  assert.equal(member.status, "active");
  assert.deepEqual(member.scopeIds, ["site-1"]);
  assert.equal(member.email, undefined);
  assert.equal(docs.get(`${accountPath}/membershipInviteProposals/invite-1`).status, "claimed");
});

test("invite proposal rejects non-admin, stale MFA and inactive site", async () => {
  const fixture = seed();
  fixture[sitePath].status = "archived";
  const { db } = store(fixture);
  await assert.rejects(proposeCanonicalMembershipInvite({
    db, accountId: "turnigpg-sicurezza", actorUid: "admin-a", actorIdentity: identity("admin-a"),
    inviteId: "invite-2", email: "x@example.test", siteId: "site-1", emailHmacKey: KEY, now: () => NOW
  }), e => e.code === "failed-precondition");
  await assert.rejects(proposeCanonicalMembershipInvite({
    db, accountId: "turnigpg-sicurezza", actorUid: "admin-a",
    actorIdentity: { ...identity("admin-a"), authTime: 1 },
    inviteId: "invite-3", email: "x@example.test", siteId: "site-1", emailHmacKey: KEY, now: () => NOW
  }), e => e.code === "permission-denied");
});

test("invite claim rejects expiry and duplicate membership", async () => {
  const fixture = seed();
  fixture[`${accountPath}/membershipInviteProposals/expired`] = {
    accountId: "turnigpg-sicurezza", inviteId: "expired", emailDigest: "0".repeat(64),
    role: "member", scopeType: "site", scopeIds: ["site-1"], status: "approved_pending_claim",
    claimExpiresAt: NOW - 1, proposedBy: "admin-a", approvedBy: "admin-b"
  };
  const { db } = store(fixture);
  await assert.rejects(claimCanonicalMembershipInvite({
    db, accountId: "turnigpg-sicurezza", inviteId: "expired", actorUid: "new-uid",
    actorIdentity: { ...identity("new-uid"), email: "x@example.test" }, now: () => NOW
  }), e => e.code === "permission-denied");
});


test("approved invite cannot be claimed after its site becomes inactive", async () => {
  const { db, docs } = store(seed());
  await proposeCanonicalMembershipInvite({
    db, accountId: "turnigpg-sicurezza", actorUid: "admin-a", actorIdentity: identity("admin-a"),
    inviteId: "site-retired", email: "new.member@example.test", siteId: "site-1",
    emailHmacKey: KEY, now: () => NOW
  });
  await approveCanonicalMembershipInvite({
    db, accountId: "turnigpg-sicurezza", actorUid: "admin-b", actorIdentity: identity("admin-b"),
    inviteId: "site-retired", now: () => NOW
  });
  docs.get(sitePath).status = "archived";
  await assert.rejects(claimCanonicalMembershipInvite({
    db, accountId: "turnigpg-sicurezza", inviteId: "site-retired", actorUid: "new-uid",
    actorIdentity: { ...identity("new-uid"), email: "new.member@example.test" },
    emailHmacKey: KEY, now: () => NOW
  }), e => e.code === "failed-precondition");
  assert.equal(docs.has(`${accountPath}/members/new-uid`), false);
});

test("approved invite cannot create a second membership for an existing UID", async () => {
  const fixture = seed();
  fixture[`${accountPath}/members/existing-uid`] = {
    accountId: "turnigpg-sicurezza", uid: "existing-uid", status: "active",
    role: "member", scopeType: "site", scopeIds: ["site-1"],
    validFrom: new Date(NOW - 1000), validUntil: null
  };
  const { db, docs } = store(fixture);
  await proposeCanonicalMembershipInvite({
    db, accountId: "turnigpg-sicurezza", actorUid: "admin-a", actorIdentity: identity("admin-a"),
    inviteId: "duplicate-uid", email: "existing@example.test", siteId: "site-1",
    emailHmacKey: KEY, now: () => NOW
  });
  await approveCanonicalMembershipInvite({
    db, accountId: "turnigpg-sicurezza", actorUid: "admin-b", actorIdentity: identity("admin-b"),
    inviteId: "duplicate-uid", now: () => NOW
  });
  await assert.rejects(claimCanonicalMembershipInvite({
    db, accountId: "turnigpg-sicurezza", inviteId: "duplicate-uid", actorUid: "existing-uid",
    actorIdentity: { ...identity("existing-uid"), email: "existing@example.test" },
    emailHmacKey: KEY, now: () => NOW
  }), e => e.code === "already-exists");
  assert.equal(docs.get(`${accountPath}/membershipInviteProposals/duplicate-uid`).status, "approved_pending_claim");
});
