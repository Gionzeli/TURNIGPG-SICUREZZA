import test from "node:test";
import assert from "node:assert/strict";
import { createCanonicalAccountCallableHandlers } from "../src/membership/canonical-account-callable-handlers.js";

const request = (authorization = "Bearer signed-token") => ({
  rawRequest: { headers: authorization ? { authorization } : {} }
});
const claims = { uid: "employee-uid-1", email: "employee@example.test", email_verified: true, auth_time: 1 };
const account = id => ({ accountId: id, status: "active", schemaVersion: 1, version: 1 });
const membership = (accountId, overrides = {}) => ({
  uid: "employee-uid-1", accountId, status: "active", role: "member",
  scopeType: "site", scopeIds: ["site-1"],
  validFrom: new Date("2026-01-01T00:00:00.000Z"), validUntil: null,
  ...overrides
});

function fixture({ docs = [], accounts = {} } = {}) {
  const calls = [];
  const db = {
    collectionGroup(name) {
      assert.equal(name, "members");
      return {
        where(field, operator, value) {
          calls.push(["where", field, operator, value]);
          return {
            limit(count) {
              calls.push(["limit", count]);
              return { get: async () => ({ size: docs.length, docs }) };
            }
          };
        }
      };
    },
    doc(path) {
      calls.push(["doc", path]);
      return { get: async () => ({
        exists: Object.hasOwn(accounts, path),
        data: () => accounts[path]
      }) };
    }
  };
  return { db, calls };
}
const memberDoc = (accountId, value, uid = "employee-uid-1") => ({
  ref: { path: `accounts/${accountId}/members/${uid}` },
  data: () => value
});

test("lists only active canonical accounts for the verified UID", async () => {
  const { db, calls } = fixture({
    docs: [
      memberDoc("acct-b", membership("acct-b")),
      memberDoc("acct-a", membership("acct-a")),
      memberDoc("acct-inactive", membership("acct-inactive", { status: "suspended" })),
      memberDoc("acct-mismatch", membership("different-account"))
    ],
    accounts: {
      "accounts/acct-a": account("acct-a"),
      "accounts/acct-b": account("acct-b"),
      "accounts/acct-inactive": account("acct-inactive"),
      "accounts/different-account": account("different-account")
    }
  });
  const verifyCalls = [];
  const handlers = createCanonicalAccountCallableHandlers({
    db, now: () => Date.parse("2026-11-27T00:00:00.000Z"),
    verifyToken: async (token, checkRevoked) => {
      verifyCalls.push([token, checkRevoked]);
      return claims;
    }
  });
  const result = await handlers.listMine(request());
  assert.deepEqual(result.map(item => item.accountId), ["acct-a", "acct-b"]);
  assert.deepEqual(result[0].permissions, [
    "dsm:read:own-scope",
    "dsm:employee:shift:read:self",
    "dsm:employee:employment-profile:read:self"
  ]);
  assert.deepEqual(verifyCalls, [["signed-token", true]]);
  assert.deepEqual(calls[0], ["where", "uid", "==", "employee-uid-1"]);
  assert.deepEqual(calls[1], ["limit", 101]);
  assert.ok(Object.isFrozen(result));
});

test("does not treat legacy root-level member documents as canonical memberships", async () => {
  const { db } = fixture({
    docs: [{ ref: { path: "members/employee-uid-1" }, data: () => ({ active: true }) }],
    accounts: {}
  });
  const handlers = createCanonicalAccountCallableHandlers({ db, verifyToken: async () => claims });
  assert.deepEqual(await handlers.listMine(request()), []);
});

test("rejects missing bearer and unverified identities", async () => {
  const { db } = fixture();
  const handlers = createCanonicalAccountCallableHandlers({
    db, verifyToken: async (_token, checkRevoked) => {
      assert.equal(checkRevoked, true);
      return { ...claims, email_verified: false };
    }
  });
  await assert.rejects(handlers.listMine(request("")), error => error.code === "unauthenticated");
  await assert.rejects(handlers.listMine(request()), error => error.code === "unauthenticated");
});
