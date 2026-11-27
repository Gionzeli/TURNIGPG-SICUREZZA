import test from "node:test";
import assert from "node:assert/strict";
import { createEmployeeProvisioningHandlers } from "../src/membership/employee-provisioning-callable-handlers.js";

test("Employee provisioning callables reject unknown client fields before identity lookup", async () => {
  let verificationCalls = 0;
  const calls = [];
  const services = {
    proposeEmployeeProvisioning: async args => { calls.push(["propose", args]); return { status: "pending" }; },
    approveEmployeeProvisioning: async args => { calls.push(["approve", args]); return { status: "approved" }; },
    revokeEmployeeBinding: async args => { calls.push(["revoke", args]); return { status: "revoked" }; }
  };
  const handlers = createEmployeeProvisioningHandlers({
    db: {},
    verifyToken: async (token, checkRevoked) => {
      verificationCalls++;
      assert.equal(token, "synthetic-token");
      assert.equal(checkRevoked, true);
      return {
        uid: "synthetic-admin",
        email_verified: true,
        auth_time: 100,
        firebase: { sign_in_second_factor: "totp" }
      };
    },
    services
  });
  const request = data => ({
    rawRequest: { headers: { authorization: "Bearer synthetic-token" } },
    data
  });

  await assert.rejects(
    handlers.propose(request({
      accountId: "account-1", proposalId: "proposal-1", targetUid: "member-1",
      employeeId: "employee-1", verificationRef: "ticket-1", role: "admin"
    })),
    error => error.code === "invalid-argument"
  );
  await assert.rejects(
    handlers.approve(request({ accountId: "account-1", proposalId: "proposal-1", uid: "other-user" })),
    error => error.code === "invalid-argument"
  );
  await assert.rejects(
    handlers.revoke(request({ accountId: "account-1", employeeId: "employee-1", eventId: "event-1", status: "active" })),
    error => error.code === "invalid-argument"
  );
  assert.equal(verificationCalls, 0);
  assert.equal(calls.length, 0);

  await handlers.propose(request({
    accountId: "account-1", proposalId: "proposal-1", targetUid: "member-1",
    employeeId: "employee-1", verificationRef: "ticket-1"
  }));
  await handlers.approve(request({ accountId: "account-1", proposalId: "proposal-1" }));
  await handlers.revoke(request({ accountId: "account-1", employeeId: "employee-1", eventId: "event-1" }));
  assert.equal(verificationCalls, 3);
  assert.deepEqual(calls.map(([name]) => name), ["propose", "approve", "revoke"]);
  for (const [, args] of calls) assert.equal(args.actorUid, "synthetic-admin");
});
