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
  let principalError = null;
  let principalCalls = 0;
  let unsubscribeCount = 0;
  return {
    adapter: {
      async getPrincipal() {
        principalCalls += 1;
        if (principalError) throw principalError;
        return currentPrincipal;
      },
      subscribe(callback) { listener = callback; return () => { unsubscribeCount += 1; listener = null; }; }
    },
    emit() { listener?.({ authenticated: Boolean(currentPrincipal) }); },
    setPrincipal(value) { currentPrincipal = value; },
    setError(value) { principalError = value; },
    get principalCalls() { return principalCalls; },
    get unsubscribeCount() { return unsubscribeCount; }
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
    await session.dispose();
  });
  await test("failed explicit revalidation clears an already active Firebase context", async () => {
    const auth = fakeAdapter(principal());
    const session = await createDSMCoreSession({ db: fakeDb(), firebaseAuthAdapter: auth.adapter });
    await session.activateFirebase();
    assert.equal(session.lifecycle.getStatus().state, "active");
    assert.equal(session.accountContext.getActive()?.identitySource, "firebase");

    auth.setError(new Error("synthetic resolver unavailable"));
    await assert.rejects(session.activateFirebase(), /synthetic resolver unavailable/);

    assert.equal(session.lifecycle.getStatus().state, "cleared");
    assert.equal(session.accountContext.getActive(), null);
    assert.throws(() => session.lifecycle.capture(), error => error?.code === "DB_ACCOUNT_REQUIRED");
    await session.dispose();
  });
  await test("failed revalidation remains blocked when logout cleanup must be retried", async () => {
    const auth = fakeAdapter(principal());
    const session = await createDSMCoreSession({ db: fakeDb(), firebaseAuthAdapter: auth.adapter });
    await session.activateFirebase();
    let cleanupCalls = 0;
    session.lifecycle.registerDisposable(() => {
      cleanupCalls += 1;
      if (cleanupCalls === 1) throw new Error("synthetic cleanup failure");
    });

    auth.setError(new Error("synthetic membership lookup failure"));
    await assert.rejects(session.activateFirebase(), error => error instanceof AggregateError);
    assert.equal(session.lifecycle.getStatus().state, "switching");
    assert.equal(session.accountContext.getActive(), null);
    await session.resumePendingTransition();
    assert.equal(session.lifecycle.getStatus().state, "cleared");
    assert.equal(cleanupCalls, 2);
    await session.dispose();
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
    await session.dispose();
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
    await session.dispose();
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
    await session.dispose();
  });
  await test("auth event during asynchronous cleanup failure retries safely and never restores the old Firebase identity", async () => {
    const auth = fakeAdapter(principal());
    const session = await createDSMCoreSession({ db: fakeDb(), firebaseAuthAdapter: auth.adapter });
    await session.activateFirebase();
    assert.equal(session.accountContext.getActive()?.uid, "synthetic-firebase-user");

    let cleanupCalls = 0;
    let releaseCleanup;
    let markCleanupStarted;
    const cleanupStarted = new Promise(resolve => { markCleanupStarted = resolve; });
    const cleanupGate = new Promise(resolve => { releaseCleanup = resolve; });
    session.lifecycle.registerDisposable(async () => {
      cleanupCalls += 1;
      if (cleanupCalls === 1) {
        markCleanupStarted();
        await cleanupGate;
        throw new Error("synthetic first cleanup failure");
      }
    });

    // Simulate a Firebase sign-out while lifecycle cleanup is still pending.
    auth.setPrincipal(null);
    const previousIdentity = session.accountContext.getActive();
    auth.emit();
    await cleanupStarted;
    assert.equal(session.lifecycle.getStatus().state, "switching");
    assert.equal(session.accountContext.getActive(), null);
    assert.throws(() => session.lifecycle.capture(), error => error?.code === "DB_ACCOUNT_REQUIRED");

    releaseCleanup();
    // Let the serialized Auth observer finish recording its failed cleanup.
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(session.lifecycle.getStatus().state, "switching");
    assert.equal(session.lifecycle.getStatus().cleanupComplete, false);
    assert.equal(session.accountContext.getActive(), null);

    const status = await session.resumePendingTransition();
    assert.equal(status.state, "cleared");
    assert.equal(status.cleanupComplete, true);
    assert.equal(cleanupCalls, 2);
    assert.equal(session.accountContext.getActive(), null);
    assert.throws(() => session.lifecycle.capture(), error => error?.code === "DB_ACCOUNT_REQUIRED");
    assert.equal(session.lifecycle.isCurrent({ accountId: previousIdentity.accountId, generation: 1 }), false);
    assert.equal(await session.activateFirebase(), null);
    assert.equal(session.accountContext.getActive(), null);
    await session.dispose();
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
    await session.dispose();
  });
  await test("dispose permanently closes a local session and all exposed activation paths", async () => {
    const session = await createDSMCoreSession({ db: fakeDb(), accountId: "synthetic-local-dispose" });
    assert.equal(session.lifecycle.getStatus().state, "active");
    const status = await session.dispose();
    assert.equal(status.state, "disposed");
    assert.equal(session.lifecycle.getStatus().disposed, true);
    assert.equal(session.accountContext.getActive(), null);
    expectDenied(() => session.accountContext.activate({ accountId: "synthetic-reopen", identitySource: "local" }));
    assert.throws(() => session.lifecycle.capture(), error => error?.code === "DB_ACCOUNT_REQUIRED");
    await assert.rejects(session.switchLocalAccount("synthetic-reopen"), error => error?.code === "DB_ACCESS_DENIED");
    await assert.rejects(session.activateFirebase(), error => error?.code === "DB_ACCESS_DENIED");
    await assert.rejects(session.repositories.profiles.getAll(), error => error?.code === "DB_ACCOUNT_REQUIRED");
    assert.equal((await session.resumePendingTransition()).state, "disposed");
    assert.equal((await session.dispose()).state, "disposed");
  });
  await test("dispose unsubscribes Firebase and cannot be reversed by later auth events", async () => {
    const auth = fakeAdapter(principal());
    const session = await createDSMCoreSession({ db: fakeDb(), firebaseAuthAdapter: auth.adapter });
    await session.activateFirebase();
    assert.equal(session.lifecycle.getStatus().state, "active");
    await session.dispose();
    assert.equal(session.lifecycle.getStatus().state, "disposed");
    assert.equal(session.accountContext.getActive(), null);
    assert.equal(auth.unsubscribeCount, 1);
    auth.emit();
    assert.equal(session.lifecycle.getStatus().state, "disposed");
    await session.dispose();
    assert.equal(auth.unsubscribeCount, 1);
  });
  await test("dispose remains terminal while cleanup is incomplete and retries only cleanup", async () => {
    const session = await createDSMCoreSession({ db: fakeDb(), accountId: "synthetic-dispose-retry" });
    let attempts = 0;
    session.lifecycle.registerDisposable(() => {
      attempts += 1;
      if (attempts === 1) throw new Error("synthetic dispose cleanup failure");
    });
    await assert.rejects(session.dispose(), error => error?.code === "DB_ACCESS_DENIED");
    assert.equal(session.lifecycle.getStatus().state, "switching");
    assert.equal(session.accountContext.getActive(), null);
    await assert.rejects(session.switchLocalAccount("synthetic-must-not-reactivate"), error => error?.code === "DB_ACCESS_DENIED");
    const status = await session.resumePendingTransition();
    assert.equal(status.state, "disposed");
    assert.equal(attempts, 2);
    assert.equal(session.accountContext.getActive(), null);
  });
  await test("dispose racing an in-flight Firebase activation wins permanently", async () => {
    const auth = fakeAdapter(principal());
    const session = await createDSMCoreSession({ db: fakeDb(), firebaseAuthAdapter: auth.adapter });
    let release;
    let markStarted;
    const started = new Promise(resolve => { markStarted = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    session.lifecycle.registerDisposable(async () => { markStarted(); await gate; });
    const activation = session.activateFirebase();
    await started;
    const disposal = session.dispose();
    release();
    await assert.rejects(activation, error => error?.code === "DB_ACCESS_DENIED");
    const status = await disposal;
    assert.equal(status.state, "disposed");
    assert.equal(session.accountContext.getActive(), null);
    assert.equal(auth.unsubscribeCount, 1);
  });

  return passed;
}
