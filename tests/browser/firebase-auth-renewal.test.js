import assert from "node:assert/strict";
import { createFirebaseAuthRenewalCoordinator } from "../../src/adapters/firebase/firebase-auth-renewal-coordinator.js";

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
function principal(identity, expiresAt = 2_000_000_000_000) {
  return { uid: identity.uid, accountId: identity.accountId, expiresAt, role: "member" };
}
export async function runFirebaseAuthRenewalTests() {
  let passed = 0;
  const test = async (name, fn) => { await fn(); passed++; console.log(`PASS — FIREBASE-RENEWAL: ${name}`); };
  await test("concurrent renewal requests coalesce into one resolver call", async () => {
    const identity = { uid: "synthetic-uid", accountId: "synthetic-account" };
    const gate = deferred();
    let calls = 0, installed = null, cleared = 0;
    const coordinator = createFirebaseAuthRenewalCoordinator({
      getIdentity: () => identity,
      resolveAuthorization: async () => { calls++; return gate.promise; },
      installPrincipal: value => { installed = value; },
      clearPrincipal: () => { cleared++; },
      now: () => 1_900_000_000_000,
      schedule: () => 1, cancelSchedule: () => {}
    });
    const first = coordinator.renew();
    const second = coordinator.renew("parallel");
    assert.equal(first, second);
    gate.resolve(principal(identity));
    const [a, b] = await Promise.all([first, second]);
    assert.equal(calls, 1);
    assert.equal(a, b);
    assert.equal(installed.uid, identity.uid);
    assert.equal(coordinator.getStatus().state, "active");
    assert.equal(cleared, 0);
    coordinator.dispose();
  });
  await test("identity change while resolving discards stale response", async () => {
    let identity = { uid: "synthetic-old", accountId: "synthetic-account" };
    const gate = deferred();
    let installed = null, clears = 0;
    const coordinator = createFirebaseAuthRenewalCoordinator({
      getIdentity: () => identity,
      resolveAuthorization: () => gate.promise,
      installPrincipal: value => { installed = value; },
      clearPrincipal: () => { clears++; },
      schedule: () => 1, cancelSchedule: () => {}
    });
    const pending = coordinator.renew();
    identity = { uid: "synthetic-new", accountId: "synthetic-account" };
    coordinator.invalidate("uid-change");
    gate.resolve(principal({ uid: "synthetic-old", accountId: "synthetic-account" }));
    assert.equal(await pending, null);
    assert.equal(installed, null);
    assert.equal(coordinator.getStatus().state, "inactive");
    assert.ok(clears >= 1);
    coordinator.dispose();
  });
  await test("invalidate allows new identity renewal while old resolver is pending", async () => {
    let identity = { uid: "synthetic-rotate-old", accountId: "synthetic-rotate-account" };
    const oldGate = deferred();
    let installed = null, calls = [];
    const coordinator = createFirebaseAuthRenewalCoordinator({
      getIdentity: () => identity,
      resolveAuthorization: request => {
        calls.push(request.uid);
        return request.uid === "synthetic-rotate-old" ? oldGate.promise : Promise.resolve(principal(identity));
      },
      installPrincipal: value => { installed = value; },
      clearPrincipal: () => { installed = null; },
      schedule: () => 1, cancelSchedule: () => {}
    });
    const oldPending = coordinator.renew();
    identity = { uid: "synthetic-rotate-new", accountId: "synthetic-rotate-account" };
    coordinator.invalidate("uid-rotation");
    const newPending = coordinator.renew("new-identity");
    const fresh = await newPending;
    assert.equal(fresh.uid, "synthetic-rotate-new");
    assert.equal(installed.uid, "synthetic-rotate-new");
    assert.deepEqual(calls, ["synthetic-rotate-old", "synthetic-rotate-new"]);
    oldGate.resolve(principal({ uid: "synthetic-rotate-old", accountId: "synthetic-rotate-account" }));
    assert.equal(await oldPending, null);
    assert.equal(installed.uid, "synthetic-rotate-new");
    assert.equal(coordinator.getStatus().state, "active");
    coordinator.dispose();
  });
  await test("identity change without explicit invalidation clears stale authorization", async () => {
    let identity = { uid: "synthetic-race-old", accountId: "synthetic-race-account" };
    const gate = deferred();
    let installed = null, clears = 0;
    const coordinator = createFirebaseAuthRenewalCoordinator({
      getIdentity: () => identity,
      resolveAuthorization: () => gate.promise,
      installPrincipal: value => { installed = value; },
      clearPrincipal: () => { installed = null; clears++; },
      schedule: () => 1, cancelSchedule: () => {}
    });
    const pending = coordinator.renew();
    identity = { uid: "synthetic-race-new", accountId: "synthetic-race-account" };
    gate.resolve(principal({ uid: "synthetic-race-old", accountId: "synthetic-race-account" }));
    assert.equal(await pending, null);
    assert.equal(installed, null);
    assert.equal(coordinator.getStatus().state, "inactive");
    assert.equal(coordinator.getStatus().expiresAt, null);
    assert.ok(clears >= 1);
    coordinator.dispose();
  });
  await test("resolver denial clears old authorization and enters blocked state", async () => {
    const identity = { uid: "synthetic-denied", accountId: "synthetic-account" };
    let installed = null, clears = 0;
    let deny = false;
    const coordinator = createFirebaseAuthRenewalCoordinator({
      getIdentity: () => identity,
      resolveAuthorization: async () => {
        if (deny) throw new Error("synthetic membership revoked");
        return principal(identity);
      },
      installPrincipal: value => { installed = value; },
      clearPrincipal: () => { installed = null; clears++; },
      schedule: () => 1, cancelSchedule: () => {}
    });
    await coordinator.renew();
    deny = true;
    await assert.rejects(coordinator.renew(), /synthetic membership revoked/);
    assert.equal(installed, null);
    assert.equal(coordinator.getStatus().state, "blocked");
    assert.equal(coordinator.getStatus().expiresAt, null);
    assert.ok(clears >= 1);
    coordinator.dispose();
  });
  await test("expired or mismatched resolver response is rejected fail-closed", async () => {
    const identity = { uid: "synthetic-invalid", accountId: "synthetic-account" };
    let clears = 0;
    const coordinator = createFirebaseAuthRenewalCoordinator({
      getIdentity: () => identity,
      resolveAuthorization: async () => ({ ...principal(identity), expiresAt: 1 }),
      installPrincipal: () => assert.fail("Invalid principal must not be installed"),
      clearPrincipal: () => { clears++; },
      now: () => 100,
      schedule: () => 1, cancelSchedule: () => {}
    });
    await assert.rejects(coordinator.renew(), /non valida/);
    assert.equal(coordinator.getStatus().state, "blocked");
    assert.equal(clears, 1);
    coordinator.dispose();
  });
  await test("scheduled renewal uses expiry minus lead time", async () => {
    const identity = { uid: "synthetic-timer", accountId: "synthetic-account" };
    let now = 1_000, scheduledDelay = null, callback = null, calls = 0;
    const coordinator = createFirebaseAuthRenewalCoordinator({
      getIdentity: () => identity,
      resolveAuthorization: async () => { calls++; return principal(identity, 10_000); },
      installPrincipal: () => {},
      clearPrincipal: () => {},
      now: () => now,
      renewalLeadMs: 2_000,
      schedule: (fn, delay) => { callback = fn; scheduledDelay = delay; return 7; },
      cancelSchedule: () => {}
    });
    await coordinator.renew();
    assert.equal(scheduledDelay, 7_000);
    now = 8_000;
    callback();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(calls, 2);
    coordinator.dispose();
    assert.equal(coordinator.getStatus().state, "disposed");
  });
  await test("invalidate attempts principal cleanup even when timer cancellation throws", async () => {
    const identity = { uid: "synthetic-cleanup", accountId: "synthetic-cleanup-account" };
    let clearCalls = 0, cancelCalls = 0;
    const coordinator = createFirebaseAuthRenewalCoordinator({
      getIdentity: () => identity,
      resolveAuthorization: async () => principal(identity),
      installPrincipal: () => {},
      clearPrincipal: () => { clearCalls++; },
      schedule: () => 99,
      cancelSchedule: () => { cancelCalls++; throw new Error("synthetic timer cancellation failure"); }
    });
    await coordinator.renew();
    assert.throws(() => coordinator.invalidate("cleanup-test"), AggregateError);
    assert.equal(cancelCalls, 1);
    assert.equal(clearCalls, 1);
    assert.equal(coordinator.getStatus().state, "blocked");
    assert.equal(coordinator.getStatus().expiresAt, null);
    coordinator.dispose();
  });
  await test("dispose remains disposed and attempts cleanup when principal clearing throws", async () => {
    const identity = { uid: "synthetic-dispose-cleanup", accountId: "synthetic-dispose-account" };
    let cancelCalls = 0, clearCalls = 0;
    const coordinator = createFirebaseAuthRenewalCoordinator({
      getIdentity: () => identity,
      resolveAuthorization: async () => principal(identity),
      installPrincipal: () => {},
      clearPrincipal: () => { clearCalls++; throw new Error("synthetic principal cleanup failure"); },
      schedule: () => 100,
      cancelSchedule: () => { cancelCalls++; }
    });
    await coordinator.renew();
    assert.throws(() => coordinator.dispose(), AggregateError);
    assert.equal(cancelCalls, 1);
    assert.equal(clearCalls, 1);
    assert.equal(coordinator.getStatus().state, "disposed");
    assert.equal(coordinator.getStatus().expiresAt, null);
    assert.equal(coordinator.getStatus().inFlight, false);
  });
  await test("timer cancellation failure during renewal blocks and clears active principal", async () => {
    const identity = { uid: "synthetic-renew-cancel", accountId: "synthetic-renew-account" };
    let installed = null, cancelCalls = 0, clearCalls = 0;
    const coordinator = createFirebaseAuthRenewalCoordinator({
      getIdentity: () => identity,
      resolveAuthorization: async () => principal(identity),
      installPrincipal: value => { installed = value; },
      clearPrincipal: () => { installed = null; clearCalls++; },
      schedule: () => 55,
      cancelSchedule: () => { cancelCalls++; throw new Error("synthetic renewal timer cancellation failure"); }
    });
    await coordinator.renew();
    await assert.rejects(coordinator.renew("manual-retry"), /timer cancellation failure/);
    assert.equal(cancelCalls, 1);
    assert.equal(clearCalls, 1);
    assert.equal(installed, null);
    assert.equal(coordinator.getStatus().state, "blocked");
    assert.equal(coordinator.getStatus().expiresAt, null);
    coordinator.dispose();
  });
  await test("partial principal installation failure triggers cleanup and blocks renewal", async () => {
    const identity = { uid: "synthetic-partial-install", accountId: "synthetic-install-account" };
    let installed = null, clearCalls = 0;
    const coordinator = createFirebaseAuthRenewalCoordinator({
      getIdentity: () => identity,
      resolveAuthorization: async () => principal(identity),
      installPrincipal: value => { installed = value; throw new Error("synthetic installer failed after mutation"); },
      clearPrincipal: () => { installed = null; clearCalls++; },
      schedule: () => 1,
      cancelSchedule: () => {}
    });
    await assert.rejects(coordinator.renew(), /installer failed after mutation/);
    assert.equal(installed, null);
    assert.equal(clearCalls, 1);
    assert.equal(coordinator.getStatus().state, "blocked");
    assert.equal(coordinator.getStatus().identity, null);
    assert.equal(coordinator.getStatus().expiresAt, null);
    coordinator.dispose();
  });
  await test("dispose prevents late response from reinstalling authorization", async () => {
    const identity = { uid: "synthetic-dispose", accountId: "synthetic-account" };
    const gate = deferred();
    let installed = 0, cleared = 0;
    const coordinator = createFirebaseAuthRenewalCoordinator({
      getIdentity: () => identity,
      resolveAuthorization: () => gate.promise,
      installPrincipal: () => { installed++; },
      clearPrincipal: () => { cleared++; },
      schedule: () => 1, cancelSchedule: () => {}
    });
    const pending = coordinator.renew();
    coordinator.dispose();
    gate.resolve(principal(identity));
    assert.equal(await pending, null);
    assert.equal(installed, 0);
    assert.equal(coordinator.getStatus().state, "disposed");
    assert.ok(cleared >= 1);
  });
  return passed;
}
