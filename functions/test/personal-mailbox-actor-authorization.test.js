import test from "node:test";
import assert from "node:assert/strict";
import { createPersonalMailboxActorAuthorizer } from "../src/membership/personal-mailbox-actor-authorization.js";

function fixture(overrides = {}) {
  const docs = new Map();
  const uid = "synthetic-uid", accountId = "synthetic-account", employeeId = "synthetic-employee";
  docs.set(`accounts/${accountId}`, {
    accountId, status: "active", schemaVersion: 1, version: 1
  });
  docs.set(`accounts/${accountId}/members/${uid}`, {
    uid, accountId, status: "active", role: "member", scopeType: "department",
    scopeIds: ["synthetic-department"], validFrom: new Date("2026-01-01T00:00:00Z"),
    validUntil: null
  });
  docs.set(`accounts/${accountId}/employeeBindingsByUid/${uid}`, {
    uid, accountId, employeeId, status: "active", revision: 3
  });
  docs.set(`accounts/${accountId}/employeeBindingsByEmployee/${employeeId}`, {
    uid, accountId, employeeId, status: "active", revision: 3
  });
  docs.set(`accounts/${accountId}/employees/${employeeId}`, {
    accountId, employeeId, status: "active"
  });
  const db = {
    doc: path => ({ path }),
    async runTransaction(fn) {
      return fn({ async get(ref) {
        const value = docs.get(ref.path);
        return { exists: value !== undefined, data: () => value };
      }});
    }
  };
  const auth = {
    async getUser(requestedUid) {
      if (overrides.authError) throw new Error("synthetic auth lookup failure");
      return {
        uid: requestedUid, disabled: overrides.disabled === true,
        emailVerified: overrides.emailVerified !== false,
        email: overrides.email ?? "collaboratore@example.invalid"
      };
    }
  };
  const authorizeActor = createPersonalMailboxActorAuthorizer({
    db, auth, now: () => Date.parse("2026-11-27T10:00:00Z")
  });
  return { authorizeActor, docs, uid, accountId, employeeId };
}

test("resolves only the active canonical member and reciprocal Employee binding", async () => {
  const f = fixture();
  const principal = await f.authorizeActor({
    accountId: f.accountId, actorUid: f.uid, mode: "personal"
  });
  assert.equal(principal.employeeId, f.employeeId);
  assert.equal(principal.email, "collaboratore@example.invalid");
  assert.equal(principal.role, "member");
  assert.equal(principal.status, "active");
});

test("rejects a shared mailbox request rather than inferring admin authority", async () => {
  const f = fixture();
  await assert.rejects(f.authorizeActor({
    accountId: f.accountId, actorUid: f.uid, mode: "shared"
  }), error => error.code === "permission-denied");
});

test("rejects unverified, disabled, or unavailable Firebase Auth identities", async () => {
  for (const options of [{ emailVerified: false }, { disabled: true }, { authError: true }]) {
    const f = fixture(options);
    await assert.rejects(f.authorizeActor({
      accountId: f.accountId, actorUid: f.uid, mode: "personal"
    }), error => error.code === "permission-denied");
  }
});

test("rejects missing or inactive reciprocal Employee binding", async () => {
  const f = fixture();
  f.docs.set(`accounts/${f.accountId}/employeeBindingsByEmployee/${f.employeeId}`, {
    uid: "different-uid", accountId: f.accountId, employeeId: f.employeeId,
    status: "active", revision: 3
  });
  await assert.rejects(f.authorizeActor({
    accountId: f.accountId, actorUid: f.uid, mode: "personal"
  }), error => error.code === "permission-denied");
});

test("rejects inactive account, expired membership, or inactive Employee", async () => {
  const f = fixture();
  f.docs.set(`accounts/${f.accountId}/employees/${f.employeeId}`, {
    accountId: f.accountId, employeeId: f.employeeId, status: "inactive"
  });
  await assert.rejects(f.authorizeActor({
    accountId: f.accountId, actorUid: f.uid, mode: "personal"
  }), error => error.code === "permission-denied");
});
