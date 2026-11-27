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
    listPending: async () => [ticket],
    revokeSecret: async input => calls.push(input),
    completeCleanup: async input => calls.push({ completed: input }),
    recordFailure: async () => assert.fail("unexpected retry"),
    alert: async () => assert.fail("unexpected alert"),
    now: () => 1000
  });
  assert.deepEqual(await worker.runOnce(), { scanned: 1, completed: 1, deferred: 0, exhausted: 0 });
  assert.equal(calls.length, 2);
});

test("worker persists exponential retry delay and alerts at retry ceiling", async () => {
  let now = 1000;
  const retries = [], alerts = [];
  const worker = createMailboxSecretCleanupWorker({
    listPending: async () => [
      { ...ticket, attempts: 1 },
      { ...ticket, connectionId: "synthetic-exhausted", attempts: 11 },
      { ...ticket, connectionId: "future", nextAttemptAt: 9000 }
    ],
    revokeSecret: async () => { throw Object.assign(new Error("masked"), { code: "unavailable" }); },
    completeCleanup: async () => {},
    recordFailure: async input => retries.push(input),
    alert: async input => alerts.push(input),
    now: () => now
  });
  const result = await worker.runOnce();
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
});

test("worker validates batch bounds and ignores malformed tickets", async () => {
  const worker = createMailboxSecretCleanupWorker({
    listPending: async () => [{ secretRef: "invalid" }],
    revokeSecret: async () => {}, completeCleanup: async () => {},
    recordFailure: async () => {}, alert: async () => {}, now: () => 500
  });
  await assert.rejects(worker.runOnce({ limit: 101 }), error => error.code === "invalid-argument");
  assert.deepEqual(await worker.runOnce(), { scanned: 1, completed: 0, deferred: 1, exhausted: 0 });
});
