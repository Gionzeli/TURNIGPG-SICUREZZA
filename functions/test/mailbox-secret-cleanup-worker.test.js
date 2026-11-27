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
      recordSecretCleanupFailure: async () => assert.fail("unexpected retry"),
      listPendingCleanupAlerts: async () => [],
      recordCleanupAlertFailure: async () => {},
      markCleanupAlertDelivered: async () => {}
    },
    credentialVault: { revokeSecret: async input => calls.push(input) },
    alert: async () => assert.fail("unexpected alert"),
    now: () => 1000
  });
  assert.deepEqual(await worker.runOnce({ accountId: "synthetic-account" }), { scanned: 1, completed: 1, deferred: 0, exhausted: 0 });
  assert.deepEqual(calls[0], { listed: { accountId: "synthetic-account", limit: 50 } });
  assert.equal(calls.length, 3);
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
      listPendingSecretCleanup: async ({ accountId }) => records.filter(item => item.accountId === accountId && item.status !== "exhausted"),
      completeSecretCleanup: async () => {},
      recordSecretCleanupFailure: async input => {
        retries.push(input);
        records = records.map(item => item.connectionId === input.connectionId
          ? { ...item, status: input.attempts >= 12 ? "exhausted" : "pending",
              alertStatus: input.attempts >= 12 ? "pending" : null,
              attempts: input.attempts, nextAttemptAt: input.attempts >= 12 ? null : input.nextAttemptAt,
              lastErrorCode: input.lastErrorCode }
          : item);
      },
      listPendingCleanupAlerts: async ({ accountId }) => records.filter(item =>
        item.accountId === accountId && item.status === "exhausted" && item.alertStatus === "pending"),
      recordCleanupAlertFailure: async () => {},
      markCleanupAlertDelivered: async ({ connectionId }) => {
        records = records.map(item => item.connectionId === connectionId
          ? { ...item, alertStatus: "delivered" } : item);
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
  assert.deepEqual(secondRun, { scanned: 2, completed: 0, deferred: 2, exhausted: 0 });
  assert.equal(retries.length, 2, "exhausted tickets are not retried");
  assert.equal(alerts.length, 1, "exhaustion alert is not repeated");
});

test("worker validates batch bounds and ignores malformed tickets", async () => {
  const worker = createMailboxSecretCleanupWorker({
    cleanupAdapters: {
      listPendingSecretCleanup: async () => [{ secretRef: "invalid" }],
      completeSecretCleanup: async () => {},
      recordSecretCleanupFailure: async () => {},
      listPendingCleanupAlerts: async () => [],
      recordCleanupAlertFailure: async () => {},
      markCleanupAlertDelivered: async () => {}
    },
    credentialVault: { revokeSecret: async () => {} },
    alert: async () => {}, now: () => 500
  });
  await assert.rejects(worker.runOnce({ accountId: "synthetic-account", limit: 101 }), error => error.code === "invalid-argument");
  await assert.rejects(worker.runOnce(), error => error.code === "invalid-argument");
  assert.deepEqual(await worker.runOnce({ accountId: "synthetic-account" }), { scanned: 1, completed: 0, deferred: 1, exhausted: 0 });
});


test("worker rejects cross-account tickets before calling the vault", async () => {
  let revoked = 0;
  const worker = createMailboxSecretCleanupWorker({
    cleanupAdapters: {
      listPendingSecretCleanup: async () => [
        { ...ticket, accountId: "different-account" }
      ],
      completeSecretCleanup: async () => {},
      recordSecretCleanupFailure: async () => {},
      listPendingCleanupAlerts: async () => [],
      recordCleanupAlertFailure: async () => {},
      markCleanupAlertDelivered: async () => {}
    },
    credentialVault: { revokeSecret: async () => { revoked++; } },
    alert: async () => {}, now: () => 1000
  });
  assert.deepEqual(await worker.runOnce({ accountId: "synthetic-account" }), {
    scanned: 1, completed: 0, deferred: 1, exhausted: 0
  });
  assert.equal(revoked, 0);
});


test("worker does not alert exhaustion until the exhausted state is durably recorded", async () => {
  const alerts = [];
  const worker = createMailboxSecretCleanupWorker({
    cleanupAdapters: {
      listPendingSecretCleanup: async () => [{ ...ticket, attempts: 11 }],
      completeSecretCleanup: async () => {},
      recordSecretCleanupFailure: async () => { throw Object.assign(new Error("storage unavailable"), { code: "unavailable" }); },
      listPendingCleanupAlerts: async () => [],
      recordCleanupAlertFailure: async () => {},
      markCleanupAlertDelivered: async () => {}
    },
    credentialVault: { revokeSecret: async () => { throw Object.assign(new Error("vault unavailable"), { code: "unavailable" }); } },
    alert: async input => alerts.push(input),
    now: () => 1000
  });
  assert.deepEqual(await worker.runOnce({ accountId: "synthetic-account" }), {
    scanned: 1, completed: 0, deferred: 1, exhausted: 0
  });
  assert.equal(alerts.length, 0);
});


