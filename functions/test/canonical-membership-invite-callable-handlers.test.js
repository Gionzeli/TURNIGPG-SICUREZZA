import test from "node:test";
import assert from "node:assert/strict";
import { createCanonicalMembershipInviteHandlers } from "../src/membership/canonical-membership-invite-callable-handlers.js";

const request = (data, authorization = "Bearer token") => ({ data, rawRequest: { headers: authorization ? { authorization } : {} } });
test("invite callables derive identity from revoked-token-checked Firebase verification and reject extra fields", async () => {
  const calls = [];
  const handlers = createCanonicalMembershipInviteHandlers({
    db: { doc: () => ({}), runTransaction: async () => {} },
    verifyToken: async (token, checkRevoked) => {
      calls.push([token, checkRevoked]);
      return { uid: "admin-a", email: "admin@example.test", email_verified: true, auth_time: 100, firebase: { sign_in_second_factor: "totp" } };
    },
    now: () => 100_000
  });
  await assert.rejects(handlers.propose(request({ accountId: "acct", inviteId: "inv", email: "x@example.test", siteId: "site", uid: "forged" })), e => e.code === "invalid-argument");
  await assert.rejects(handlers.claim(request({ accountId: "acct", inviteId: "inv" }, "")), e => e.code === "unauthenticated");
  assert.deepEqual(calls, []);
});
test("invite callable passes only verified identity and allowed selectors to service", async () => {
  const calls = [];
  const db = {
    doc: path => ({ path }),
    runTransaction: async fn => fn({
      get: async ref => ({ exists: true, data: () => {
        if (ref.path === "accounts/acct") return { accountId: "acct", status: "active", schemaVersion: 1, version: 1 };
        if (ref.path === "accounts/acct/members/admin-a") return { uid: "admin-a", accountId: "acct", status: "active", role: "admin", scopeType: "account", scopeIds: [], validFrom: new Date(0), validUntil: null };
        if (ref.path === "accounts/acct/sites/site-1") return { accountId: "acct", siteId: "site-1", status: "active", version: 1 };
        return {};
      } }),
      create: (ref, value) => calls.push(["create", ref.path, value])
    })
  };
  const handlers = createCanonicalMembershipInviteHandlers({
    db, now: () => 100_000,
    verifyToken: async (_token, checkRevoked) => {
      assert.equal(checkRevoked, true);
      return { uid: "admin-a", email: "admin@example.test", email_verified: true, auth_time: 100, firebase: { sign_in_second_factor: "totp" } };
    }
  });
  const result = await handlers.propose(request({ accountId: "acct", inviteId: "inv", email: "person@example.test", siteId: "site-1" }));
  assert.equal(result.status, "pending");
  assert.equal(calls[0][1], "accounts/acct/membershipInviteProposals/inv");
  assert.equal(calls[0][2].email, undefined);
  assert.match(calls[0][2].emailDigest, /^[a-f0-9]{64}$/);
});
