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
    return { uid: "synthetic-uid-001", email: "test@example.invalid", email_verified: true, auth_time: 123, firebase: { sign_in_second_factor: "totp" }, role: "client-spoofed" };
  });
  assert.deepEqual(result, { uid: "synthetic-uid-001", email: "test@example.invalid", emailVerified: true, authTime: 123, secondFactor: "totp" });
  assert.equal(Object.isFrozen(result), true);
  assert.equal("role" in result, false);
});

test("rejects an identity whose verified-email claim is false", async () => {
  await assert.rejects(
    () => verifyIdentity("synthetic-unverified-token", async () => ({
      uid: "synthetic-uid-002",
      email: "unverified@example.invalid",
      email_verified: false
    })),
    { code: "unauthenticated" }
  );
});

test("rejects malformed verifier claims", async () => {
  await assert.rejects(() => verifyIdentity("synthetic-token", async () => ({ email: "x" })), { code: "unauthenticated" });
});

test("rejects a revoked token when the trusted verifier reports revocation", async () => {
  let checkRevokedReceived = false;
  await assert.rejects(
    () => verifyIdentity("synthetic-revoked-token", async (_token, checkRevoked) => {
      checkRevokedReceived = checkRevoked;
      const error = new Error("Synthetic revoked token");
      error.code = "auth/id-token-revoked";
      throw error;
    }),
    error => error.code === "auth/id-token-revoked"
  );
  assert.equal(checkRevokedReceived, true);
});

test("rejects an expired ID token when the trusted verifier reports expiration", async () => {
  let checkRevokedReceived = false;
  await assert.rejects(
    () => verifyIdentity("synthetic-expired-token", async (_token, checkRevoked) => {
      checkRevokedReceived = checkRevoked;
      const error = new Error("Synthetic expired ID token");
      error.code = "auth/id-token-expired";
      throw error;
    }),
    error => error.code === "auth/id-token-expired"
  );
  assert.equal(checkRevokedReceived, true);
});

test("does not infer MFA or recent authentication when verified claims omit them", async () => {
  const result = await verifyIdentity("synthetic-token", async () => ({ uid: "synthetic-uid-003", email_verified: true }));
  assert.equal(result.authTime, null);
  assert.equal(result.secondFactor, null);
});