test("worker retries failed exhaustion alert delivery on a later invocation", async () => {
  let alertStatus = "pending";
  let attempts = 12;
  let calls = 0;
  let clock = 2000;
  let alertAttempts = 0;
  let alertNextAttemptAt = null;
  const worker = createMailboxSecretCleanupWorker({
    cleanupAdapters: {
      listPendingSecretCleanup: async () => [],
      completeSecretCleanup: async () => {},
      recordSecretCleanupFailure: async () => {},
      listPendingCleanupAlerts: async ({ accountId }) => alertStatus === "pending"
        ? [{ accountId, connectionId: "exhausted-connection", status: "exhausted",
            alertStatus, attempts, lastErrorCode: "unavailable",
            alertAttempts, alertNextAttemptAt }]
        : [],
      recordCleanupAlertFailure: async input => {
        alertAttempts = input.attempts;
        alertNextAttemptAt = input.nextAttemptAt;
      },
      markCleanupAlertDelivered: async () => { alertStatus = "delivered"; }
    },
    credentialVault: { revokeSecret: async () => {} },
    alert: async input => {
      calls++;
      assert.equal(input.alertId, "synthetic-account:exhausted-connection:cleanup-exhausted");
      if (calls === 1) throw Object.assign(new Error("alert transport unavailable"), { code: "unavailable" });
    },
    now: () => clock
  });
  const first = await worker.runOnce({ accountId: "synthetic-account" });
  assert.equal(first.scanned, 0);
  assert.equal(alertStatus, "pending");
  assert.equal(alertAttempts, 1);
  assert.equal(alertNextAttemptAt, 62000);
  await worker.runOnce({ accountId: "synthetic-account" });
  assert.equal(calls, 1, "alert backoff prevents immediate retry");
  clock = alertNextAttemptAt;
  await worker.runOnce({ accountId: "synthetic-account" });
  assert.equal(calls, 2);
  assert.equal(alertStatus, "delivered");
  await worker.runOnce({ accountId: "synthetic-account" });
  assert.equal(calls, 2, "delivered alert is not sent again");
});


test("worker passes only the alert allowlist even when an adapter returns extra fields", async () => {
  const delivered = [];
  const worker = createMailboxSecretCleanupWorker({
    cleanupAdapters: {
      listPendingSecretCleanup: async () => [],
      completeSecretCleanup: async () => {},
      recordSecretCleanupFailure: async () => {},
      listPendingCleanupAlerts: async ({ accountId }) => [{
        accountId, connectionId: "safe-connection", status: "exhausted",
        alertStatus: "pending", attempts: 12, lastErrorCode: "unavailable",
        alertAttempts: 0, alertNextAttemptAt: null, alertLastErrorCode: null,
        secretRef: "vault://must-not-leak", reason: "internal_reason",
        mailboxAddress: "private@example.invalid", provider: "imap",
        ownerUid: "private-owner", arbitrary: "untrusted"
      }],
      recordCleanupAlertFailure: async () => {},
      markCleanupAlertDelivered: async () => {}
    },
    credentialVault: { revokeSecret: async () => {} },
    alert: async input => delivered.push(input),
    now: () => 1000
  });
  await worker.runOnce({ accountId: "synthetic-account" });
  assert.deepEqual(delivered, [{
    alertId: "synthetic-account:safe-connection:cleanup-exhausted",
    accountId: "synthetic-account",
    connectionId: "safe-connection",
    attempts: 12,
    code: "unavailable"
  }]);
});


test("worker rejects malformed connection ids before vault or alert side effects", async () => {
  let vaultCalls = 0;
  let alertCalls = 0;
  const worker = createMailboxSecretCleanupWorker({
    cleanupAdapters: {
      listPendingSecretCleanup: async () => [{ ...ticket, connectionId: "bad/id" }],
      completeSecretCleanup: async () => {},
      recordSecretCleanupFailure: async () => {},
      listPendingCleanupAlerts: async ({ accountId }) => [{
        accountId, connectionId: "bad\nalert", status: "exhausted",
        alertStatus: "pending", attempts: 12, lastErrorCode: "unavailable",
        alertAttempts: 0, alertNextAttemptAt: null
      }],
      recordCleanupAlertFailure: async () => {},
      markCleanupAlertDelivered: async () => {}
    },
    credentialVault: { revokeSecret: async () => { vaultCalls++; } },
    alert: async () => { alertCalls++; },
    now: () => 1000
  });
  assert.deepEqual(await worker.runOnce({ accountId: "synthetic-account" }), {
    scanned: 1, completed: 0, deferred: 1, exhausted: 0
  });
  assert.equal(vaultCalls, 0);
  assert.equal(alertCalls, 0);
});


