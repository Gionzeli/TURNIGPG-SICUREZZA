import test from "node:test";
import assert from "node:assert/strict";
import { createEmployeeScheduleMailboxConnectionService } from "../src/membership/employee-schedule-mailbox-connection-service.js";

const accountId = "synthetic-account";
const actor = { uid: "synthetic-employee-uid" };

function harness(overrides = {}) {
  const calls = { stored: [], saved: [], disabled: [], deleted: [], loaded: null };
  const service = createEmployeeScheduleMailboxConnectionService({
    authorizePersonalConnection: async ({ actor: identity }) => ({
      authorized: identity.uid === actor.uid, uid: identity.uid, employeeId: "synthetic-employee"
    }),
    authorizeSharedConnection: async () => ({ authorized: true }),
    loadConnection: async () => calls.loaded,
    saveConnection: async input => { calls.saved.push(input); },
    disableConnection: async input => { calls.disabled.push(input); },
    storeSecret: async input => { calls.stored.push(input); return "secret-manager://synthetic/mailbox"; },
    deleteSecret: async input => { calls.deleted.push(input); },
    createConnectionId: () => "synthetic-connection",
    now: () => 1795766400000,
    ...overrides
  });
  return { service, calls };
}

const connectInput = {
  accountId, actor, mode: "personal", provider: "imap",
  mailboxAddress: "collaboratore@example.invalid",
  allowedSenders: ["turni@azienda.example"],
  credential: { accessToken: "synthetic-secret", refreshToken: "synthetic-refresh" }
};

test("personal mailbox connection is bound to verified employee and credentials go only to vault", async () => {
  const { service, calls } = harness();
  const result = await service.connect(connectInput);
  assert.equal(result.status, "active");
  assert.equal(result.mode, "personal");
  assert.equal(calls.stored.length, 1);
  assert.equal(calls.stored[0].credential.refreshToken, "synthetic-refresh");
  assert.equal(calls.saved.length, 1);
  const serialized = JSON.stringify(calls.saved[0]);
  assert.equal(serialized.includes("synthetic-secret"), false);
  assert.equal(serialized.includes("synthetic-refresh"), false);
  assert.equal(calls.saved[0].record.ownerUid, actor.uid);
  assert.equal(calls.saved[0].record.ownerEmployeeId, "synthetic-employee");
  assert.equal(calls.saved[0].record.secretRef, "secret-manager://synthetic/mailbox");
  assert.equal(Object.hasOwn(result, "secretRef"), false);
});

test("personal mailbox connection denies an actor without verified Employee authorization", async () => {
  const { service, calls } = harness({
    authorizePersonalConnection: async () => ({ authorized: false })
  });
  await assert.rejects(service.connect(connectInput), error => error.code === "permission-denied");
  assert.equal(calls.stored.length, 0);
  assert.equal(calls.saved.length, 0);
});

test("shared mailbox requires separate server-side authorization and stores no employee owner", async () => {
  const { service, calls } = harness();
  const result = await service.connect({ ...connectInput, mode: "shared", provider: "microsoft_graph" });
  assert.equal(result.mode, "shared");
  assert.equal(Object.hasOwn(calls.saved[0].record, "ownerUid"), false);
  assert.equal(Object.hasOwn(calls.saved[0].record, "ownerEmployeeId"), false);
});

test("unauthorized actor cannot connect a shared mailbox", async () => {
  const { service, calls } = harness({
    authorizeSharedConnection: async () => ({ authorized: false })
  });
  await assert.rejects(
    service.connect({ ...connectInput, mode: "shared" }),
    error => error.code === "permission-denied"
  );
  assert.equal(calls.stored.length, 0);
});

test("personal mailbox revocation is limited to the same verified Employee and disables polling before secret deletion", async () => {
  const { service, calls } = harness();
  calls.loaded = {
    accountId, connectionId: "synthetic-connection", mode: "personal",
    ownerUid: actor.uid, ownerEmployeeId: "synthetic-employee",
    status: "active", secretRef: "secret-manager://synthetic/mailbox", version: 3
  };
  const result = await service.revoke({ accountId, connectionId: "synthetic-connection", actor });
  assert.equal(result.status, "revoked");
  assert.equal(calls.disabled.length, 1);
  assert.equal(calls.disabled[0].expectedVersion, 3);
  assert.equal(calls.disabled[0].patch.version, 4);
  assert.equal(calls.deleted.length, 1);
});

test("another employee cannot revoke a personal mailbox connection", async () => {
  const { service, calls } = harness({
    authorizePersonalConnection: async () => ({
      authorized: true, uid: "other-uid", employeeId: "other-employee"
    })
  });
  calls.loaded = {
    accountId, connectionId: "synthetic-connection", mode: "personal",
    ownerUid: actor.uid, ownerEmployeeId: "synthetic-employee",
    status: "active", secretRef: "secret-manager://synthetic/mailbox", version: 1
  };
  await assert.rejects(
    service.revoke({ accountId, connectionId: "synthetic-connection", actor: { uid: "other-uid" } }),
    error => error.code === "permission-denied"
  );
  assert.equal(calls.disabled.length, 0);
  assert.equal(calls.deleted.length, 0);
});

test("shared mailbox revocation requires current shared-mailbox authorization", async () => {
  const { service, calls } = harness({
    authorizeSharedConnection: async () => ({ authorized: false })
  });
  calls.loaded = {
    accountId, connectionId: "synthetic-connection", mode: "shared",
    status: "active", secretRef: "secret-manager://synthetic/mailbox", version: 1
  };
  await assert.rejects(
    service.revoke({ accountId, connectionId: "synthetic-connection", actor }),
    error => error.code === "permission-denied"
  );
  assert.equal(calls.disabled.length, 0);
});

test("failed connection persistence cleans up the vault secret", async () => {
  const { service, calls } = harness({
    saveConnection: async () => { throw new Error("synthetic Firestore failure"); }
  });
  await assert.rejects(service.connect(connectInput), /synthetic Firestore failure/);
  assert.equal(calls.deleted.length, 1);
  assert.equal(calls.deleted[0].secretRef, "secret-manager://synthetic/mailbox");
});

test("connection input rejects invalid provider and malformed sender allowlist before storing secrets", async () => {
  const { service, calls } = harness();
  await assert.rejects(
    service.connect({ ...connectInput, provider: "unknown-provider" }),
    error => error.code === "invalid-argument"
  );
  await assert.rejects(
    service.connect({ ...connectInput, allowedSenders: ["not-an-email"] }),
    error => error.code === "invalid-argument"
  );
  assert.equal(calls.stored.length, 0);
});
