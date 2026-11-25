import test from "node:test";
import assert from "node:assert/strict";
import { validateCanonicalMembership, resolveCanonicalMembership } from "../src/membership/membership-policy.js";

const base = { uid: "userA", accountId: "acct1", status: "active", role: "member", scopeType: "department", scopeIds: ["dept1"], permissions: ["dsm:manage:account"] };

test("derives member permissions and ignores client-injected permissions", () => {
  const result = validateCanonicalMembership(base, "userA", "acct1");
  assert.deepEqual(result.permissions, ["dsm:read:own-scope"]);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.scopeIds), true);
});

test("accepts site manager with assigned site scope", () => {
  const result = validateCanonicalMembership({ ...base, role: "manager", scopeType: "site", scopeIds: ["site1", "site2"] }, "userA", "acct1");
  assert.deepEqual(result.permissions, ["dsm:read:site", "dsm:manage:site", "dsm:manage:departments"]);
});

test("admin must be account-scoped and cannot carry scope IDs", () => {
  assert.ok(validateCanonicalMembership({ ...base, role: "admin", scopeType: "account", scopeIds: [] }, "userA", "acct1"));
  assert.equal(validateCanonicalMembership({ ...base, role: "admin", scopeType: "site", scopeIds: ["site1"] }, "userA", "acct1"), null);
});

test("rejects inactive, wrong-identity, malformed, and privilege escalation records", () => {
  assert.equal(validateCanonicalMembership({ ...base, status: "pending" }, "userA", "acct1"), null);
  assert.equal(validateCanonicalMembership({ ...base, uid: "userB" }, "userA", "acct1"), null);
  assert.equal(validateCanonicalMembership({ ...base, role: "root" }, "userA", "acct1"), null);
  assert.equal(validateCanonicalMembership({ ...base, scopeIds: ["dept1", "dept1"] }, "userA", "acct1"), null);
  assert.equal(validateCanonicalMembership({ ...base, scopeType: "account" }, "userA", "acct1"), null);
  assert.equal(validateCanonicalMembership({ ...base, scopeIds: ["../escape"] }, "userA", "acct1"), null);
});

test("membership resolver fails closed for invalid selector", () => {
  assert.equal(resolveCanonicalMembership({ uid: "", accountId: "acct1", membership: base }), null);
  assert.equal(resolveCanonicalMembership({ uid: "userA", accountId: "other", membership: base }), null);
});
