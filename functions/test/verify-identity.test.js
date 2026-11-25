import test from "node:test";
import assert from "node:assert/strict";
import { verifyIdentity } from "../src/auth/verify-identity.js";

test("rejects absent token without invoking verifier", async () => {
  let called = false;
  await assert.rejects(() => verifyIdentity("", async () => { called = true; }), { code: "unauthenticated" });
  assert.equal(called, false);
});

test("verifier must be supplied", async () => {
  await assert.rejects(() => verifyIdentity("token", undefined), TypeError);
});

test("returns immutable UID-only principal derived from verifier claims", async () => {
  const result = await verifyIdentity("synthetic-token", async (token, revoked) => {
    assert.equal(token, "synthetic-token");
    assert.equal(revoked, true);
    return { uid: "synthetic-uid-001", email: "test@example.invalid", email_verified: true, role: "client-spoofed" };
  });
  assert.deepEqual(result, { uid: "synthetic-uid-001", email: "test@example.invalid", emailVerified: true });
  assert.equal(Object.isFrozen(result), true);
  assert.equal("role" in result, false);
});

test("rejects malformed verifier claims", async () => {
  await assert.rejects(() => verifyIdentity("synthetic-token", async () => ({ email: "x" })), { code: "unauthenticated" });
});
