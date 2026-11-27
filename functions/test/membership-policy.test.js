import test from "node:test";
import assert from "node:assert/strict";
import { validateCanonicalMembership, resolveCanonicalMembership } from "../src/membership/membership-policy.js";

const base = { uid: "userA", accountId: "acct1", status: "active", validFrom: new Date(0), validUntil: null, role: "member", scopeType: "department", scopeIds: ["dept1"], permissions: ["dsm:manage:account"] };

test("derives member permissions and ignores client-injected permissions", () => {
  const result = validateCanonicalMembership(base, "userA", "acct1");
  assert.deepEqual(result.permissions, [
    "dsm:read:own-scope",
    "dsm:employee:shift:read:self",
    "dsm:employee:shift:create:self",
    "dsm:employee:shift:update:self",
    "dsm:employee:shift:delete:self",
    "dsm:employee:employment-profile:read:self"
  ]);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.scopeIds), true);
});

test("accepts site manager with assigned site scope", () => {
  const result = validateCanonicalMembership({ ...base, role: "manager", scopeType: "site", scopeIds: ["site1", "site2"] }, "userA", "acct1");
  assert.deepEqual(result.permissions, ["dsm:read:site", "dsm:manage:site", "dsm:manage:departments", "dsm:transfer:departments"]);
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


test("effective dates and membership lifecycle fail closed", () => {
  const now = Date.UTC(2026, 0, 1);
  const valid = { ...base, validFrom: new Date(now - 1000), validUntil: new Date(now + 1000) };
  assert.ok(validateCanonicalMembership(valid, "userA", "acct1", now));
  for (const invalid of [
    { ...base, validFrom: undefined },
    { ...base, validFrom: "2025-01-01" },
    { ...base, validFrom: new Date(now + 1) },
    { ...base, validUntil: new Date(now) },
    { ...base, validUntil: new Date(now - 1) },
    { ...base, status: "suspended" },
    { ...base, status: "revoked" }
  ]) assert.equal(validateCanonicalMembership(invalid, "userA", "acct1", now), null);
  assert.equal(validateCanonicalMembership(valid, "userA", "acct1", now - 2000), null);
  assert.equal(validateCanonicalMembership(valid, "userA", "acct1", now + 2000), null);
});


test("account admin receives the explicit department-transfer permission", () => {
  const admin = validateCanonicalMembership({
    ...base, role: "admin", scopeType: "account", scopeIds: []
  }, "userA", "acct1");
  assert.ok(admin.permissions.includes("dsm:transfer:departments"));
});


test("admin permission matrix contains explicit site and department archive grants", () => {
  const admin = validateCanonicalMembership({
    ...base, role: "admin", scopeType: "account", scopeIds: []
  }, "userA", "acct1");
  assert.ok(admin.permissions.includes("dsm:archive:site"));
  assert.ok(admin.permissions.includes("dsm:archive:department"));
});


test("manager and admin roles do not inherit employee self-shift permissions", () => {
  const manager = validateCanonicalMembership({ ...base, role: "manager", scopeType: "site", scopeIds: ["site1"] }, "userA", "acct1");
  const admin = validateCanonicalMembership({ ...base, role: "admin", scopeType: "account", scopeIds: [] }, "userA", "acct1");
  for (const permission of [
    "dsm:employee:shift:read:self",
    "dsm:employee:shift:create:self",
    "dsm:employee:shift:update:self",
    "dsm:employee:shift:delete:self",
    "dsm:employee:employment-profile:read:self"
  ]) {
    assert.equal(manager.permissions.includes(permission), false);
    assert.equal(admin.permissions.includes(permission), false);
  }
});