test("worker fails closed when an adapter exceeds the requested batch limit", async () => {
  let vaultCalls = 0;
  const worker = createMailboxSecretCleanupWorker({
    cleanupAdapters: {
      listPendingSecretCleanup: async () => [ticket, ticket],
      completeSecretCleanup: async () => {},
      recordSecretCleanupFailure: async () => {},
      listPendingCleanupAlerts: async () => [],
      recordCleanupAlertFailure: async () => {},
      markCleanupAlertDelivered: async () => {}
    },
    credentialVault: { revokeSecret: async () => { vaultCalls++; } },
    alert: async () => {},
    now: () => 1000
  });
  await assert.rejects(
    worker.runOnce({ accountId: "synthetic-account", limit: 1 }),
    error => error.code === "failed-precondition"
  );
  assert.equal(vaultCalls, 0);
});

test("worker skips an oversized alert batch without sending notifications", async () => {
  let alertCalls = 0;
  const alertTicket = {
    accountId: "synthetic-account", connectionId: "safe-connection",
    status: "exhausted", alertStatus: "pending", attempts: 12,
    lastErrorCode: "unavailable", alertAttempts: 0, alertNextAttemptAt: null
  };
  const worker = createMailboxSecretCleanupWorker({
    cleanupAdapters: {
      listPendingSecretCleanup: async () => [],
      completeSecretCleanup: async () => {},
      recordSecretCleanupFailure: async () => {},
      listPendingCleanupAlerts: async () => [alertTicket, alertTicket],
      recordCleanupAlertFailure: async () => {},
      markCleanupAlertDelivered: async () => {}
    },
    credentialVault: { revokeSecret: async () => {} },
    alert: async () => { alertCalls++; },
    now: () => 1000
  });
  assert.deepEqual(await worker.runOnce({ accountId: "synthetic-account", limit: 1 }), {
    scanned: 0, completed: 0, deferred: 0, exhausted: 0
  });
  assert.equal(alertCalls, 0);
});


test("worker rejects duplicate cleanup tickets before any vault side effect", async () => {
  let vaultCalls = 0;
  const duplicate = { ...ticket };
  const worker = createMailboxSecretCleanupWorker({
    cleanupAdapters: {
      listPendingSecretCleanup: async () => [ticket, duplicate],
      completeSecretCleanup: async () => {},
      recordSecretCleanupFailure: async () => {},
      listPendingCleanupAlerts: async () => [],
      recordCleanupAlertFailure: async () => {},
      markCleanupAlertDelivered: async () => {}
    },
    credentialVault: { revokeSecret: async () => { vaultCalls++; } },
    alert: async () => {},
    now: () => 1000
  });
  await assert.rejects(
    worker.runOnce({ accountId: "synthetic-account" }),
    error => error.code === "failed-precondition"
  );
  assert.equal(vaultCalls, 0);
});

test("worker does not send duplicate alert tickets from a malformed adapter batch", async () => {
  let alertCalls = 0;
  const alertTicket = {
    accountId: "synthetic-account", connectionId: "same-connection",
    status: "exhausted", alertStatus: "pending", attempts: 12,
    lastErrorCode: "unavailable", alertAttempts: 0, alertNextAttemptAt: null
  };
  const worker = createMailboxSecretCleanupWorker({
    cleanupAdapters: {
      listPendingSecretCleanup: async () => [],
      completeSecretCleanup: async () => {},
      recordSecretCleanupFailure: async () => {},
      listPendingCleanupAlerts: async () => [alertTicket, { ...alertTicket }],
      recordCleanupAlertFailure: async () => {},
      markCleanupAlertDelivered: async () => {}
    },
    credentialVault: { revokeSecret: async () => {} },
    alert: async () => { alertCalls++; },
    now: () => 1000
  });
  assert.deepEqual(await worker.runOnce({ accountId: "synthetic-account" }), {
    scanned: 0, completed: 0, deferred: 0, exhausted: 0
  });
  assert.equal(alertCalls, 0);
});


