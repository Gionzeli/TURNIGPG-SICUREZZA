import test from "node:test";
import assert from "node:assert/strict";
import { createOrganizationCallableHandlers } from "../src/membership/organization-callable-handlers.js";

const identity = { uid: "verified-admin", email: "admin@example.invalid", emailVerified: true, authTime: 100, secondFactor: null };
function request(data = {}, token = "valid-token") {
  return { data, rawRequest: { headers: { authorization: token ? `Bearer ${token}` : "" } } };
}
function setup(overrides = {}) {
  const calls = [];
  const services = Object.fromEntries(["createSite", "createDepartment", "archiveDepartment", "archiveSite", "transferDepartment"]
    .map(name => [name, async args => { calls.push({ name, args }); return { ok: true, name }; }]));
  const verifyCalls = [];
  const handlers = createOrganizationCallableHandlers({
    db: { trusted: true }, verifyToken: async (token, checkRevoked) => {
      verifyCalls.push({ token, checkRevoked });
      if (token !== "valid-token") throw new Error("invalid token");
      return { uid: identity.uid, email: identity.email, email_verified: true, auth_time: identity.authTime };
    },
    now: () => 123456, services: { ...services, ...overrides }
  });
  return { handlers, calls, verifyCalls };
}

test("organization callable derives actor only from revocation-checked verified token", async () => {
  const { handlers, calls, verifyCalls } = setup();
  await handlers.createSite(request({ accountId: "account-1", displayName: "Site A", reasonCode: "setup", actorUid: "attacker" }));
  assert.deepEqual(verifyCalls, [{ token: "valid-token", checkRevoked: true }]);
  assert.equal(calls[0].args.actorUid, "verified-admin");
  assert.equal(calls[0].args.now(), 123456);
  assert.equal("actorUid" in calls[0].args, true);
});

test("organization callables reject missing, invalid and revoked tokens before service calls", async () => {
  const { handlers, calls } = setup();
  await assert.rejects(handlers.createSite(request({ accountId: "account-1", displayName: "Site", reasonCode: "setup" }, "")), e => e.code === "unauthenticated");
  await assert.rejects(handlers.createSite(request({ accountId: "account-1", displayName: "Site", reasonCode: "setup" }, "revoked-token")), e => e.code === "unauthenticated");
  assert.equal(calls.length, 0);
});

test("organization callables reject client-supplied identity and unsupported fields", async () => {
  const { handlers, calls } = setup();
  await assert.rejects(handlers.archiveSite(request({ accountId: "account-1", siteId: "site-1", reasonCode: "close", actorUid: "admin" })), e => e.code === "invalid-argument");
  assert.equal(calls.length, 0);
});

test("all organization operations forward only validated selectors and verified actor", async () => {
  const { handlers, calls } = setup();
  await handlers.createDepartment(request({ accountId: "a1", siteId: "s1", displayName: "Dept", reasonCode: "setup" }));
  await handlers.archiveDepartment(request({ accountId: "a1", departmentId: "d1", reasonCode: "close" }));
  await handlers.archiveSite(request({ accountId: "a1", siteId: "s1", reasonCode: "close" }));
  await handlers.transferDepartment(request({ accountId: "a1", departmentId: "d1", sourceSiteId: "s1", destinationSiteId: "s2", expectedVersion: 4, reasonCode: "move" }));
  assert.deepEqual(calls.map(x => x.name), ["createDepartment", "archiveDepartment", "archiveSite", "transferDepartment"]);
  assert.ok(calls.every(x => x.args.actorUid === "verified-admin" && x.args.db.trusted));
  assert.equal(calls[3].args.expectedVersion, 4);
});

test("organization callables validate identifiers, reason codes and transfer version", async () => {
  const { handlers, calls } = setup();
  await assert.rejects(handlers.createDepartment(request({ accountId: "../other", siteId: "s1", displayName: "Dept", reasonCode: "setup" })), e => e.code === "invalid-argument");
  await assert.rejects(handlers.archiveSite(request({ accountId: "a1", siteId: "s1", reasonCode: "not allowed" })), e => e.code === "invalid-argument");
  await handlers.transferDepartment(request({ accountId: "a1", departmentId: "d1", sourceSiteId: "s1", destinationSiteId: "s2", expectedVersion: "4", reasonCode: "move" }));
  assert.equal(calls[0].args.expectedVersion, "4");
});
