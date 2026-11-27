import test from "node:test";
import assert from "node:assert/strict";
import { createMailboxSecretCleanupWorker } from "../src/membership/mailbox-secret-cleanup-worker.js";
const ticket = {
  accountId: "synthetic-account", connectionId: "synthetic-connection",
  secretRef: "vault://synthetic/ref", status: "pending", attempts: 1,
  nextAttemptAt: null
};

test("worker deletes secret and marks durable ticket complete", async () => {
  const calls = [];
  const worker = createMailboxSecretCleanupWorker({
    cleanupAdapters: {
      listPendingSecretCleanup: async input => { calls.push({ listed: input }); return [ticket]; },
      completeSecretCleanup: async input => calls.push({ completed: input }),
      recordSecretCleanupFailure: async () => assert.fail("unexpected retry")
    },
    credentialVault: { revokeSecret: async input => calls.push(input) },
    alert: async () => assert.fail("unexpected alert"),
    now: () => 1000
  });
  assert.deepEqual(await worker.runOnce({ accountId: "synthetic-account" }), { scanned: 1, completed: 1, deferred: 0, exhausted: 0 });
  assert.equal(calls.length, 2);
});

test("worker persists exponential retry delay and alerts at retry ceiling", async () => {
  const retries = [], alerts = [];
  let records = [
    { ...ticket, attempts: 1 },
    { ...ticket, connectionId: "synthetic-exhausted", attempts: 11 },
    { ...ticket, connectionId: "future", nextAttemptAt: 9000 }
  ];
  const worker = createMailboxSecretCleanupWorker({
    cleanupAdapters: {
      listPendingSecretCleanup: async ({ accountId }) => records.filter(item => item.accountId === accountId),
      completeSecretCleanup: async () => {},
      recordSecretCleanupFailure: async input => {
      retries.push(input);
      records = records.map(item => item.connectionId === input.connectionId
        ? { ...item, attempts: input.attempts, nextAttemptAt: input.nextAttemptAt }
        : item);
      }
    },
    credentialVault: {
      revokeSecret: async () => { throw Object.assign(new Error("masked"), { code: "unavailable" }); }
    },
    alert: async input => alerts.push(input),
    now: () => 1000
  });
  const result = await worker.runOnce({ accountId: "synthetic-account" });
  assert.equal(result.scanned, 3);
  assert.equal(result.deferred, 2);
  assert.equal(result.exhausted, 1);
  assert.equal(retries.length, 2);
  assert.equal(retries[0].attempts, 2);
  assert.equal(retries[0].nextAttemptAt, 121000);
  assert.equal(retries[1].attempts, 12);
  assert.equal(retries[1].nextAttemptAt, null);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].connectionId, "synthetic-exhausted");
  const secondRun = await worker.runOnce({ accountId: "synthetic-account" });
  assert.deepEqual(secondRun, { scanned: 3, completed: 0, deferred: 1, exhausted: 1 });
  assert.equal(retries.length, 2, "exhausted tickets are not retried");
  assert.equal(alerts.length, 1, "exhaustion alert is not repeated");
});

test("worker validates batch bounds and ignores malformed tickets", async () => {
  const worker = createMailboxSecretCleanupWorker({
    cleanupAdapters: {
      listPendingSecretCleanup: async () => [{ secretRef: "invalid" }],
      completeSecretCleanup: async () => {},
      recordSecretCleanupFailure: async () => {}
    },
    credentialVault: { revokeSecret: async () => {} },
    alert: async () => {}, now: () => 500
  });
  await assert.rejects(worker.runOnce({ accountId: "synthetic-account", limit: 101 }), error => error.code === "invalid-argument");
  await assert.rejects(worker.runOnce(), error => error.code === "invalid-argument");
  assert.deepEqual(await worker.runOnce({ accountId: "synthetic-account" }), { scanned: 1, completed: 0, deferred: 1, exhausted: 0 });
});
