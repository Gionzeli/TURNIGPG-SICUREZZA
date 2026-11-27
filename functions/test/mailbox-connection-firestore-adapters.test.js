import test from "node:test";
import assert from "node:assert/strict";
import { createMailboxConnectionFirestoreAdapters } from "../src/membership/mailbox-connection-firestore-adapters.js";

function fakeFirestore() {
  const docs = new Map();
  const db = {
    collection(path) {
      return {
        where(field, value, expected) {
          return {
            orderBy() {
              return {
                limit(max) {
                  return {
                    async get() {
                      const prefix = path + "/";
                      const docsFound = [...docs.entries()]
                        .filter(([key, item]) => key.startsWith(prefix) && item[field] === expected)
                        .slice(0, max)
                        .map(([key, value]) => ({ id: key.slice(prefix.length), data: () => value }));
                      return { docs: docsFound };
                    }
                  };
                }
              };
            }
          };
        }
      };
    },
    doc(path) {
      return {
        path,
        async get() {
          const value = docs.get(path);
          return { exists: value !== undefined, data: () => value };
        },
        async create(value) {
          if (docs.has(path)) {
            const error = new Error("already exists");
            error.code = "already-exists";
            throw error;
          }
          docs.set(path, structuredClone(value));
        }
      };
    },
    async runTransaction(callback) {
      return callback({
        async get(ref) {
          const value = docs.get(ref.path);
          return { exists: value !== undefined, data: () => value };
        },
        set(ref, value) { docs.set(ref.path, structuredClone(value)); }
      });
    }
  };
  return { db, docs };
}

const active = {
  accountId: "synthetic-account",
  connectionId: "synthetic-connection",
  provider: "imap",
  mode: "personal",
  status: "active",
  mailboxAddress: "collaboratore@example.invalid",
  allowedSenders: ["turni@azienda.example"],
  ownerUid: "synthetic-uid",
  ownerEmployeeId: "synthetic-employee",
  createdByUid: "synthetic-uid",
  createdAt: 1795766400000,
  updatedAt: 1795766400000,
  credentialSecretRef: "vault://synthetic/secret",
  consent: { grantedByUid: "synthetic-uid", grantedAt: 1795766400000, version: 1 }
};

test("connection metadata is persisted only through the server adapter and can be loaded", async () => {
  const { db, docs } = fakeFirestore();
  const adapters = createMailboxConnectionFirestoreAdapters(db);
  await adapters.saveConnection({
    accountId: active.accountId, connectionId: active.connectionId, connection: active
  });
  const path = "accounts/synthetic-account/mailboxConnections/synthetic-connection";
  assert.deepEqual(docs.get(path), active);
  assert.deepEqual(await adapters.loadConnection({
    accountId: active.accountId, connectionId: active.connectionId
  }), active);
});

test("revocation state is monotonic and clears the vault reference only after pending", async () => {
  const { db, docs } = fakeFirestore();
  const adapters = createMailboxConnectionFirestoreAdapters(db);
  const args = { accountId: active.accountId, connectionId: active.connectionId };
  await adapters.saveConnection({ ...args, connection: active });
  const pending = { ...active, status: "revocation_pending", updatedAt: active.updatedAt + 1 };
  await adapters.saveConnection({ ...args, connection: pending });
  const revoked = {
    ...pending, status: "revoked", credentialSecretRef: null,
    revokedAt: pending.updatedAt + 1, updatedAt: pending.updatedAt + 1
  };
  await adapters.saveConnection({ ...args, connection: revoked });
  assert.equal(docs.get("accounts/synthetic-account/mailboxConnections/synthetic-connection").status, "revoked");
  await assert.rejects(
    adapters.saveConnection({ ...args, connection: active }),
    error => error.code === "failed-precondition"
  );
});

test("connection owner, mailbox, provider and sender allowlist cannot be changed after creation", async () => {
  const { db } = fakeFirestore();
  const adapters = createMailboxConnectionFirestoreAdapters(db);
  const args = { accountId: active.accountId, connectionId: active.connectionId };
  await adapters.saveConnection({ ...args, connection: active });
  await assert.rejects(adapters.saveConnection({
    ...args,
    connection: {
      ...active, ownerUid: "attacker-uid", createdByUid: "attacker-uid",
      consent: { ...active.consent, grantedByUid: "attacker-uid" },
      updatedAt: active.updatedAt + 1
    }
  }), error => error.code === "failed-precondition");
});

test("revoked connection cannot retain a credential reference", async () => {
  const { db } = fakeFirestore();
  const adapters = createMailboxConnectionFirestoreAdapters(db);
  const invalid = {
    ...active, status: "revoked", revokedAt: active.updatedAt + 1,
    updatedAt: active.updatedAt + 1
  };
  await assert.rejects(
    adapters.saveConnection({
      accountId: active.accountId, connectionId: active.connectionId, connection: invalid
    }),
    error => error.code === "invalid-argument"
  );
});

