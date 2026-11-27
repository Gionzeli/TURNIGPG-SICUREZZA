import test from "node:test";
import assert from "node:assert/strict";
import { createMailboxOAuthTransactionService } from "../src/membership/mailbox-oauth-transaction-service.js";
import { createMailboxOAuthFirestoreTransactionStore } from "../src/membership/mailbox-oauth-firestore-transaction-store.js";

function fakeFirestore() {
  const docs = new Map();
  const db = {
    doc(path) {
      return {
        path,
        async create(value) {
          if (docs.has(path)) { const e = new Error("exists"); e.code = "already-exists"; throw e; }
          docs.set(path, structuredClone(value));
        }
      };
    },
    async runTransaction(callback) {
      return callback({
        async get(ref) { const value = docs.get(ref.path); return { exists: value !== undefined, data: () => value }; },
        delete(ref) { docs.delete(ref.path); }
      });
    }
  };
  return { db, docs };
}
const ctx = { accountId: "synthetic-account", actorUid: "synthetic-uid", provider: "gmail_api" };

test("Firestore transaction adapter saves only hashed state and atomically consumes once", async () => {
  const { db, docs } = fakeFirestore();
  const store = createMailboxOAuthFirestoreTransactionStore(db);
  let clock = 1795766400000;
  const service = createMailboxOAuthTransactionService({ ...store, now: () => clock });
  const started = await service.begin(ctx);
  const pathHash = [...docs.keys()][0].split("/").at(-1);
  assert.match(pathHash, /^[a-f0-9]{64}$/);
  assert.equal([...docs.keys()][0].includes(started.state), false);
  assert.equal(docs.size, 1);
  const used = await service.consume({ ...ctx, state: started.state });
  assert.equal(used.codeChallenge, started.codeChallenge);
  assert.equal(docs.size, 0);
  await assert.rejects(service.consume({ ...ctx, state: started.state }), e => e.code === "permission-denied");
});

test("adapter rejects malformed records and state hash path input", async () => {
  const { db } = fakeFirestore();
  const store = createMailboxOAuthFirestoreTransactionStore(db);
  await assert.rejects(store.saveTransaction({ stateHash: "not-a-hash", transaction: {} }),
    e => e.code === "invalid-argument");
  assert.equal(await store.consumeTransaction({ stateHash: "../../invalid" }), null);
});

test("consume removes expired transaction records as well as valid ones", async () => {
  const { db, docs } = fakeFirestore();
  const store = createMailboxOAuthFirestoreTransactionStore(db);
  let clock = 1795766400000;
  const service = createMailboxOAuthTransactionService({ ...store, now: () => clock });
  const started = await service.begin(ctx);
  clock += 10 * 60 * 1000;
  await assert.rejects(service.consume({ ...ctx, state: started.state }), e => e.code === "permission-denied");
  assert.equal(docs.size, 0);
});