test("worker rejects an invalid clock before querying adapters or touching secrets", async () => {
  let listCalls = 0;
  let vaultCalls = 0;
  const worker = createMailboxSecretCleanupWorker({
    cleanupAdapters: {
      listPendingSecretCleanup: async () => { listCalls++; return [ticket]; },
      completeSecretCleanup: async () => {},
      recordSecretCleanupFailure: async () => {},
      listPendingCleanupAlerts: async () => [],
      recordCleanupAlertFailure: async () => {},
      markCleanupAlertDelivered: async () => {}
    },
    credentialVault: { revokeSecret: async () => { vaultCalls++; } },
    alert: async () => {},
    now: () => Number.NaN
  });
  await assert.rejects(
    worker.runOnce({ accountId: "synthetic-account" }),
    error => error.code === "failed-precondition"
  );
  assert.equal(listCalls, 0);
  assert.equal(vaultCalls, 0);
});


test("worker rejects a clock too close to the safe-integer ceiling for retry arithmetic", async () => {
  let listCalls = 0;
  const worker = createMailboxSecretCleanupWorker({
    cleanupAdapters: {
      listPendingSecretCleanup: async () => { listCalls++; return []; },
      completeSecretCleanup: async () => {},
      recordSecretCleanupFailure: async () => {},
      listPendingCleanupAlerts: async () => [],
      recordCleanupAlertFailure: async () => {},
      markCleanupAlertDelivered: async () => {}
    },
    credentialVault: { revokeSecret: async () => {} },
    alert: async () => {},
    now: () => Number.MAX_SAFE_INTEGER
  });
  await assert.rejects(
    worker.runOnce({ accountId: "synthetic-account" }),
    error => error.code === "failed-precondition"
  );
  assert.equal(listCalls, 0);
});


test("worker bases retry backoff on the failure time, not the batch start", async () => {
  const recorded = [];
  const times = [1000, 5000, 9000];
  const worker = createMailboxSecretCleanupWorker({
    cleanupAdapters: {
      listPendingSecretCleanup: async () => [ticket],
      completeSecretCleanup: async () => {},
      recordSecretCleanupFailure: async input => recorded.push(input),
      listPendingCleanupAlerts: async () => [],
      recordCleanupAlertFailure: async () => {},
      markCleanupAlertDelivered: async () => {}
    },
    credentialVault: { revokeSecret: async () => { throw Object.assign(new Error("synthetic"), { code: "unavailable" }); } },
    alert: async () => {},
    now: () => times.shift()
  });
  const result = await worker.runOnce({ accountId: "synthetic-account" });
  assert.deepEqual(result, { scanned: 1, completed: 0, deferred: 1, exhausted: 0 });
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].timestamp, 9000);
  assert.equal(recorded[0].nextAttemptAt, 129000);
});


test("worker timestamps cleanup acknowledgement after vault deletion completes", async () => {
  let clock = 1000;
  let completedAt = null;
  const worker = createMailboxSecretCleanupWorker({
    cleanupAdapters: {
      listPendingSecretCleanup: async () => [ticket],
      completeSecretCleanup: async input => { completedAt = input.timestamp; },
      recordSecretCleanupFailure: async () => {},
      listPendingCleanupAlerts: async () => [],
      recordCleanupAlertFailure: async () => {},
      markCleanupAlertDelivered: async () => {}
    },
    credentialVault: { revokeSecret: async () => { clock = 7000; } },
    alert: async () => {},
    now: () => clock
  });
  const result = await worker.runOnce({ accountId: "synthetic-account" });
  assert.equal(result.completed, 1);
  assert.equal(completedAt, 7000);
});

test("worker timestamps alert acknowledgement after notification completes", async () => {
  let clock = 1000;
  let deliveredAt = null;
  const alertTicket = {
    accountId: "synthetic-account", connectionId: "safe-connection",
    status: "exhausted", alertStatus: "pending", attempts: 12,
    lastErrorCode: "unavailable", alertAttempts: 0, alertNextAttemptAt: null
  };
  const worker = createMailboxSecretCleanupWorker({
    cleanupAdapters: {
      listPendingSecretCleanup: async () => [],
      completeSecretCleanup: async () => {},
      recordSecretCleanupFailure: async () => {},
      listPendingCleanupAlerts: async () => [alertTicket],
      recordCleanupAlertFailure: async () => {},
      markCleanupAlertDelivered: async input => { deliveredAt = input.timestamp; }
    },
    credentialVault: { revokeSecret: async () => {} },
    alert: async () => { clock = 8000; },
    now: () => clock
  });
  await worker.runOnce({ accountId: "synthetic-account" });
  assert.equal(deliveredAt, 8000);
});
