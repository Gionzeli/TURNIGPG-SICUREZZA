import test from "node:test";
import assert from "node:assert/strict";
import { authorizeResource } from "../src/membership/resource-authorization.js";

const manager = {
  uid: "mgr1", accountId: "acct1", role: "manager", scopeType: "site",
  scopeIds: ["siteA"], permissions: ["dsm:read:site", "dsm:manage:site", "dsm:manage:departments"]
};
const member = {
  uid: "mem1", accountId: "acct1", role: "member", scopeType: "department",
  scopeIds: ["deptA"], permissions: ["dsm:read:own-scope"]
};
const resource = (overrides = {}) => ({
  accountId: "acct1", siteId: "siteA", departmentId: "deptA", ...overrides
});

test("manager can access a department only inside an assigned site", () => {
  assert.equal(authorizeResource({
    principal: manager, permission: "dsm:manage:departments", resourceContext: resource()
  }).authorized, true);
  assert.throws(() => authorizeResource({
    principal: manager, permission: "dsm:manage:departments",
    resourceContext: resource({ siteId: "siteB" })
  }), error => error.code === "permission-denied");
});

test("manager cannot access account-level or unscoped resources", () => {
  assert.throws(() => authorizeResource({
    principal: manager, permission: "dsm:manage:site",
    resourceContext: resource({ siteId: null, departmentId: null })
  }), error => error.code === "permission-denied");
});

test("member can access only the assigned department", () => {
  assert.equal(authorizeResource({
    principal: member, permission: "dsm:read:own-scope", resourceContext: resource()
  }).authorized, true);
  assert.throws(() => authorizeResource({
    principal: member, permission: "dsm:read:own-scope",
    resourceContext: resource({ departmentId: "deptB" })
  }), error => error.code === "permission-denied");
});

test("site-scoped member can access resources in the assigned site", () => {
  const siteMember = { ...member, scopeType: "site", scopeIds: ["siteA"] };
  assert.equal(authorizeResource({
    principal: siteMember, permission: "dsm:read:own-scope",
    resourceContext: resource({ departmentId: null })
  }).authorized, true);
  assert.throws(() => authorizeResource({
    principal: siteMember, permission: "dsm:read:own-scope",
    resourceContext: resource({ siteId: "siteB", departmentId: null })
  }), error => error.code === "permission-denied");
});

test("member cannot use a permission not granted by canonical policy", () => {
  assert.throws(() => authorizeResource({
    principal: member, permission: "dsm:manage:account", resourceContext: resource()
  }), error => error.code === "permission-denied");
});

test("cross-account, malformed, and incomplete resource contexts fail closed", () => {
  for (const context of [
    resource({ accountId: "acct2" }),
    resource({ siteId: "../escape" }),
    resource({ siteId: null, departmentId: "deptA" }),
    []
  ]) {
    assert.throws(() => authorizeResource({
      principal: manager, permission: "dsm:read:site", resourceContext: context
    }), error => error.code === "permission-denied");
  }
});

test("malformed principals fail closed before scope evaluation", () => {
  for (const principal of [
    { ...manager, scopeIds: "siteA" },
    { ...manager, scopeIds: ["siteA", "../escape"] },
    { ...manager, scopeIds: ["siteA", "siteA"] },
    { ...manager, permissions: ["dsm:read:site", null] },
    { ...manager, scopeType: "account" },
    []
  ]) {
    assert.throws(() => authorizeResource({
      principal, permission: "dsm:read:site", resourceContext: resource()
    }), error => error.code === "permission-denied");
  }
});

test("admin is account-scoped but still requires an allowed permission", () => {
  const admin = {
    uid: "adm1", accountId: "acct1", role: "admin", scopeType: "account",
    scopeIds: [], permissions: ["dsm:manage:account"]
  };
  assert.equal(authorizeResource({
    principal: admin, permission: "dsm:manage:account",
    resourceContext: resource({ siteId: null, departmentId: null })
  }).authorized, true);
  assert.throws(() => authorizeResource({
    principal: admin, permission: "dsm:manage:memberships",
    resourceContext: resource()
  }), error => error.code === "permission-denied");
});