test("audit records are immutable creates and contain no credential material", async () => {
  const { db, docs } = fakeFirestore();
  const adapters = createMailboxConnectionFirestoreAdapters(db);
  await adapters.writeAudit({
    accountId: active.accountId, actorUid: active.ownerUid,
    action: "mailbox_connection_created", connectionId: active.connectionId,
    mode: active.mode, provider: active.provider, timestamp: active.createdAt
  });
  const audit = [...docs.entries()].find(([path]) => path.includes("/mailboxConnectionAudit/"));
  assert.ok(audit);
  assert.equal(audit[1].action, "mailbox_connection_created");
  assert.equal(Object.hasOwn(audit[1], "credentialSecretRef"), false);
});

test("email validation rejects whitespace and malformed sender addresses", async () => {
  const { db } = fakeFirestore();
  const adapters = createMailboxConnectionFirestoreAdapters(db);
  await assert.rejects(adapters.saveConnection({
    accountId: active.accountId, connectionId: active.connectionId,
    connection: { ...active, mailboxAddress: "bad address@example.invalid" }
  }), error => error.code === "invalid-argument");
  await assert.rejects(adapters.saveConnection({
    accountId: active.accountId, connectionId: active.connectionId,
    connection: { ...active, allowedSenders: ["turni@azienda.example\nattacker"] }
  }), error => error.code === "invalid-argument");
});

test("metadata rejects nested credential leakage and non-normalized or duplicate sender addresses", async () => {
  const { db } = fakeFirestore();
  const adapters = createMailboxConnectionFirestoreAdapters(db);
  await assert.rejects(adapters.saveConnection({
    accountId: active.accountId, connectionId: active.connectionId,
    connection: { ...active, consent: { ...active.consent, accessToken: "must-not-persist" } }
  }), error => error.code === "invalid-argument");
  await assert.rejects(adapters.saveConnection({
    accountId: active.accountId, connectionId: active.connectionId,
    connection: { ...active, allowedSenders: ["TURNI@AZIENDA.EXAMPLE"] }
  }), error => error.code === "invalid-argument");
  await assert.rejects(adapters.saveConnection({
    accountId: active.accountId, connectionId: active.connectionId,
    connection: { ...active, allowedSenders: ["turni@azienda.example", "turni@azienda.example"] }
  }), error => error.code === "invalid-argument");
});


test("credential cleanup outbox persists retry state and completes monotonically", async () => {
  const { db, docs } = fakeFirestore();
  const adapters = createMailboxConnectionFirestoreAdapters(db);
  const input = {
    accountId: active.accountId, connectionId: active.connectionId,
    secretRef: active.credentialSecretRef, reason: "connection_revoked",
    timestamp: active.createdAt + 1
  };
  await adapters.recordSecretCleanup(input);
  const path = "accounts/synthetic-account/mailboxCredentialCleanup/synthetic-connection";
  assert.equal(docs.get(path).status, "pending");
  assert.equal((await adapters.loadSecretCleanup({
    accountId: active.accountId, connectionId: active.connectionId
  })).secretRef, active.credentialSecretRef);
  await adapters.recordSecretCleanup({ ...input, timestamp: input.timestamp + 1 });
  assert.equal(docs.get(path).attempts, 2);
  await adapters.completeSecretCleanup({
    accountId: active.accountId, connectionId: active.connectionId,
    timestamp: input.timestamp + 2
  });
  assert.equal(docs.get(path).status, "complete");
  await assert.rejects(adapters.completeSecretCleanup({
    accountId: active.accountId, connectionId: active.connectionId,
    timestamp: input.timestamp + 3
  }), error => error.code === "failed-precondition");
});

test("cleanup outbox refuses a different secret reference for an existing connection ticket", async () => {
  const { db } = fakeFirestore();
  const adapters = createMailboxConnectionFirestoreAdapters(db);
  const input = {
    accountId: active.accountId, connectionId: active.connectionId,
    secretRef: active.credentialSecretRef, reason: "connection_revoked",
    timestamp: active.createdAt + 1
  };
  await adapters.recordSecretCleanup(input);
  await assert.rejects(adapters.recordSecretCleanup({
    ...input, secretRef: "vault://different/secret"
  }), error => error.code === "failed-precondition");
});


test("cleanup outbox exposes only validated pending tickets for an account", async () => {
  const { db } = fakeFirestore();
  const adapters = createMailboxConnectionFirestoreAdapters(db);
  await adapters.recordSecretCleanup({
    accountId: active.accountId, connectionId: active.connectionId,
    secretRef: active.credentialSecretRef, reason: "connection_revoked",
    timestamp: active.createdAt + 1
  });
  const pending = await adapters.listPendingSecretCleanup({ accountId: active.accountId });
  assert.equal(pending.length, 1);
  assert.equal(pending[0].secretRef, active.credentialSecretRef);
  assert.deepEqual(await adapters.listPendingSecretCleanup({
    accountId: "another-account"
  }), []);
  await assert.rejects(adapters.listPendingSecretCleanup({
    accountId: active.accountId, limit: 1000
  }), error => error.code === "invalid-argument");
});
