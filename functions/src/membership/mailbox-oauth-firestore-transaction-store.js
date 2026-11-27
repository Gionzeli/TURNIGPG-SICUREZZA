import { createHash } from "node:crypto";

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const HASH = /^[a-f0-9]{64}$/;
const PROVIDERS = new Set(["gmail_api", "microsoft_graph"]);
const TTL_MS = 10 * 60 * 1000;

function invalid(message) {
  const error = new Error(message);
  error.code = "invalid-argument";
  throw error;
}
function validId(value) { return typeof value === "string" && ID.test(value); }
function validateTransaction(stateHash, value) {
  if (!HASH.test(stateHash) || !value || typeof value !== "object" ||
      Object.keys(value).some(key => !["stateHash", "accountId", "actorUid", "provider", "verifier", "createdAt", "expiresAt", "used"].includes(key)) ||
      value.stateHash !== stateHash || !validId(value.accountId) ||
      !validId(value.actorUid) || !PROVIDERS.has(value.provider) ||
      typeof value.verifier !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value.verifier) ||
      !Number.isSafeInteger(value.createdAt) || value.createdAt < 1 ||
      !Number.isSafeInteger(value.expiresAt) || value.expiresAt - value.createdAt !== TTL_MS ||
      value.used !== false) {
    invalid("OAuth transaction storage record is malformed.");
  }
}

/**
 * Trusted server-only Firestore store for OAuth PKCE transactions.
 * State hashes are document IDs; raw state and provider tokens are never stored.
 * consumeTransaction uses a Firestore transaction to read-and-delete atomically.
 */
export function createMailboxOAuthFirestoreTransactionStore(db) {
  if (!db || typeof db.doc !== "function" || typeof db.runTransaction !== "function") {
    throw new TypeError("A trusted Firestore Admin database is required.");
  }
  const refFor = stateHash => db.doc(`mailboxOAuthTransactions/${stateHash}`);
  return Object.freeze({
    async saveTransaction({ stateHash, transaction }) {
      validateTransaction(stateHash, transaction);
      const ref = refFor(stateHash);
      await ref.create(transaction);
    },
    async consumeTransaction({ stateHash }) {
      if (typeof stateHash !== "string" || !HASH.test(stateHash)) return null;
      const ref = refFor(stateHash);
      return db.runTransaction(async tx => {
        const snapshot = await tx.get(ref);
        if (!snapshot.exists) return null;
        const value = snapshot.data();
        tx.delete(ref);
        try { validateTransaction(stateHash, value); }
        catch { return null; }
        return value;
      });
    }
  });
}
