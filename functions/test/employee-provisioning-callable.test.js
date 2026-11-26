import test from "node:test";
import assert from "node:assert/strict";
import { createEmployeeProvisioningHandlers } from "../src/membership/employee-provisioning-callable-handlers.js";
const db = Object.freeze({ trusted: true });
const req = data => ({ data, rawRequest: { headers: { authorization: "Bearer signed-token" } } });
const verified = uid => ({ uid, email_verified: true, auth_time: 1, firebase: { sign_in_second_factor: "totp" } });
test("Employee provisioning callables derive actors from revocation-checked tokens", async () => {
  const calls = [];
  const handlers = createEmployeeProvisioningHandlers({ db, now: () => 1234, verifyToken: async (token, checkRevoked) => { calls.push(["verify", token, checkRevoked]); return verified("verified-admin"); }, services: {
    proposeEmployeeProvisioning: async args => { calls.push(["propose", args]); return { status: "pending" }; },
    approveEmployeeProvisioning: async args => { calls.push(["approve", args]); return { status: "approved" }; },
    revokeEmployeeBinding: async args => { calls.push(["revoke", args]); return { status: "revoked" }; }
  }});
  await handlers.propose(req({ accountId: "acct-1", proposalId: "p-1", targetUid: "member-1", employeeId: "emp-1", verificationRef: "manual-1", actorUid: "spoofed" }));
  assert.equal(calls[0][2], true);
  assert.equal(calls.find(x => x[0] === "propose")[1].actorUid, "verified-admin");
  await handlers.approve(req({ accountId: "acct-1", proposalId: "p-1", actorUid: "spoofed" }));
  assert.equal(calls.find(x => x[0] === "approve")[1].actorUid, "verified-admin");
  await handlers.revoke(req({ accountId: "acct-1", employeeId: "emp-1", eventId: "evt-1", actorUid: "spoofed" }));
  assert.equal(calls.find(x => x[0] === "revoke")[1].actorUid, "verified-admin");
});
test("Employee provisioning callable rejects absent bearer and unverified email", async () => {
  const services = { proposeEmployeeProvisioning: async () => ({}), approveEmployeeProvisioning: async () => ({}), revokeEmployeeBinding: async () => ({}) };
  const handlers = createEmployeeProvisioningHandlers({ db, verifyToken: async () => ({ uid: "x", email_verified: false }), services });
  await assert.rejects(handlers.propose({ data: {}, rawRequest: { headers: {} } }), e => e.code === "unauthenticated");
  await assert.rejects(handlers.propose(req({})), e => e.code === "unauthenticated");
});
