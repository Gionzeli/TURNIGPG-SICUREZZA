import assert from "node:assert/strict";
import { createAccountContext } from "../../src/core/account/account-context.js";
import { createAccountLifecycleCoordinator } from "../../src/core/account/account-lifecycle-coordinator.js";
import { createDSMCoreSession } from "../../src/core/database/create-dsm-session.js";

function principal(overrides = {}) {
  return Object.freeze({
    uid: "synthetic-firebase-user",
    email: "synthetic@example.invalid",
    accountId: "synthetic-account",
    role: "member",
    permissions: Object.freeze(["shifts:read"]),
    expiresAt: Date.now() + 60_000,
    identityProvider: "firebase",
    authorizationSource: "server",
    ...overrides
  });
}
function expectDenied(fn) {
  assert.throws(fn, error => error?.code === "DB_ACCESS_DENIED");
}
function fakeDb() {
  return { transaction() {}, objectStoreNames: { contains: () => true } };
}
function fakeAdapter(initialPrincipal = principal()) {
  let listener = null;
  let currentPrincipal = initialPrincipal;
  let principalCalls = 0;
  return {
    adapter: {
      async getPrincipal() { principalCalls += 1; return currentPrincipal; },
      subscribe(callback) { listener = callback; return () => { listener = null; }; }
    },
    emit() { listener?.({ authenticated: Boolean(currentPrincipal) }); },
    setPrincipal(value) { currentPrincipal = value; },
    get principalCalls() { return principalCalls; }
  };
}
export async function runFirebaseLifecycleTests() {
  let passed = 0;
  const test = async (name, fn) => { await fn(); passed++; console.log(`PASS — FIREBASE-LIFECYCLE: ${name}`); };
  await test("local activation rejects Firebase identity claims", async () => {
    const context = createAccountContext();
    expectDenied(() => context.activate({ accountId: "synthetic-account", identitySource: "firebase" }));
  });
  await test("Firebase activation requires complete immutable server principal", async () => {
    const context = createAccountContext();
    expectDenied(() => context.activateFirebase({ ...principal() }));
    const active = context.activateFirebase(principal());
    assert.equal(active.identitySource, "firebase");
    assert.equal(active.uid, "synthetic-firebase-user");
    assert.deepEqual(active.permissions, ["shifts:read"]);
  });
  await test("expired Firebase principal is rejected at activation", async () => {
    const context = createAccountContext();
    expectDenied(() => context.activateFirebase(principal({ expiresAt: Date.now() - 1 })));
  });
  await test("expired Firebase authorization invalidates capture and prior captures", async () => {
    const context = createAccountContext();
    const lifecycle = createAccountLifecycleCoordinator({ accountContext: context });
    const token = await lifecycle.beginTransition("initialize");
    lifecycle.activateFirebase(token, principal({ expiresAt: Date.now() + 15 }));
    const capture = lifecycle.capture();
    await new Promise(resolve => setTimeout(resolve, 25));
    expectDenied(() => lifecycle.capture());
    assert.equal(lifecycle.isCurrent(capture), false);
  });
  await test("lifecycle transitions local to Firebase and logout clears identity", async () => {
    const context = createAccountContext();
    const lifecycle = createAccountLifecycleCoordinator({ accountContext: context });
    const localToken = await lifecycle.beginTransition("initialize");
    lifecycle.activateLocal(localToken, "synthetic-local");
    const firebaseToken = await lifecycle.beginTransition("switch");
    lifecycle.activateFirebase(firebaseToken, principal());
    assert.equal(lifecycle.capture().accountId, "synthetic-account");
    const logoutToken = await lifecycle.beginTransition("logout");
    lifecycle.clear(logoutToken);
    assert.equal(lifecycle.getStatus().state, "cleared");
    assert.equal(context.getActive(), null);
  });
  await test("session requires explicit adapter and fails closed on anonymous principal", async () => {
    const session = await createDSMCoreSession({
      db: fakeDb(),
      firebaseAuthAdapter: { getPrincipal: async () => null, subscribe: () => () => {} }
    });
    assert.equal(await session.activateFirebase(), null);
    assert.equal(session.lifecycle.getStatus().state, "cleared");
    session.dispose();
  });
  await test("Firebase principal is re-resolved before a failed transition is resumed", async () => {
    const auth = fakeAdapter(principal());
    const session = await createDSMCoreSession({ db: fakeDb(), firebaseAuthAdapter: auth.adapter });
    let cleanupCalls = 0;
    session.lifecycle.registerDisposable(() => {
      cleanupCalls += 1;
      if (cleanupCalls === 1) throw new Error("synthetic cleanup failure");
    });
    await assert.rejects(session.activateFirebase(), error => error?.code === "DB_ACCESS_DENIED");
    const replacement = principal({ accountId: "synthetic-account-refreshed" });
    auth.setPrincipal(replacement);
    await session.resumePendingTransition();
    assert.equal(auth.principalCalls, 2);
    assert.equal(session.lifecycle.getStatus().accountId, "synthetic-account-refreshed");
    session.dispose();
  });
  await test("auth revision change prevents resuming a stale Firebase principal", async () => {
    const auth = fakeAdapter(principal());
    const session = await createDSMCoreSession({ db: fakeDb(), firebaseAuthAdapter: auth.adapter });
    let cleanupCalls = 0;
    session.lifecycle.registerDisposable(() => {
      cleanupCalls += 1;
      if (cleanupCalls === 1) throw new Error("synthetic cleanup failure");
    });
    await assert.rejects(session.activateFirebase(), error => error?.code === "DB_ACCESS_DENIED");
    auth.setPrincipal(null);
    auth.emit();
    // The auth observer invalidates the pending transition; it must never activate
    // the previously captured principal after cleanup eventually succeeds.
    await session.resumePendingTransition();
    assert.equal(session.lifecycle.getStatus().state, "cleared");
    assert.equal(session.lifecycle.getStatus().accountId, null);
    session.dispose();
  });
  await test("auth event during asynchronous cleanup cancels Firebase activation", async () => {
    const auth = fakeAdapter(principal());
    const session = await createDSMCoreSession({ db: fakeDb(), firebaseAuthAdapter: auth.adapter });
    let release;
    let started;
    const hasStarted = new Promise(resolve => { started = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    session.lifecycle.registerDisposable(async () => { started(); await gate; });
    const activation = session.activateFirebase();
    await hasStarted;
    auth.emit();
    release();
    await assert.rejects(activation, error => error?.code === "DB_ACCESS_DENIED");
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(session.lifecycle.getStatus().state, "cleared");
    session.dispose();
  });
  await test("auth event after activation logs out the active context", async () => {
    const auth = fakeAdapter(principal());
    const session = await createDSMCoreSession({ db: fakeDb(), firebaseAuthAdapter: auth.adapter });
    await session.activateFirebase();
    assert.equal(session.lifecycle.getStatus().state, "active");
    auth.emit();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(session.lifecycle.getStatus().state, "cleared");
    assert.equal(session.accountContext.getActive(), null);
    session.dispose();
  });
  return passed;
}
