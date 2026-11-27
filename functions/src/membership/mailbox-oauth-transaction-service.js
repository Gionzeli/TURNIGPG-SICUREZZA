import { randomBytes, createHash } from "node:crypto";

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const PROVIDERS = new Set(["gmail_api", "microsoft_graph"]);
const TTL_MS = 10 * 60 * 1000;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}
function validId(value) { return typeof value === "string" && ID.test(value); }
function base64url(buffer) { return buffer.toString("base64url"); }

/**
 * Server-only OAuth transaction coordinator.
 * The injected store must persist transactions securely server-side; consume()
 * must atomically remove/mark-used the transaction to prevent replay.
 * No provider tokens are accepted or stored by this module.
 */
export function createMailboxOAuthTransactionService({
  saveTransaction, consumeTransaction, now = () => Date.now()
}) {
  if (typeof saveTransaction !== "function" || typeof consumeTransaction !== "function") {
    throw new TypeError("Secure transaction persistence dependencies are required.");
  }

  return Object.freeze({
    async begin({ accountId, actorUid, provider }) {
      if (!validId(accountId) || !validId(actorUid) || !PROVIDERS.has(provider)) {
        fail("invalid-argument", "Invalid OAuth transaction context.");
      }
      const timestamp = now();
      if (!Number.isSafeInteger(timestamp) || timestamp < 1) {
        fail("failed-precondition", "OAuth transaction clock is invalid.");
      }
      const state = base64url(randomBytes(32));
      const verifier = base64url(randomBytes(32));
      const challenge = base64url(createHash("sha256").update(verifier).digest());
      const transaction = {
        stateHash: createHash("sha256").update(state).digest("hex"),
        accountId, actorUid, provider, verifier, createdAt: timestamp,
        expiresAt: timestamp + TTL_MS, used: false
      };
      await saveTransaction({ stateHash: transaction.stateHash, transaction });
      // Only state and challenge leave the server; the verifier remains in storage.
      return Object.freeze({ state, codeChallenge: challenge, codeChallengeMethod: "S256", expiresAt: transaction.expiresAt });
    },

    async consume({ state, accountId, actorUid, provider }) {
      if (typeof state !== "string" || state.length < 40 || state.length > 128 ||
          !validId(accountId) || !validId(actorUid) || !PROVIDERS.has(provider)) {
        fail("invalid-argument", "Invalid OAuth callback transaction.");
      }
      const timestamp = now();
      if (!Number.isSafeInteger(timestamp) || timestamp < 1) {
        fail("failed-precondition", "OAuth transaction clock is invalid.");
      }
      const stateHash = createHash("sha256").update(state).digest("hex");
      // Storage contract: atomic consume-and-delete/mark-used by stateHash.
      const transaction = await consumeTransaction({ stateHash });
      if (!transaction || transaction.stateHash !== stateHash || transaction.used === true ||
          transaction.accountId !== accountId || transaction.actorUid !== actorUid ||
          transaction.provider !== provider || !validId(transaction.accountId) ||
          !validId(transaction.actorUid) || !PROVIDERS.has(transaction.provider) ||
          typeof transaction.verifier !== "string" ||
          transaction.createdAt > timestamp || transaction.expiresAt <= timestamp ||
          transaction.expiresAt - transaction.createdAt !== TTL_MS) {
        fail("permission-denied", "OAuth state is expired, mismatched, or already used.");
      }
      const challenge = base64url(createHash("sha256").update(transaction.verifier).digest());
      return Object.freeze({ codeVerifier: transaction.verifier, codeChallenge: challenge, provider, accountId, actorUid });
    }
  });
}
