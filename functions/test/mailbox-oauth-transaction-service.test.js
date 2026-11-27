import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createMailboxOAuthTransactionService } from "../src/membership/mailbox-oauth-transaction-service.js";

const ctx = { accountId: "synthetic-account", actorUid: "synthetic-uid", provider: "gmail_api" };
function fixture() {
  let clock = 1795766400000;
  const stored = new Map();
  const service = createMailboxOAuthTransactionService({
    now: () => clock,
    saveTransaction: async ({ stateHash, transaction }) => {
      assert.equal(stored.has(stateHash), false, "transaction IDs must not overwrite");
      stored.set(stateHash, transaction);
    },
    consumeTransaction: async ({ stateHash }) => {
      const transaction = stored.get(stateHash);
      stored.delete(stateHash);
      return transaction ?? null;
    }
  });
  return { service, stored, advance: n => { clock += n; } };
}
const sha = value => createHash("sha256").update(value).digest("base64url");

test("begin generates PKCE S256, stores verifier server-side and exposes only state/challenge", async () => {
  const { service, stored } = fixture();
  const started = await service.begin(ctx);
  assert.equal(started.codeChallengeMethod, "S256");
  assert.equal(started.codeChallenge.length, 43);
  assert.equal(started.state.length, 43);
  assert.equal(stored.size, 1);
  const transaction = [...stored.values()][0];
  assert.equal(transaction.verifier.length, 43);
  assert.equal(started.codeChallenge, sha(transaction.verifier));
  assert.equal(Object.hasOwn(started, "codeVerifier"), false);
});

test("consume returns verifier only for matching actor/account/provider and is one-time", async () => {
  const { service } = fixture();
  const started = await service.begin(ctx);
  const consumed = await service.consume({ ...ctx, state: started.state });
  assert.equal(consumed.codeChallenge, started.codeChallenge);
  assert.equal(consumed.codeVerifier.length, 43);
  await assert.rejects(service.consume({ ...ctx, state: started.state }), e => e.code === "permission-denied");
});

test("state is bound to account, actor and provider; mismatch burns the transaction", async () => {
  const { service } = fixture();
  const started = await service.begin(ctx);
  await assert.rejects(service.consume({ ...ctx, actorUid: "other-uid", state: started.state }),
    e => e.code === "permission-denied");
  await assert.rejects(service.consume({ ...ctx, state: started.state }), e => e.code === "permission-denied");
});

test("expired state is rejected and cannot be replayed", async () => {
  const { service, advance } = fixture();
  const started = await service.begin(ctx);
  advance(10 * 60 * 1000);
  await assert.rejects(service.consume({ ...ctx, state: started.state }), e => e.code === "permission-denied");
  await assert.rejects(service.consume({ ...ctx, state: started.state }), e => e.code === "permission-denied");
});

test("invalid begin context rejected", async () => {
  const { service } = fixture();
  await assert.rejects(service.begin({ ...ctx, provider: "imap" }), e => e.code === "invalid-argument");
});
