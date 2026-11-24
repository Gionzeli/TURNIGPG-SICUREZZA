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
  assert.throws(fn, error => error?.code === "DSM_ACCESS_DENIED" || error?.code === "ACCESS_DENIED");
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
  await test("expired Firebase principal is rejected", async () => {
    const context = createAccountContext();
    expectDenied(() => context.activateFirebase(principal({ expiresAt: Date.now() - 1 })));
  });
  await test("lifecycle transitions from local to Firebase and logout clears identity", async () => {
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
    const db = { transaction() {}, objectStoreNames: { contains: () => true } };
    const session = await createDSMCoreSession({
      db,
      firebaseAuthAdapter: {
        getPrincipal: async () => null,
        subscribe: () => () => {}
      }
    });
    assert.equal(await session.activateFirebase(), null);
    assert.equal(session.lifecycle.getStatus().state, "cleared");
    session.dispose();
  });
  return passed;
}
