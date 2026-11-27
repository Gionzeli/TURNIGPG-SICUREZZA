import test from "node:test";
import assert from "node:assert/strict";
import { authorizeEmployeeDomainOperation } from "../src/membership/employee-domain-authorization.js";

const selfPrincipal = {
  uid: "uid-1", accountId: "acct-1", role: "member",
  scopeType: "department", scopeIds: ["dept-1"],
  permissions: ["dsm:read:shifts:self"]
};
const binding = {
  uid: "uid-1", accountId: "acct-1", profileId: "employee-1",
  status: "active", revision: 2
};
const manager = {
  uid: "manager-1", accountId: "acct-1", role: "manager",
  scopeType: "site", scopeIds: ["site-1"],
  permissions: ["dsm:read:shifts:site"]
};
const placement = {
  accountId: "acct-1", employeeId: "employee-2", placementId: "placement-1",
  siteId: "site-1", departmentId: "dept-1",
  validFrom: "2026-01-01", validUntil: null
};

test("self access requires exact active UID-to-Employee binding and operation permission", () => {
  const result = authorizeEmployeeDomainOperation({
    principal: selfPrincipal, permission: "dsm:read:shifts:self",
    accessMode: "self", employeeBinding: binding, employeeId: "employee-1"
  });
  assert.equal(result.authorized, true);
  assert.equal(result.employeeId, "employee-1");
  for (const invalid of [
    { ...binding, uid: "uid-2" },
    { ...binding, accountId: "acct-2" },
    { ...binding, profileId: "employee-2" },
    { ...binding, status: "revoked" },
    { ...binding, revision: 0 }
  ]) {
    assert.throws(() => authorizeEmployeeDomainOperation({
      principal: selfPrincipal, permission: "dsm:read:shifts:self",
      accessMode: "self", employeeBinding: invalid, employeeId: "employee-1"
    }), e => e.code === "permission-denied");
  }
});

test("self access does not accept a caller-selected Employee or missing permission", () => {
  assert.throws(() => authorizeEmployeeDomainOperation({
    principal: selfPrincipal, permission: "dsm:read:shifts:self",
    accessMode: "self", employeeBinding: binding, employeeId: "employee-2"
  }), e => e.code === "permission-denied");
  assert.throws(() => authorizeEmployeeDomainOperation({
    principal: selfPrincipal, permission: "dsm:export:payroll:self",
    accessMode: "self", employeeBinding: binding, employeeId: "employee-1"
  }), e => e.code === "permission-denied");
});

test("delegated manager access requires exact domain permission and canonical placement scope", () => {
  const result = authorizeEmployeeDomainOperation({
    principal: manager, permission: "dsm:read:shifts:site",
    accessMode: "delegated", employeeId: "employee-2", placement
  });
  assert.equal(result.authorized, true);
  assert.equal(result.placementId, "placement-1");
  assert.throws(() => authorizeEmployeeDomainOperation({
    principal: manager, permission: "dsm:manage:shifts:site",
    accessMode: "delegated", employeeId: "employee-2", placement
  }), e => e.code === "permission-denied");
  assert.throws(() => authorizeEmployeeDomainOperation({
    principal: manager, permission: "dsm:read:shifts:site",
    accessMode: "delegated", employeeId: "employee-2",
    placement: { ...placement, siteId: "site-2" }
  }), e => e.code === "permission-denied");
});

test("generic manager and admin permissions never imply payroll or shift domain access", () => {
  const genericManager = { ...manager, permissions: ["dsm:read:site", "dsm:manage:site"] };
  const admin = {
    uid: "admin-1", accountId: "acct-1", role: "admin",
    scopeType: "account", scopeIds: [],
    permissions: ["dsm:read:account", "dsm:manage:account"]
  };
  for (const principal of [genericManager, admin]) {
    assert.throws(() => authorizeEmployeeDomainOperation({
      principal, permission: "dsm:read:payroll:account",
      accessMode: "delegated", employeeId: "employee-2", placement
    }), e => e.code === "permission-denied");
  }
});

