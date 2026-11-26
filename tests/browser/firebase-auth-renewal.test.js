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
