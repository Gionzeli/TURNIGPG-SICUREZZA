import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveOwnEmployeeBinding,
  validateEmployeeBinding
} from "../src/membership/employee-binding.js";

const principal = Object.freeze({
  uid: "synthetic-uid-01",
  accountId: "synthetic-account-01",
  role: "member",
  permissions: ["dsm:read:own-scope"]
});
const binding = Object.freeze({
  uid: principal.uid,
  accountId: principal.accountId,
  profileId: "synthetic-profile-01",
  status: "active",
  revision: 1
});
const profile = Object.freeze({
  accountId: principal.accountId,
  profileId: binding.profileId,
  active: true
});

test("validates an active binding for the verified UID and account", () => {
  const result = validateEmployeeBinding(binding, principal.uid, principal.accountId);
  assert.deepEqual(result, {
    uid: principal.uid,
    accountId: principal.accountId,
    profileId: binding.profileId,
    revision: 1
  });
  assert.equal(Object.isFrozen(result), true);
});

test("rejects absent, inactive, mismatched, malformed and stale bindings", () => {
  for (const candidate of [
    null,
    { ...binding, status: "revoked" },
    { ...binding, uid: "synthetic-other-uid" },
    { ...binding, accountId: "synthetic-other-account" },
    { ...binding, profileId: "../profile" },
    { ...binding, revision: 0 },
    { ...binding, revision: 1.5 },
    []
  ]) {
    assert.equal(validateEmployeeBinding(candidate, principal.uid, principal.accountId), null);
  }
});

test("resolves only the binding keyed by verified UID; no client profile selector exists", async () => {
  const calls = [];
  const result = await resolveOwnEmployeeBinding({
    principal,
    loadBinding: async (accountId, uid) => {
      calls.push(["binding", accountId, uid]);
      return binding;
    },
    loadActiveProfile: async (accountId, profileId) => {
      calls.push(["profile", accountId, profileId]);
      return profile;
    }
  });
  assert.deepEqual(calls, [
    ["binding", principal.accountId, principal.uid],
    ["profile", principal.accountId, binding.profileId]
  ]);
  assert.deepEqual(result, {
    uid: principal.uid,
    accountId: principal.accountId,
    profileId: binding.profileId,
    bindingRevision: 1
  });
  assert.equal(Object.isFrozen(result), true);
});

test("fails closed for a missing binding or a failed backend lookup", async () => {
  await assert.rejects(resolveOwnEmployeeBinding({
    principal,
    loadBinding: async () => null,
    loadActiveProfile: async () => profile
  }), error => error.code === "permission-denied");

  await assert.rejects(resolveOwnEmployeeBinding({
    principal,
    loadBinding: async () => { throw new Error("synthetic storage failure"); },
    loadActiveProfile: async () => profile
  }), error => error.code === "permission-denied");
});

test("fails closed when profile is absent, inactive or cross-account", async () => {
  for (const candidate of [
    null,
    { ...profile, active: false },
    { ...profile, accountId: "synthetic-other-account" },
    { ...profile, profileId: "synthetic-other-profile" },
    []
  ]) {
    await assert.rejects(resolveOwnEmployeeBinding({
      principal,
      loadBinding: async () => binding,
      loadActiveProfile: async () => candidate
    }), error => error.code === "permission-denied");
  }
});

test("denies managers, admins and principals without the member permission", async () => {
  for (const candidate of [
    { ...principal, role: "manager" },
    { ...principal, role: "admin" },
    { ...principal, permissions: [] },
    { ...principal, uid: "../uid" }
  ]) {
    await assert.rejects(resolveOwnEmployeeBinding({
      principal: candidate,
      loadBinding: async () => binding,
      loadActiveProfile: async () => profile
    }), error => error.code === "permission-denied");
  }
});

test("does not call profile loader when binding UID or account does not match", async () => {
  let profileLookup = false;
  await assert.rejects(resolveOwnEmployeeBinding({
    principal,
    loadBinding: async () => ({ ...binding, uid: "synthetic-other-uid" }),
    loadActiveProfile: async () => { profileLookup = true; return profile; }
  }), error => error.code === "permission-denied");
  assert.equal(profileLookup, false);
});
