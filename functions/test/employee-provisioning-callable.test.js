import test from "node:test";
import assert from "node:assert/strict";
import { createEmployeeProvisioningHandlers } from "../src/membership/employee-provisioning-callable-handlers.js";

const db = Object.freeze({ trusted: true });
function request(data, token = "signed-token") {
  return { data, rawRequest: { headers: { authorization: `Bearer ${token}` } } };
}

test("Employee provisioning callable derives proposer UID and MFA only from revocation-checked token", async () => {
  const calls = [];
  const handlers = createEmployeeProvisioningHandlers({
    db, now: () => 1234,
    verifyToken: async (token, checkRevoked) => {
      calls.push(["verify", token, checkRevoked]);
      return {
        uid: "verified-admin", email_verified: true, auth_time: 1,
        firebase: { sign_in_second_factor: "totp" }
      };
    },
    services: {
      proposeEmployeeProvisioning: async args => { calls.push(["propose", args]); return { status: "pending" }; },
      approveEmployeeProvisioning: async args => { calls.push(["approve", args]); return { status: "approved" }; }
    }
  });
  await handlers.propose(request({
    accountId: "acct-1", proposalId: "proposal-1", targetUid: "member-1",
    employeeId: "employee-1", verificationRef: "manual-1",
    actorUid: "attacker", actorIdentity: { uid: "attacker", secondFactor: "totp" }
  }));
  const invocation = calls.find(x => x[0] === "propose")[1];
  assert.equal(calls[0][2], true);
  assert.equal(invocation.actorUid, "verified-admin");
  assert.equal(invocation.actorIdentity.uid, "verified-admin");
  assert.equal(invocation.actorIdentity.secondFactor, "totp");
  assert.equal(invocation.accountId, "acct-1");
  assert.equal(invocation.now(), 1234);
});

test("Employee approval callable ignores client actor identity and passes verified identity", async () => {
  let invocation;
  const handlers = createEmployeeProvisioningHandlers({
    db, verifyToken: async () => ({
      uid: "approver-2", email_verified: true, auth_time: 10,
      firebase: { sign_in_second_factor: "totp" }
    }),
    services: {
      proposeEmployeeProvisioning: async () => ({}),
      approveEmployeeProvisioning: async args => { invocation = args; return { status: "approved" }; }
    }
  });
  await handlers.approve(request({
    accountId: "acct-1", proposalId: "proposal-1",
    actorUid: "spoofed", actorIdentity: { uid: "spoofed" }
  }));
  assert.equal(invocation.actorUid, "approver-2");
  assert.equal(invocation.actorIdentity.uid, "approver-2");
  assert.equal(invocation.proposalId, "proposal-1");
});

test("Employee provisioning callable rejects absent bearer, unverified email and failed token verification", async () => {
  const handlers = createEmployeeProvisioningHandlers({
    db, verifyToken: async () => ({ uid: "x", email_verified: false }),
    services: {
      proposeEmployeeProvisioning: async () => ({}),
      approveEmployeeProvisioning: async () => ({})
    }
  });
  await assert.rejects(handlers.propose({ data: {}, rawRequest: { headers: {} } }),
    error => error.code === "unauthenticated");
  await assert.rejects(handlers.propose(request({})),
    error => error.code === "unauthenticated");
  const failed = createEmployeeProvisioningHandlers({
    db, verifyToken: async () => { throw new Error("revoked"); },
    services: { proposeEmployeeProvisioning: async () => ({}), approveEmployeeProvisioning: async () => ({}) }
  });
  await assert.rejects(failed.approve(request({})), error => error.code === "unauthenticated");
});
