import test from "node:test";
import assert from "node:assert/strict";
import { createNominationHandlers } from "../src/membership/nomination-callable-handlers.js";

const identityClaims = {
  uid: "verified-admin",
  email: "synthetic@example.invalid",
  email_verified: true,
  auth_time: 1_000,
  firebase: { sign_in_second_factor: "totp" }
};
function makeHarness(claims = identityClaims) {
  const calls = [];
  const services = Object.fromEntries([
    "createAdminNomination", "approveAdminNomination", "cancelAdminNomination"
  ].map(name => [name, async args => { calls.push({ name, args }); return { ok: true }; }]));
  const verifyCalls = [];
  const db = {};
  const handlers = createNominationHandlers({
    db,
    verifyToken: async (token, checkRevoked) => {
      verifyCalls.push({ token, checkRevoked });
      return claims;
    },
    now: () => 1_000_000,
    services
  });
  return { handlers, calls, verifyCalls, db };
}
function request(data = {}, authorization = "Bearer synthetic-id-token") {
  return { rawRequest: { headers: authorization ? { authorization } : {} }, data };
}

test("create derives actor UID and immutable identity from verified bearer claims", async () => {
  const { handlers, calls, verifyCalls, db } = makeHarness();
  await handlers.create(request({
    accountId: "ac1", nominationId: "n1", targetUid: "target",
    role: "manager", scopeType: "site", scopeIds: ["site1"],
    actorUid: "attacker",
    actorIdentity: { uid: "attacker", emailVerified: true, authTime: 1_000, secondFactor: "totp" }
  }));
  assert.deepEqual(verifyCalls, [{ token: "synthetic-id-token", checkRevoked: true }]);
  assert.equal(calls[0].name, "createAdminNomination");
  assert.equal(calls[0].args.db, db);
  assert.equal(calls[0].args.actorUid, "verified-admin");
  assert.deepEqual(calls[0].args.actorIdentity, {
    uid: "verified-admin", email: "synthetic@example.invalid",
    emailVerified: true, authTime: 1_000, secondFactor: "totp"
  });
  assert.equal(Object.isFrozen(calls[0].args.actorIdentity), true);
  assert.equal(calls[0].args.targetUid, "target");
});

test("approve and cancel derive actor identity from token and pass only operation data", async () => {
  const { handlers, calls, verifyCalls } = makeHarness();
  await handlers.approve(request({
    accountId: "ac1", nominationId: "n1", actorUid: "spoof",
    actorIdentity: { uid: "spoof" }
  }));
  await handlers.cancel(request({
    accountId: "ac1", nominationId: "n1", eventId: "event1",
    reason: "Synthetic reason", actorUid: "spoof", actorIdentity: { uid: "spoof" }
  }));
  assert.equal(calls[0].name, "approveAdminNomination");
  assert.equal(calls[1].name, "cancelAdminNomination");
  for (const call of calls) {
    assert.equal(call.args.actorUid, "verified-admin");
    assert.equal(call.args.actorIdentity.uid, "verified-admin");
    assert.equal(Object.hasOwn(call.args, "request"), false);
  }
  assert.equal(verifyCalls.length, 2);
  assert.ok(verifyCalls.every(call => call.checkRevoked === true));
});

test("all operations reject missing or malformed bearer authorization before service calls", async () => {
  const { handlers, calls, verifyCalls } = makeHarness();
  for (const operation of ["create", "approve", "cancel"]) {
    await assert.rejects(handlers[operation](request({}, "")), error => error.code === "unauthenticated");
    await assert.rejects(handlers[operation](request({}, "Basic abc")), error => error.code === "unauthenticated");
  }
  assert.equal(calls.length, 0);
  assert.equal(verifyCalls.length, 0);
});

test("revoked or unverifiable tokens and unverified email fail closed", async () => {
  const revoked = makeHarness();
  revoked.handlers = createNominationHandlers({
    db: {}, verifyToken: async () => { throw new Error("synthetic revoked token"); },
    services: {
      createAdminNomination: async () => assert.fail("service must not run"),
      approveAdminNomination: async () => assert.fail("service must not run"),
      cancelAdminNomination: async () => assert.fail("service must not run")
    }
  });
  await assert.rejects(revoked.handlers.approve(request({ accountId: "ac1", nominationId: "n1" })),
    error => error.code === "unauthenticated");

  const unverified = makeHarness({ ...identityClaims, email_verified: false });
  await assert.rejects(unverified.handlers.create(request({ accountId: "ac1" })),
    error => error.code === "unauthenticated");
  assert.equal(unverified.calls.length, 0);
});