test("malformed principal, mode and placement fail closed", () => {
  for (const args of [
    { principal: null, permission: "dsm:read:shifts:self", accessMode: "self", employeeBinding: binding, employeeId: "employee-1" },
    { principal: selfPrincipal, permission: "dsm:read:shifts:self", accessMode: "browser", employeeBinding: binding, employeeId: "employee-1" },
    { principal: manager, permission: "dsm:read:shifts:site", accessMode: "delegated", employeeId: "employee-2", placement: { ...placement, departmentId: "../bad" } },
    { principal: manager, permission: "dsm:read:shifts:site", accessMode: "delegated", employeeId: "employee-3", placement }
  ]) {
    assert.throws(() => authorizeEmployeeDomainOperation(args), e => e.code === "permission-denied");
  }
});

test("principal shape and placement interval dates are strictly validated", () => {
  const malformedPrincipals = [
    { ...selfPrincipal, role: "owner" },
    { ...selfPrincipal, scopeIds: ["dept-1", "dept-1"] },
    { ...selfPrincipal, permissions: "dsm:read:shifts:self" }
  ];
  for (const principal of malformedPrincipals) {
    assert.throws(() => authorizeEmployeeDomainOperation({
      principal, permission: "dsm:read:shifts:self",
      accessMode: "self", employeeBinding: binding, employeeId: "employee-1"
    }), e => e.code === "permission-denied");
  }
  for (const invalidPlacement of [
    { ...placement, validFrom: "2026-02-30" },
    { ...placement, validFrom: "2026-1-01" },
    { ...placement, validUntil: "2025-12-31" },
    { ...placement, validUntil: "2026-02-30" }
  ]) {
    assert.throws(() => authorizeEmployeeDomainOperation({
      principal: manager, permission: "dsm:read:shifts:site",
      accessMode: "delegated", employeeId: "employee-2",
      placement: invalidPlacement
    }), e => e.code === "permission-denied");
  }
});

 
test("principal role and organizational scope combinations must match membership policy", () => {
  const invalid = [
    { ...selfPrincipal, role: "manager", scopeType: "department" },
    { ...manager, scopeType: "account", scopeIds: [] },
    { ...manager, scopeIds: [] },
    { uid: "admin-2", accountId: "acct-1", role: "admin", scopeType: "account",
      scopeIds: ["site-1"], permissions: ["dsm:read:account"] }
  ];
  for (const principal of invalid) {
    assert.throws(() => authorizeEmployeeDomainOperation({
      principal, permission: principal.permissions[0],
      accessMode: "self", employeeBinding: binding, employeeId: "employee-1"
    }), e => e.code === "permission-denied");
  }
});


test("empty, whitespace-only and duplicate permissions fail closed", () => {
  for (const principal of [
    { ...selfPrincipal, permissions: [""] },
    { ...selfPrincipal, permissions: ["   "] },
    { ...selfPrincipal, permissions: ["dsm:read:shifts:self", "dsm:read:shifts:self"] }
  ]) {
    assert.throws(() => authorizeEmployeeDomainOperation({
      principal, permission: "dsm:read:shifts:self",
      accessMode: "self", employeeBinding: binding, employeeId: "employee-1"
    }), e => e.code === "permission-denied");
  }
});

test("self binding must be a canonical object with a valid Employee id", () => {
  for (const employeeBinding of [
    [],
    { ...binding, profileId: "../employee" },
    { ...binding, profileId: "" }
  ]) {
    assert.throws(() => authorizeEmployeeDomainOperation({
      principal: selfPrincipal, permission: "dsm:read:shifts:self",
      accessMode: "self", employeeBinding, employeeId: "employee-1"
    }), e => e.code === "permission-denied");
  }
});
