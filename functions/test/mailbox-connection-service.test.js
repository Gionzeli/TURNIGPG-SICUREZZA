import test from "node:test";
import assert from "node:assert/strict";
import { createMailboxConnectionService } from "../src/membership/mailbox-connection-service.js";

const base = {
  accountId: "synthetic-account",
  actorUid: "synthetic-uid",
  mode: "personal",
  provider: "imap",
  allowedSenders: ["turni@azienda.example"],
  authorizationPayload: { authorizationCode: "synthetic-only" }
};

function harness(overrides = {}) {
  const calls = { secrets: [], revoked: [], disabled: [], saved: [], audits: [], exchanges: 0 };
  const principal = {
    accountId: base.accountId, uid: base.actorUid, status: "active",
    role: "member", employeeId: "synthetic-employee",
    email: "collaboratore@example.invalid",
    permissions: { manageSharedMailboxConnections: false }
  };
  const service = createMailboxConnectionService({
    authorizeActor: async () => principal,
    exchangeAuthorization: async ({ provider }) => {
      calls.exchanges++;
      return {
        provider, mailboxVerified: true, mailboxAddress: "collaboratore@example.invalid",
        secretMaterial: { accessToken: "synthetic-secret" }
      };
    },
    storeSecret: async input => { calls.secrets.push(input); return "vault://synthetic/secret-1"; },
    revokeSecret: async input => { calls.revoked.push(input); },
    disableRefresh: async input => { calls.disabled.push(input); },
    saveConnection: async input => { calls.saved.push(input); },
    loadConnection: async () => calls.saved.at(-1)?.connection,
    writeAudit: async input => { calls.audits.push(input); },
    createConnectionId: () => "synthetic-connection",
    now: () => 1795766400000,
    ...overrides
  });
  return { service, calls, principal };
}

test("personal connection binds verified mailbox to the employee and stores only a vault reference", async () => {
  const { service, calls } = harness();
  const result = await service.connect(base);
  assert.equal(result.status, "active");
  assert.equal(result.mode, "personal");
  const stored = calls.saved[0].connection;
  assert.equal(stored.ownerUid, "synthetic-uid");
  assert.equal(stored.ownerEmployeeId, "synthetic-employee");
  assert.equal(stored.credentialSecretRef, "vault://synthetic/secret-1");
  assert.equal(Object.hasOwn(stored, "secretMaterial"), false);
  assert.equal(Object.hasOwn(result, "credentialSecretRef"), false);
  assert.equal(calls.secrets.length, 1);
  assert.deepEqual(calls.secrets[0].secretMaterial, { accessToken: "synthetic-secret" });
});

test("personal mailbox cannot be connected when provider identity differs from verified member email", async () => {
  const { service, calls } = harness({
    exchangeAuthorization: async () => ({
      provider: "imap", mailboxVerified: true, mailboxAddress: "other@example.invalid",
      secretMaterial: { accessToken: "synthetic-secret" }
    })
  });
  await assert.rejects(service.connect(base), error => error.code === "permission-denied");
  assert.equal(calls.secrets.length, 0);
  assert.equal(calls.saved.length, 0);
});

test("shared connection requires explicit mailbox-management permission", async () => {
  const { service, calls } = harness();
  await assert.rejects(service.connect({
    ...base, mode: "shared", allowedSenders: ["turni@azienda.example"]
  }), error => error.code === "permission-denied");
  assert.equal(calls.exchanges, 0);
});

test("shared connection stores no personal employee ownership", async () => {
  const principal = {
    accountId: base.accountId, uid: base.actorUid, status: "active",
    role: "organization_manager", permissions: { manageSharedMailboxConnections: true }
  };
  const { service, calls } = harness({
    authorizeActor: async () => principal,
    exchangeAuthorization: async ({ provider }) => ({
      provider, mailboxVerified: true, mailboxAddress: "turni@azienda.example",
      secretMaterial: { refreshToken: "synthetic-secret" }
    })
  });
  const result = await service.connect({ ...base, mode: "shared" });
  assert.equal(result.mode, "shared");
  assert.equal(calls.saved[0].connection.ownerUid, null);
  assert.equal(calls.saved[0].connection.ownerEmployeeId, null);
});

test("connection persistence failure revokes newly stored secret", async () => {
  const { service, calls } = harness({
    saveConnection: async () => { throw new Error("synthetic persistence failure"); }
  });
  await assert.rejects(service.connect(base), /synthetic persistence failure/);
  assert.equal(calls.secrets.length, 1);
  assert.equal(calls.revoked.length, 1);
});

test("personal mailbox can be revoked only by its bound employee and is fail-closed during revocation", async () => {
  const { service, calls } = harness();
  await service.connect(base);
  const result = await service.revoke({
    accountId: base.accountId, actorUid: base.actorUid, connectionId: "synthetic-connection"
  });
  assert.equal(result.status, "revoked");
  assert.deepEqual(calls.saved.map(item => item.connection.status), ["active", "revocation_pending", "revoked"]);
  assert.equal(calls.disabled.length, 1);
  assert.equal(calls.revoked.length, 1);
  assert.equal(calls.saved.at(-1).connection.credentialSecretRef, null);
});

test("failed vault revocation leaves connection in non-active revocation_pending state", async () => {
  const { service, calls } = harness({
    revokeSecret: async () => { throw new Error("synthetic vault outage"); }
  });
  await service.connect(base);
  await assert.rejects(service.revoke({
    accountId: base.accountId, actorUid: base.actorUid, connectionId: "synthetic-connection"
  }), /synthetic vault outage/);
  assert.equal(calls.saved.at(-1).connection.status, "revocation_pending");
  assert.equal(calls.disabled.length, 1);
});


test("failed refresh disable gate prevents credential deletion", async () => {
  const { service, calls } = harness({
    disableRefresh: async () => { throw new Error("synthetic gate outage"); }
  });
  await service.connect(base);
  await assert.rejects(service.revoke({
    accountId: base.accountId, actorUid: base.actorUid, connectionId: "synthetic-connection"
  }), /synthetic gate outage/);
  assert.equal(calls.revoked.length, 0);
  assert.equal(calls.saved.at(-1).connection.status, "revocation_pending");
});

test("refresh is disabled before vault revocation is attempted", async () => {
  const order = [];
  const { service } = harness({
    disableRefresh: async () => { order.push("disable"); },
    revokeSecret: async () => { order.push("revoke"); }
  });
  await service.connect(base);
  await service.revoke({
    accountId: base.accountId, actorUid: base.actorUid, connectionId: "synthetic-connection"
  });
  assert.deepEqual(order, ["disable", "revoke"]);
});

test("sender allowlist rejects malformed and duplicate addresses", async () => {
  const { service, calls } = harness();
  await assert.rejects(service.connect({ ...base, allowedSenders: ["bad-address"] }),
    error => error.code === "invalid-argument");
  await assert.rejects(service.connect({ ...base, allowedSenders: ["A@EXAMPLE.COM", "a@example.com"] }),
    error => error.code === "invalid-argument");
  assert.equal(calls.exchanges, 0);
});


test("attempts scoped vault cleanup when storage returns an oversized secret reference", async () => {
  const malformedRef = "x".repeat(513);
  const { service, calls } = harness({
    storeSecret: async () => malformedRef
  });
  await assert.rejects(service.connect(base), error => error.code === "failed-precondition");
  assert.equal(calls.saved.length, 0);
  assert.equal(calls.revoked.length, 1);
  assert.equal(calls.revoked[0].secretRef, malformedRef);
});
