import assert from "node:assert/strict";
import { createFirebaseAuthAdapter } from "../../src/adapters/firebase/firebase-auth-adapter.js";

function fakeAuth(initialUser = null) {
  let observer;
  let unsubscribeCount = 0;
  const auth = { currentUser: initialUser };
  const onAuthStateChanged = (_auth, next, error) => {
    observer = { next, error };
    next(initialUser);
    return () => { unsubscribeCount += 1; observer = null; };
  };
  return {
    auth,
    onAuthStateChanged,
    emit(user) {
      auth.currentUser = user;
      observer?.next(user);
    },
    fail(error) { observer?.error(error); },
    get unsubscribeCount() { return unsubscribeCount; }
  };
}

function syntheticUser(uid = "synthetic-user-1", options = {}) {
  const tokens = options.tokens ?? ["synthetic-id-token-value"];
  let tokenIndex = 0;
  return {
    uid,
    email: options.email ?? "synthetic@example.invalid",
    emailVerified: options.emailVerified ?? true,
    async getIdToken(forceRefresh) {
      assert.equal(forceRefresh, true, "L'adapter deve richiedere il refresh del token.");
      const token = tokens[Math.min(tokenIndex, tokens.length - 1)];
      tokenIndex += 1;
      return token;
    }
  };
}

function activeAuthorization(uid, overrides = {}) {
  const { expiresAt = 2_000_000_000_000, ...principalOverrides } = overrides;
  return {
    authorizationSource: "server",
    principal: {
      uid,
      accountId: "synthetic-account-1",
      status: "active",
      role: "member",
      permissions: ["shifts:read"],
      ...principalOverrides
    },
    expiresAt
  };
}

async function rejected(promise, message) {
  await assert.rejects(promise, error => error?.code === "DSM_FIREBASE_AUTH_DENIED", message);
}

export async function runFirebaseAuthAdapterTests() {
  let passed = 0;
  const test = async (name, callback) => {
    await callback();
    passed += 1;
    console.log(`PASS — FIREBASE-ADAPTER: ${name}`);
  };

  await test("anonymous state returns null", async () => {
    const fake = fakeAuth(null);
    const adapter = createFirebaseAuthAdapter({
      auth: fake.auth,
      onAuthStateChanged: fake.onAuthStateChanged,
      getAccountSelectionSnapshot: async () => ({ accountId: "synthetic-account-1", revision: 1 }),
      resolveAuthorization: async () => { throw new Error("must not be called"); }
    });
    assert.equal(await adapter.getPrincipal(), null);
    adapter.dispose();
    assert.equal(fake.unsubscribeCount, 1);
  });

  await test("unverified email is denied before authorization lookup", async () => {
    const fake = fakeAuth(syntheticUser("synthetic-unverified", { emailVerified: false }));
    let resolverCalls = 0;
    const adapter = createFirebaseAuthAdapter({
      auth: fake.auth, onAuthStateChanged: fake.onAuthStateChanged,
      getAccountSelectionSnapshot: async () => ({ accountId: "synthetic-account-1", revision: 1 }),
      resolveAuthorization: async () => { resolverCalls += 1; return null; }
    });
    await rejected(adapter.getPrincipal());
    assert.equal(resolverCalls, 0);
    adapter.dispose();
  });

  await test("pending membership is denied", async () => {
    const user = syntheticUser("synthetic-pending");
    const fake = fakeAuth(user);
    const adapter = createFirebaseAuthAdapter({
      auth: fake.auth, onAuthStateChanged: fake.onAuthStateChanged,
      getAccountSelectionSnapshot: async () => ({ accountId: "synthetic-account-1", revision: 1 }),
      resolveAuthorization: async ({ uid }) => activeAuthorization(uid, { status: "pending" })
    });
    await rejected(adapter.getPrincipal());
    adapter.dispose();
  });

  await test("active server authorization returns a minimized immutable principal", async () => {
    const user = syntheticUser("synthetic-approved");
    const fake = fakeAuth(user);
    let received;
    const adapter = createFirebaseAuthAdapter({
      auth: fake.auth, onAuthStateChanged: fake.onAuthStateChanged,
      getAccountSelectionSnapshot: async () => ({ accountId: "synthetic-account-1", revision: 1 }),
      resolveAuthorization: async input => {
        received = input;
        return activeAuthorization(input.uid);
      }
    });
    const principal = await adapter.getPrincipal();
    assert.equal(principal.uid, "synthetic-approved");
    assert.equal(principal.accountId, "synthetic-account-1");
    assert.equal(principal.authorizationSource, "server");
    assert.deepEqual(principal.permissions, ["shifts:read"]);
    assert.equal(Object.isFrozen(principal), true);
    assert.equal(Object.isFrozen(principal.permissions), true);
    assert.equal(received.idToken, "synthetic-id-token-value");
    assert.equal(received.accountId, "synthetic-account-1");
    assert.equal(received.uid, "synthetic-approved");
    assert.equal("idToken" in principal, false);
    assert.equal("isAdmin" in principal, false);
    adapter.dispose();
  });

  await test("inactive membership and mismatched UID are denied", async () => {
    const user = syntheticUser("synthetic-inactive");
    const fake = fakeAuth(user);
    const adapter = createFirebaseAuthAdapter({
      auth: fake.auth, onAuthStateChanged: fake.onAuthStateChanged,
      getAccountSelectionSnapshot: async () => ({ accountId: "synthetic-account-1", revision: 1 }),
      resolveAuthorization: async ({ uid }) => activeAuthorization(uid, { status: "inactive" })
    });
    await rejected(adapter.getPrincipal());
    adapter.dispose();

    const second = fakeAuth(user);
    const mismatched = createFirebaseAuthAdapter({
      auth: second.auth, onAuthStateChanged: second.onAuthStateChanged,
      getAccountSelectionSnapshot: async () => ({ accountId: "synthetic-account-1", revision: 1 }),
      resolveAuthorization: async () => activeAuthorization("different-synthetic-user")
    });
    await rejected(mismatched.getPrincipal());
    mismatched.dispose();
  });

  await test("expired authorization is denied", async () => {
    const user = syntheticUser("synthetic-expired");
    const fake = fakeAuth(user);
    const adapter = createFirebaseAuthAdapter({
      auth: fake.auth, onAuthStateChanged: fake.onAuthStateChanged,
      now: () => 1_900_000_000_000,
      getAccountSelectionSnapshot: async () => ({ accountId: "synthetic-account-1", revision: 1 }),
      resolveAuthorization: async ({ uid }) => activeAuthorization(uid, { expiresAt: 1_899_999_999_999 })
    });
    await rejected(adapter.getPrincipal());
    adapter.dispose();
  });

  await test("fresh token is used after an auth/session change", async () => {
    const firstUser = syntheticUser("synthetic-session-user", {
      tokens: ["synthetic-token-old", "synthetic-token-new"]
    });
    const fake = fakeAuth(firstUser);
    const seenTokens = [];
    const adapter = createFirebaseAuthAdapter({
      auth: fake.auth, onAuthStateChanged: fake.onAuthStateChanged,
      getAccountSelectionSnapshot: async () => ({ accountId: "synthetic-account-1", revision: 1 }),
      resolveAuthorization: async ({ uid, idToken }) => {
        seenTokens.push(idToken);
        return activeAuthorization(uid);
      }
    });
    assert.ok(await adapter.getPrincipal());
    fake.emit(firstUser);
    assert.ok(await adapter.getPrincipal());
    assert.deepEqual(seenTokens, ["synthetic-token-old", "synthetic-token-new"]);
    adapter.dispose();
  });

  await test("late authorization response cannot revive a previous user", async () => {
    const firstUser = syntheticUser("synthetic-user-old");
    const secondUser = syntheticUser("synthetic-user-new");
    const fake = fakeAuth(firstUser);
    let release;
    const adapter = createFirebaseAuthAdapter({
      auth: fake.auth, onAuthStateChanged: fake.onAuthStateChanged,
      getAccountSelectionSnapshot: async () => ({ accountId: "synthetic-account-1", revision: 1 }),
      resolveAuthorization: ({ uid }) => uid === firstUser.uid
        ? new Promise(resolve => { release = () => resolve(activeAuthorization(uid)); })
        : Promise.resolve(activeAuthorization(uid))
    });
    const staleRequest = adapter.getPrincipal();
    while (!release) await new Promise(resolve => setTimeout(resolve, 0));
    fake.emit(secondUser);
    release();
    assert.equal(await staleRequest, null);
    assert.equal((await adapter.getPrincipal()).uid, secondUser.uid);
    adapter.dispose();
  });

  await test("account selection change during resolver discards late principal", async () => {
    const user = syntheticUser("synthetic-account-race");
    const fake = fakeAuth(user);
    let selectedAccountId = "synthetic-account-before";
    let selectionRevision = 1;
    let release;
    let resolverStarted;
    const started = new Promise(resolve => { resolverStarted = resolve; });
    const adapter = createFirebaseAuthAdapter({
      auth: fake.auth,
      onAuthStateChanged: fake.onAuthStateChanged,
      getAccountSelectionSnapshot: async () => ({ accountId: selectedAccountId, revision: selectionRevision }),
      resolveAuthorization: ({ uid, accountId }) => new Promise(resolve => {
        resolverStarted();
        release = () => resolve(activeAuthorization(uid, { accountId }));
      })
    });
    const pending = adapter.getPrincipal();
    await started;
    selectedAccountId = "synthetic-account-after";
    selectionRevision += 1;
    release();
    assert.equal(await pending, null);
    adapter.dispose();
  });

  await test("account selection ABA change is detected by monotonic revision", async () => {
    const user = syntheticUser("synthetic-account-aba");
    const fake = fakeAuth(user);
    let selectedAccountId = "synthetic-account-A";
    let selectionRevision = 10;
    let release;
    let resolverStarted;
    const started = new Promise(resolve => { resolverStarted = resolve; });
    const adapter = createFirebaseAuthAdapter({
      auth: fake.auth,
      onAuthStateChanged: fake.onAuthStateChanged,
      getAccountSelectionSnapshot: async () => ({ accountId: selectedAccountId, revision: selectionRevision }),
      resolveAuthorization: ({ uid, accountId }) => new Promise(resolve => {
        resolverStarted();
        release = () => resolve(activeAuthorization(uid, { accountId }));
      })
    });
    const pending = adapter.getPrincipal();
    await started;
    selectedAccountId = "synthetic-account-B";
    selectionRevision += 1;
    selectedAccountId = "synthetic-account-A";
    selectionRevision += 1;
    release();
    assert.equal(await pending, null);
    adapter.dispose();
  });

  await test("resolver failure is fail-closed and dispose unsubscribes", async () => {
    const fake = fakeAuth(syntheticUser("synthetic-resolver-error"));
    const adapter = createFirebaseAuthAdapter({
      auth: fake.auth, onAuthStateChanged: fake.onAuthStateChanged,
      getAccountSelectionSnapshot: async () => ({ accountId: "synthetic-account-1", revision: 1 }),
      resolveAuthorization: async () => { throw new Error("synthetic backend unavailable"); }
    });
    await rejected(adapter.getPrincipal());
    adapter.dispose();
    adapter.dispose();
    assert.equal(fake.unsubscribeCount, 1);
    await rejected(adapter.getPrincipal());
  });

  return passed;
}
