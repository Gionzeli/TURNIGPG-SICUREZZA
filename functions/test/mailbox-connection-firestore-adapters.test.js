import test from "node:test";
import assert from "node:assert/strict";
import { createMailboxConnectionFirestoreAdapters } from "../src/membership/mailbox-connection-firestore-adapters.js";

function secretRef(accountId, connectionId, opaqueId = "syntheticopaqueid123") {
  return `mailbox/${accountId}/${connectionId}/${opaqueId}`;
}

function fakeFirestore() {
  const docs = new Map();
  const db = {
    collection(path) {
      const buildQuery = (filters = [], order = null, max = 50) => ({
        where(field, operator, expected) {
          if (operator !== "==") throw new Error("unsupported fake query operator");
          return buildQuery([...filters, [field, expected]], order, max);
        },
        orderBy(field, direction) {
          return buildQuery(filters, [field, direction], max);
        },
        limit(value) {
          return buildQuery(filters, order, value);
        },
        async get() {
          const prefix = path + "/";
          let entries = [...docs.entries()]
            .filter(([key, item]) => key.startsWith(prefix) &&
              filters.every(([field, expected]) => item[field] === expected));
          if (order) {
            const [field, direction] = order;
            entries.sort((a, b) => {
              const av = a[1][field] ?? 0;
              const bv = b[1][field] ?? 0;
              return (av - bv) * (direction === "desc" ? -1 : 1) ||
                (a[1].createdAt ?? 0) - (b[1].createdAt ?? 0);
            });
          }
          return { docs: entries.slice(0, max)
            .map(([key, value]) => ({ id: key.slice(prefix.length), data: () => value })) };
        }
      });
      return buildQuery();
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

async function exhaustCleanup(adapters, input) {
  for (let attempts = 2; attempts <= 12; attempts++) {
    await adapters.recordSecretCleanupFailure({
      accountId: input.accountId, connectionId: input.connectionId,
      secretRef: input.secretRef, attempts,
      nextAttemptAt: attempts >= 12 ? null : input.timestamp + 60000,
      lastErrorCode: "unavailable", timestamp: input.timestamp + 1
    });
  }
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
  credentialSecretRef: secretRef("synthetic-account", "synthetic-connection"),
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
  assert.equal(docs.get(path).attempts, 1, "re-recording is not a worker retry");
  await adapters.completeSecretCleanup({
    accountId: active.accountId, connectionId: active.connectionId,
    timestamp: input.timestamp + 2
  });
  assert.equal(docs.get(path).status, "complete");
  await adapters.completeSecretCleanup({
    accountId: active.accountId, connectionId: active.connectionId,
    timestamp: input.timestamp + 3
  });
  assert.equal(docs.get(path).status, "complete");
  docs.get(path).completedAt = "corrupt";
  await assert.rejects(adapters.completeSecretCleanup({
    accountId: active.accountId, connectionId: active.connectionId,
    timestamp: input.timestamp + 4
  }), error => error.code === "failed-precondition");
  assert.equal(docs.get(path).completedAt, "corrupt", "malformed terminal ticket is not silently acknowledged");
});

test("idempotent cleanup recording refuses malformed existing tickets", async () => {
  const { db, docs } = fakeFirestore();
  const adapters = createMailboxConnectionFirestoreAdapters(db);
  const input = {
    accountId: active.accountId, connectionId: active.connectionId,
    secretRef: active.credentialSecretRef, reason: "connection_revoked",
    timestamp: active.createdAt + 1
  };
  await adapters.recordSecretCleanup(input);
  const path = "accounts/synthetic-account/mailboxCredentialCleanup/synthetic-connection";
  const original = structuredClone(docs.get(path));
  for (const malformed of [
    { createdAt: original.updatedAt + 1 },
    { reason: "INVALID REASON" },
    { attempts: 2, nextAttemptAt: null, lastErrorCode: "unavailable" },
    { updatedAt: 0 }
  ]) {
    docs.set(path, { ...original, ...malformed });
    await assert.rejects(adapters.recordSecretCleanup({
      ...input, timestamp: input.timestamp + 10
    }), error => error.code === "failed-precondition");
    assert.deepEqual(docs.get(path), { ...original, ...malformed });
  }
  docs.set(path, original);
  await adapters.recordSecretCleanup({ ...input, timestamp: input.timestamp + 20 });
  assert.equal(docs.get(path).attempts, 1);
});

test("cleanup completion rejects inconsistent persisted retry counters", async () => {
  const { db, docs } = fakeFirestore();
  const adapters = createMailboxConnectionFirestoreAdapters(db);
  const input = {
    accountId: active.accountId, connectionId: active.connectionId,
    secretRef: active.credentialSecretRef, reason: "connection_revoked",
    timestamp: active.createdAt + 1
  };
  await adapters.recordSecretCleanup(input);
  const path = "accounts/synthetic-account/mailboxCredentialCleanup/synthetic-connection";
  docs.get(path).attempts = 2;
  docs.get(path).nextAttemptAt = null;
  docs.get(path).lastErrorCode = null;
  await assert.rejects(adapters.completeSecretCleanup({
    accountId: input.accountId, connectionId: input.connectionId,
    timestamp: input.timestamp + 1
  }), error => error.code === "failed-precondition");
  assert.equal(docs.get(path).status, "pending", "malformed ticket remains unchanged");
});


test("successful deletion resolves an exhausted cleanup ticket and its pending alert", async () => {
  const { db, docs } = fakeFirestore();
  const adapters = createMailboxConnectionFirestoreAdapters(db);
  const input = {
    accountId: active.accountId, connectionId: active.connectionId,
    secretRef: active.credentialSecretRef, reason: "connection_revoked",
    timestamp: active.createdAt + 1
  };
  await adapters.recordSecretCleanup(input);
  await exhaustCleanup(adapters, input);
  const path = "accounts/synthetic-account/mailboxCredentialCleanup/synthetic-connection";
  assert.equal(docs.get(path).status, "exhausted");
  assert.equal(docs.get(path).alertStatus, "pending");
  await adapters.completeSecretCleanup({
    accountId: input.accountId, connectionId: input.connectionId,
    timestamp: input.timestamp + 2
  });
  const stored = docs.get(path);
  assert.equal(stored.status, "complete");
  assert.equal(stored.alertStatus, "resolved");
  assert.equal(stored.alertResolvedAt, input.timestamp + 2);
  assert.deepEqual(await adapters.listPendingCleanupAlerts({
    accountId: input.accountId
  }), []);
  await adapters.completeSecretCleanup({
    accountId: input.accountId, connectionId: input.connectionId,
    timestamp: input.timestamp + 3
  });
  assert.equal(docs.get(path).completedAt, input.timestamp + 2);
});

test("exhausted cleanup reads reject malformed alert terminal metadata", async () => {
  const { db, docs } = fakeFirestore();
  const adapters = createMailboxConnectionFirestoreAdapters(db);
  const input = {
    accountId: active.accountId, connectionId: active.connectionId,
    secretRef: active.credentialSecretRef, reason: "connection_revoked",
    timestamp: active.createdAt + 1
  };
  await adapters.recordSecretCleanup(input);
  await exhaustCleanup(adapters, input);
  const path = "accounts/synthetic-account/mailboxCredentialCleanup/synthetic-connection";
  docs.get(path).alertAttempts = 2;
  docs.get(path).alertNextAttemptAt = null;
  docs.get(path).alertLastErrorCode = null;
  assert.equal(await adapters.loadSecretCleanup({
    accountId: input.accountId, connectionId: input.connectionId
  }), null);
  assert.deepEqual(await adapters.listPendingCleanupAlerts({
    accountId: input.accountId
  }), []);
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
    ...input, secretRef: secretRef(input.accountId, input.connectionId, "differentopaqueid123")
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


test("pending cleanup queries exclude stray alert metadata", async () => {
  const { db, docs } = fakeFirestore();
  const adapters = createMailboxConnectionFirestoreAdapters(db);
  await adapters.recordSecretCleanup({
    accountId: active.accountId, connectionId: active.connectionId,
    secretRef: active.credentialSecretRef, reason: "connection_revoked",
    timestamp: active.createdAt + 1
  });
  const path = "accounts/synthetic-account/mailboxCredentialCleanup/synthetic-connection";
  const valid = docs.get(path);
  for (const [field, value] of [
    ["alertStatus", "pending"], ["alertAttempts", 0],
    ["alertNextAttemptAt", 1000], ["alertLastErrorCode", "unavailable"],
    ["alertDeliveredAt", 1000], ["alertResolvedAt", 1000]
  ]) {
    docs.set(path, { ...valid, [field]: value });
    assert.deepEqual(await adapters.listPendingSecretCleanup({
      accountId: active.accountId
    }), [], field + " must not appear on a pending cleanup ticket");
  }
});


test("pending cleanup reads reject inconsistent retry state", async () => {
  const { db, docs } = fakeFirestore();
  const adapters = createMailboxConnectionFirestoreAdapters(db);
  await adapters.recordSecretCleanup({
    accountId: active.accountId, connectionId: active.connectionId,
    secretRef: active.credentialSecretRef, reason: "connection_revoked",
    timestamp: active.createdAt + 1
  });
  const path = "accounts/synthetic-account/mailboxCredentialCleanup/synthetic-connection";
  const initial = docs.get(path);
  docs.set(path, { ...initial, attempts: 2, nextAttemptAt: null, lastErrorCode: null });
  assert.deepEqual(await adapters.listPendingSecretCleanup({ accountId: active.accountId }), []);
  assert.equal(await adapters.loadSecretCleanup({
    accountId: active.accountId, connectionId: active.connectionId
  }), null);
  docs.set(path, { ...initial, attempts: 12, nextAttemptAt: null, lastErrorCode: "unavailable" });
  assert.deepEqual(await adapters.listPendingSecretCleanup({ accountId: active.accountId }), []);
  assert.equal(await adapters.loadSecretCleanup({
    accountId: active.accountId, connectionId: active.connectionId
  }), null);
});


test("cleanup transitions reject timestamps older than persisted update time", async () => {
  const { db, docs } = fakeFirestore();
  const adapters = createMailboxConnectionFirestoreAdapters(db);
  const input = {
    accountId: active.accountId, connectionId: active.connectionId,
    secretRef: active.credentialSecretRef, reason: "connection_revoked",
    timestamp: active.createdAt + 100
  };
  await adapters.recordSecretCleanup(input);
  const path = "accounts/synthetic-account/mailboxCredentialCleanup/synthetic-connection";
  await assert.rejects(adapters.recordSecretCleanupFailure({
    accountId: input.accountId, connectionId: input.connectionId, secretRef: input.secretRef,
    attempts: 2, nextAttemptAt: input.timestamp + 60000,
    lastErrorCode: "unavailable", timestamp: input.timestamp - 1
  }), error => error.code === "failed-precondition");
  assert.equal(docs.get(path).attempts, 1);

  for (let attempts = 2; attempts <= 12; attempts += 1) {
    const timestamp = input.timestamp + attempts;
    await adapters.recordSecretCleanupFailure({
      accountId: input.accountId, connectionId: input.connectionId, secretRef: input.secretRef,
      attempts, nextAttemptAt: attempts >= 12 ? null : timestamp + 60000,
      lastErrorCode: "unavailable", timestamp
    });
  }
  const exhaustedAt = docs.get(path).updatedAt;
  await assert.rejects(adapters.recordCleanupAlertFailure({
    accountId: input.accountId, connectionId: input.connectionId,
    attempts: 1, nextAttemptAt: exhaustedAt + 60000,
    lastErrorCode: "unavailable", timestamp: exhaustedAt - 1
  }), error => error.code === "failed-precondition");
  await assert.rejects(adapters.markCleanupAlertDelivered({
    accountId: input.accountId, connectionId: input.connectionId,
    timestamp: exhaustedAt - 1
  }), error => error.code === "failed-precondition");
  assert.equal(docs.get(path).alertStatus, "pending");
});

test("pending cleanup reads reject retry timestamps older than the last update", async () => {
  const { db, docs } = fakeFirestore();
  const adapters = createMailboxConnectionFirestoreAdapters(db);
  const input = {
    accountId: active.accountId, connectionId: active.connectionId,
    secretRef: active.credentialSecretRef, reason: "connection_revoked",
    timestamp: active.createdAt + 1
  };
  await adapters.recordSecretCleanup(input);
  await adapters.recordSecretCleanupFailure({
    accountId: input.accountId, connectionId: input.connectionId, secretRef: input.secretRef,
    attempts: 2, nextAttemptAt: input.timestamp + 60000,
    lastErrorCode: "unavailable", timestamp: input.timestamp + 2
  });
  const path = "accounts/synthetic-account/mailboxCredentialCleanup/synthetic-connection";
  const valid = docs.get(path);
  for (const malformed of [
    { nextAttemptAt: input.timestamp + 1 },
    { updatedAt: "invalid" },
    { updatedAt: input.timestamp + 70000 }
  ]) {
    docs.set(path, { ...valid, ...malformed });
    assert.deepEqual(await adapters.listPendingSecretCleanup({ accountId: input.accountId }), []);
    assert.equal(await adapters.loadSecretCleanup({
      accountId: input.accountId, connectionId: input.connectionId
    }), null);
  }
});

test("cleanup retry metadata persists backoff and rejects stale attempts", async () => {
  const { db, docs } = fakeFirestore();
  const adapters = createMailboxConnectionFirestoreAdapters(db);
  const input = {
    accountId: active.accountId, connectionId: active.connectionId,
    secretRef: active.credentialSecretRef, reason: "connection_revoked",
    timestamp: active.createdAt + 1
  };
  await adapters.recordSecretCleanup(input);
  const ticketPath = "accounts/synthetic-account/mailboxCredentialCleanup/synthetic-connection";
  await adapters.recordSecretCleanupFailure({
    accountId: input.accountId, connectionId: input.connectionId, secretRef: input.secretRef,
    attempts: 2, nextAttemptAt: input.timestamp + 60000,
    lastErrorCode: "unavailable", timestamp: input.timestamp + 2
  });
  assert.equal(docs.get(ticketPath).attempts, 2);
  assert.equal(docs.get(ticketPath).nextAttemptAt, input.timestamp + 60000);
  assert.equal(docs.get(ticketPath).lastErrorCode, "unavailable");
  await assert.rejects(adapters.recordSecretCleanupFailure({
    accountId: input.accountId, connectionId: input.connectionId, secretRef: input.secretRef,
    attempts: 4, nextAttemptAt: input.timestamp + 90000,
    lastErrorCode: "unavailable", timestamp: input.timestamp + 3
  }), error => error.code === "failed-precondition", "retry counters cannot skip a failure");
  await assert.rejects(adapters.recordSecretCleanupFailure({
    accountId: input.accountId, connectionId: input.connectionId, secretRef: input.secretRef,
    attempts: 2, nextAttemptAt: input.timestamp + 30000,
    lastErrorCode: "unavailable", timestamp: input.timestamp + 3
  }), error => error.code === "failed-precondition");
});


test("pending cleanup listing excludes malformed retry metadata", async () => {
  const { db, docs } = fakeFirestore();
  const adapters = createMailboxConnectionFirestoreAdapters(db);
  const input = {
    accountId: active.accountId, connectionId: active.connectionId,
    secretRef: active.credentialSecretRef, reason: "connection_revoked",
    timestamp: active.createdAt + 1
  };
  await adapters.recordSecretCleanup(input);
  const path = "accounts/synthetic-account/mailboxCredentialCleanup/synthetic-connection";
  docs.set(path, { ...docs.get(path), nextAttemptAt: "run-now" });
  assert.deepEqual(await adapters.listPendingSecretCleanup({
    accountId: active.accountId
  }), []);
  docs.set(path, {
    ...docs.get(path), nextAttemptAt: null, lastErrorCode: "provider error with details"
  });
  assert.deepEqual(await adapters.listPendingSecretCleanup({
    accountId: active.accountId
  }), []);
});

test("pending cleanup listing rejects document IDs that disagree with ticket identity", async () => {
  const { db, docs } = fakeFirestore();
  const adapters = createMailboxConnectionFirestoreAdapters(db);
  const input = {
    accountId: active.accountId, connectionId: active.connectionId,
    secretRef: active.credentialSecretRef, reason: "connection_revoked",
    timestamp: active.createdAt + 1
  };
  await adapters.recordSecretCleanup(input);
  const correctPath = "accounts/synthetic-account/mailboxCredentialCleanup/synthetic-connection";
  const wrongPath = "accounts/synthetic-account/mailboxCredentialCleanup/other-connection";
  const ticket = docs.get(correctPath);
  docs.delete(correctPath);
  docs.set(wrongPath, ticket);
  assert.deepEqual(await adapters.listPendingSecretCleanup({
    accountId: input.accountId
  }), []);
});

test("pending cleanup alert listing rejects document IDs that disagree with ticket identity", async () => {
  const { db, docs } = fakeFirestore();
  const adapters = createMailboxConnectionFirestoreAdapters(db);
  const input = {
    accountId: active.accountId, connectionId: active.connectionId,
    secretRef: active.credentialSecretRef, reason: "connection_revoked",
    timestamp: active.createdAt + 1
  };
  await adapters.recordSecretCleanup(input);
  await exhaustCleanup(adapters, input);
  const correctPath = "accounts/synthetic-account/mailboxCredentialCleanup/synthetic-connection";
  const wrongPath = "accounts/synthetic-account/mailboxCredentialCleanup/other-connection";
  const ticket = docs.get(correctPath);
  docs.delete(correctPath);
  docs.set(wrongPath, ticket);
  assert.deepEqual(await adapters.listPendingCleanupAlerts({
    accountId: input.accountId
  }), []);
});

test("cleanup retry ceiling moves tickets out of the pending queue", async () => {
  const { db, docs } = fakeFirestore();
  const adapters = createMailboxConnectionFirestoreAdapters(db);
  const input = {
    accountId: active.accountId, connectionId: active.connectionId,
    secretRef: active.credentialSecretRef, reason: "connection_revoked",
    timestamp: active.createdAt + 1
  };
  await adapters.recordSecretCleanup(input);
  await exhaustCleanup(adapters, input);
  assert.equal(docs.get("accounts/synthetic-account/mailboxCredentialCleanup/synthetic-connection").status, "exhausted");
  assert.deepEqual(await adapters.listPendingSecretCleanup({ accountId: active.accountId }), []);
  assert.equal((await adapters.loadSecretCleanup({
    accountId: active.accountId, connectionId: active.connectionId
  })).status, "exhausted");
});

test("pending cleanup query sorts never-attempted and due work ahead of future retries", async () => {
  const { db } = fakeFirestore();
  const adapters = createMailboxConnectionFirestoreAdapters(db);
  for (let i = 0; i < 4; i++) {
    const connectionId = "future-" + i;
    await adapters.recordSecretCleanup({
      accountId: active.accountId, connectionId,
      secretRef: secretRef(active.accountId, connectionId, "opaqueidentifier" + i), reason: "connection_revoked",
      timestamp: active.createdAt + i
    });
    await adapters.recordSecretCleanupFailure({
      accountId: active.accountId, connectionId, secretRef: secretRef(active.accountId, connectionId, "opaqueidentifier" + i),
      attempts: 2, nextAttemptAt: 900000 + i, lastErrorCode: "unavailable",
      timestamp: 800000 + i
    });
  }
  await adapters.recordSecretCleanup({
    accountId: active.accountId, connectionId: "new-due",
    secretRef: secretRef(active.accountId, "new-due"), reason: "connection_revoked",
    timestamp: active.createdAt + 10
  });
  const batch = await adapters.listPendingSecretCleanup({ accountId: active.accountId, limit: 1 });
  assert.equal(batch.length, 1);
  assert.equal(batch[0].connectionId, "new-due");
});


test("exhausted cleanup alert is durably queued and acknowledged", async () => {
  const { db, docs } = fakeFirestore();
  const adapters = createMailboxConnectionFirestoreAdapters(db);
  const input = {
    accountId: active.accountId, connectionId: active.connectionId,
    secretRef: active.credentialSecretRef, reason: "connection_revoked",
    timestamp: active.createdAt + 1
  };
  await adapters.recordSecretCleanup(input);
  await exhaustCleanup(adapters, input);
  const queued = await adapters.listPendingCleanupAlerts({ accountId: input.accountId });
  assert.equal(queued.length, 1);
  assert.equal(queued[0].alertStatus, "pending");
  assert.equal(queued[0].connectionId, input.connectionId);
  assert.equal(queued[0].alertAttempts, 0);
  assert.equal(queued[0].createdAt, docs.get("accounts/synthetic-account/mailboxCredentialCleanup/synthetic-connection").createdAt);
  assert.equal(queued[0].updatedAt, docs.get("accounts/synthetic-account/mailboxCredentialCleanup/synthetic-connection").updatedAt);
  assert.equal(queued[0].nextAttemptAt, null);
  assert.equal(Object.hasOwn(queued[0], "secretRef"), false);
  assert.equal(Object.hasOwn(queued[0], "reason"), false);
  await adapters.markCleanupAlertDelivered({
    accountId: input.accountId, connectionId: input.connectionId,
    timestamp: input.timestamp + 2
  });
  const stored = docs.get("accounts/synthetic-account/mailboxCredentialCleanup/synthetic-connection");
  assert.equal(stored.alertStatus, "delivered");
  assert.equal(stored.alertDeliveredAt, input.timestamp + 2);
  assert.deepEqual(await adapters.listPendingCleanupAlerts({ accountId: input.accountId }), []);
  await adapters.markCleanupAlertDelivered({
    accountId: input.accountId, connectionId: input.connectionId,
    timestamp: input.timestamp + 3
  });
  const delivered = docs.get("accounts/synthetic-account/mailboxCredentialCleanup/synthetic-connection");
  delivered.alertDeliveredAt = "corrupt";
  await assert.rejects(adapters.markCleanupAlertDelivered({
    accountId: input.accountId, connectionId: input.connectionId,
    timestamp: input.timestamp + 4
  }), error => error.code === "failed-precondition");
  assert.equal(delivered.alertDeliveredAt, "corrupt", "malformed terminal state is not silently acknowledged");
});


test("pending cleanup alert listing excludes malformed retry metadata", async () => {
  const { db, docs } = fakeFirestore();
  const adapters = createMailboxConnectionFirestoreAdapters(db);
  const input = {
    accountId: active.accountId, connectionId: active.connectionId,
    secretRef: active.credentialSecretRef, reason: "connection_revoked",
    timestamp: active.createdAt + 1
  };
  await adapters.recordSecretCleanup(input);
  await exhaustCleanup(adapters, input);
  const path = "accounts/synthetic-account/mailboxCredentialCleanup/synthetic-connection";
  const valid = docs.get(path);
  docs.set(path, { ...valid, alertAttempts: "many" });
  assert.deepEqual(await adapters.listPendingCleanupAlerts({ accountId: input.accountId }), []);
  docs.set(path, { ...valid, alertNextAttemptAt: "send-now" });
  assert.deepEqual(await adapters.listPendingCleanupAlerts({ accountId: input.accountId }), []);
  docs.set(path, { ...valid, alertLastErrorCode: "provider error details" });
  assert.deepEqual(await adapters.listPendingCleanupAlerts({ accountId: input.accountId }), []);
});

test("exhausted cleanup alert retries persist backoff and reject stale attempts", async () => {
  const { db, docs } = fakeFirestore();
  const adapters = createMailboxConnectionFirestoreAdapters(db);
  const input = {
    accountId: active.accountId, connectionId: active.connectionId,
    secretRef: active.credentialSecretRef, reason: "connection_revoked",
    timestamp: active.createdAt + 1
  };
  await adapters.recordSecretCleanup(input);
  await exhaustCleanup(adapters, input);
  const path = "accounts/synthetic-account/mailboxCredentialCleanup/synthetic-connection";
  assert.equal(docs.get(path).alertAttempts, 0);
  await adapters.recordCleanupAlertFailure({
    accountId: input.accountId, connectionId: input.connectionId,
    attempts: 1, nextAttemptAt: input.timestamp + 60000,
    lastErrorCode: "unavailable", timestamp: input.timestamp + 2
  });
  assert.equal(docs.get(path).alertAttempts, 1);
  assert.equal(docs.get(path).alertNextAttemptAt, input.timestamp + 60000);
  assert.equal(docs.get(path).alertLastErrorCode, "unavailable");
  await assert.rejects(adapters.recordCleanupAlertFailure({
    accountId: input.accountId, connectionId: input.connectionId,
    attempts: 1, nextAttemptAt: input.timestamp + 30000,
    lastErrorCode: "unavailable", timestamp: input.timestamp + 3
  }), error => error.code === "failed-precondition");
  const pending = await adapters.listPendingCleanupAlerts({ accountId: input.accountId });
  assert.equal(pending.length, 1);
  assert.equal(pending[0].alertAttempts, 1);
});


test("cleanup alert retry counter is not artificially capped at one thousand", async () => {
  const { db, docs } = fakeFirestore();
  const adapters = createMailboxConnectionFirestoreAdapters(db);
  const input = {
    accountId: active.accountId, connectionId: active.connectionId,
    secretRef: active.credentialSecretRef, reason: "connection_revoked",
    timestamp: active.createdAt + 1
  };
  await adapters.recordSecretCleanup(input);
  await exhaustCleanup(adapters, input);
  const path = "accounts/" + input.accountId + "/mailboxCredentialCleanup/" + input.connectionId;
  docs.get(path).alertAttempts = 1000;
  await adapters.recordCleanupAlertFailure({
    accountId: input.accountId, connectionId: input.connectionId,
    attempts: 1001, nextAttemptAt: input.timestamp + 60000,
    lastErrorCode: "unavailable", timestamp: input.timestamp + 2
  });
  assert.equal(docs.get(path).alertAttempts, 1001);
});


test("audit event identity is deterministic and repeated writes preserve first timestamp", async () => {
  const { db, docs } = fakeFirestore();
  const adapters = createMailboxConnectionFirestoreAdapters(db);
  const event = {
    accountId: active.accountId, actorUid: active.ownerUid,
    action: "mailbox_connection_revoked", connectionId: active.connectionId,
    mode: active.mode, provider: active.provider, timestamp: active.createdAt + 10
  };
  await adapters.writeAudit(event);
  await adapters.writeAudit({ ...event, timestamp: event.timestamp + 5000 });
  const entries = [...docs.entries()].filter(([path]) =>
    path.includes("/mailboxConnectionAudit/"));
  assert.equal(entries.length, 1);
  assert.equal(entries[0][1].timestamp, event.timestamp);
});

test("deterministic audit identity rejects incompatible event contents", async () => {
  const { db, docs } = fakeFirestore();
  const adapters = createMailboxConnectionFirestoreAdapters(db);
  const event = {
    accountId: active.accountId, actorUid: active.ownerUid,
    action: "mailbox_connection_revoked", connectionId: active.connectionId,
    mode: active.mode, provider: active.provider, timestamp: active.createdAt + 10
  };
  await adapters.writeAudit(event);
  await assert.rejects(adapters.writeAudit({
    ...event, actorUid: "different-actor", timestamp: event.timestamp + 1
  }), error => error.code === "failed-precondition");
  assert.equal([...docs.keys()].filter(path =>
    path.includes("/mailboxConnectionAudit/")).length, 1);
});


test("concurrent stale revocation finalization cannot rewrite terminal revoked metadata", async () => {
  const { db, docs } = fakeFirestore();
  const adapters = createMailboxConnectionFirestoreAdapters(db);
  const args = { accountId: active.accountId, connectionId: active.connectionId };
  await adapters.saveConnection({ ...args, connection: active });
  const pending = { ...active, status: "revocation_pending", updatedAt: active.updatedAt + 1 };
  await adapters.saveConnection({ ...args, connection: pending });
  const firstFinal = {
    ...pending, status: "revoked", credentialSecretRef: null,
    revokedAt: pending.updatedAt + 10, updatedAt: pending.updatedAt + 10
  };
  await adapters.saveConnection({ ...args, connection: firstFinal });
  const staleFinal = {
    ...pending, status: "revoked", credentialSecretRef: null,
    revokedAt: pending.updatedAt + 50, updatedAt: pending.updatedAt + 50
  };
  await adapters.saveConnection({ ...args, connection: staleFinal });
  const stored = docs.get("accounts/synthetic-account/mailboxConnections/synthetic-connection");
  assert.equal(stored.revokedAt, firstFinal.revokedAt);
  assert.equal(stored.updatedAt, firstFinal.updatedAt);
});


test("stale cleanup failure cannot reopen a ticket after successful completion", async () => {
  const { db, docs } = fakeFirestore();
  const adapters = createMailboxConnectionFirestoreAdapters(db);
  const input = {
    accountId: active.accountId, connectionId: active.connectionId,
    secretRef: active.credentialSecretRef, reason: "connection_revoked",
    timestamp: active.createdAt + 1
  };
  await adapters.recordSecretCleanup(input);
  await adapters.completeSecretCleanup({
    accountId: input.accountId, connectionId: input.connectionId,
    timestamp: input.timestamp + 1
  });
  await assert.rejects(adapters.recordSecretCleanupFailure({
    accountId: input.accountId, connectionId: input.connectionId,
    secretRef: input.secretRef, attempts: 2,
    nextAttemptAt: input.timestamp + 60000,
    lastErrorCode: "unavailable", timestamp: input.timestamp + 2
  }), error => error.code === "failed-precondition");
  const stored = docs.get("accounts/synthetic-account/mailboxCredentialCleanup/synthetic-connection");
  assert.equal(stored.status, "complete");
  assert.equal(stored.attempts, 1);
});

test("stale alert failure cannot revert a delivered exhaustion notification", async () => {
  const { db, docs } = fakeFirestore();
  const adapters = createMailboxConnectionFirestoreAdapters(db);
  const input = {
    accountId: active.accountId, connectionId: active.connectionId,
    secretRef: active.credentialSecretRef, reason: "connection_revoked",
    timestamp: active.createdAt + 1
  };
  await adapters.recordSecretCleanup(input);
  await exhaustCleanup(adapters, input);
  await adapters.markCleanupAlertDelivered({
    accountId: input.accountId, connectionId: input.connectionId,
    timestamp: input.timestamp + 2
  });
  await assert.rejects(adapters.recordCleanupAlertFailure({
    accountId: input.accountId, connectionId: input.connectionId,
    attempts: 1, nextAttemptAt: input.timestamp + 60000,
    lastErrorCode: "unavailable", timestamp: input.timestamp + 3
  }), error => error.code === "failed-precondition");
  const stored = docs.get("accounts/synthetic-account/mailboxCredentialCleanup/synthetic-connection");
  assert.equal(stored.alertStatus, "delivered");
  assert.equal(stored.alertAttempts, 0);
  assert.equal(stored.alertNextAttemptAt, null);
});

test("connection metadata rejects a credential reference scoped to another connection", async () => {
  const { db } = fakeFirestore();
  const adapters = createMailboxConnectionFirestoreAdapters(db);
  await assert.rejects(adapters.saveConnection({
    accountId: active.accountId, connectionId: active.connectionId,
    connection: { ...active, credentialSecretRef: secretRef(active.accountId, "other-connection") }
  }), error => error.code === "invalid-argument");
});

test("cleanup outbox rejects malformed and cross-connection credential references", async () => {
  const { db } = fakeFirestore();
  const adapters = createMailboxConnectionFirestoreAdapters(db);
  await assert.rejects(adapters.recordSecretCleanup({
    accountId: active.accountId, connectionId: active.connectionId,
    secretRef: secretRef(active.accountId, "other-connection"),
    reason: "connection_revoked", timestamp: active.createdAt + 1
  }), error => error.code === "invalid-argument");
  await assert.rejects(adapters.recordSecretCleanup({
    accountId: active.accountId, connectionId: active.connectionId,
    secretRef: "not-a-secret-ref", reason: "connection_revoked",
    timestamp: active.createdAt + 1
  }), error => error.code === "invalid-argument");
});


test("cleanup completion rejects a ticket whose credential reference escaped its connection scope", async () => {
  const { db, docs } = fakeFirestore();
  const adapters = createMailboxConnectionFirestoreAdapters(db);
  const input = {
    accountId: active.accountId, connectionId: active.connectionId,
    secretRef: active.credentialSecretRef, reason: "connection_revoked",
    timestamp: active.createdAt + 1
  };
  await adapters.recordSecretCleanup(input);
  const path = "accounts/synthetic-account/mailboxCredentialCleanup/synthetic-connection";
  docs.set(path, {
    ...docs.get(path),
    secretRef: secretRef(input.accountId, "another-connection")
  });
  await assert.rejects(adapters.completeSecretCleanup({
    accountId: input.accountId, connectionId: input.connectionId,
    timestamp: input.timestamp + 1
  }), error => error.code === "failed-precondition");
  assert.equal(docs.get(path).status, "pending");
});


test("cleanup retry schedule must match whether the retry ceiling is exhausted", async () => {
  const { db, docs } = fakeFirestore();
  const adapters = createMailboxConnectionFirestoreAdapters(db);
  const input = {
    accountId: active.accountId, connectionId: active.connectionId,
    secretRef: active.credentialSecretRef, reason: "connection_revoked",
    timestamp: active.createdAt + 1
  };
  await adapters.recordSecretCleanup(input);
  const path = "accounts/" + input.accountId + "/mailboxCredentialCleanup/" + input.connectionId;
  await assert.rejects(adapters.recordSecretCleanupFailure({
    accountId: input.accountId, connectionId: input.connectionId, secretRef: input.secretRef,
    attempts: 2, nextAttemptAt: null, lastErrorCode: "unavailable", timestamp: input.timestamp + 1
  }), error => error.code === "invalid-argument");
  await assert.rejects(adapters.recordSecretCleanupFailure({
    accountId: input.accountId, connectionId: input.connectionId, secretRef: input.secretRef,
    attempts: 12, nextAttemptAt: input.timestamp + 60000,
    lastErrorCode: "unavailable", timestamp: input.timestamp + 1
  }), error => error.code === "invalid-argument");
  assert.equal(docs.get(path).status, "pending");
  assert.equal(docs.get(path).attempts, 1);
});


test("pending cleanup alert retries require a valid scheduled timestamp", async () => {
  const { db, docs } = fakeFirestore();
  const adapters = createMailboxConnectionFirestoreAdapters(db);
  const input = {
    accountId: active.accountId, connectionId: active.connectionId,
    secretRef: active.credentialSecretRef, reason: "connection_revoked",
    timestamp: active.createdAt + 1
  };
  await adapters.recordSecretCleanup(input);
  await exhaustCleanup(adapters, input);
  const path = "accounts/" + input.accountId + "/mailboxCredentialCleanup/" + input.connectionId;
  for (const nextAttemptAt of [null, input.timestamp, input.timestamp - 1]) {
    await assert.rejects(adapters.recordCleanupAlertFailure({
      accountId: input.accountId, connectionId: input.connectionId,
      attempts: 1, nextAttemptAt, lastErrorCode: "unavailable", timestamp: input.timestamp + 2
    }), error => error.code === "invalid-argument");
  }
  assert.equal(docs.get(path).alertAttempts, 0);
  assert.equal(docs.get(path).alertStatus, "pending");
});


test("cleanup alert transitions reject malformed persisted retry metadata", async () => {
  const { db, docs } = fakeFirestore();
  const adapters = createMailboxConnectionFirestoreAdapters(db);
  const input = {
    accountId: active.accountId, connectionId: active.connectionId,
    secretRef: active.credentialSecretRef, reason: "connection_revoked",
    timestamp: active.createdAt + 1
  };
  await adapters.recordSecretCleanup(input);
  await exhaustCleanup(adapters, input);
  const path = "accounts/" + input.accountId + "/mailboxCredentialCleanup/" + input.connectionId;
  const original = docs.get(path);
  for (const malformed of [
    { attempts: 11 },
    { lastErrorCode: "INVALID CODE" },
    { createdAt: 0 },
    { alertAttempts: "0" },
    { alertAttempts: -1 },
    { alertNextAttemptAt: -1 },
    { alertLastErrorCode: "INVALID CODE" },
    { alertAttempts: 1 },
    { alertNextAttemptAt: input.timestamp + 5000 },
    { alertAttempts: 1, alertNextAttemptAt: input.timestamp + 5000 },
    { alertAttempts: 1, alertNextAttemptAt: input.timestamp + 5000, alertLastErrorCode: null },
    { alertAttempts: 1, alertNextAttemptAt: input.timestamp, alertLastErrorCode: "unavailable" },
    { alertAttempts: 1, alertNextAttemptAt: input.timestamp + 5000, alertLastErrorCode: "unavailable", updatedAt: "invalid" },
    { alertAttempts: 1, alertNextAttemptAt: input.timestamp + 5000, alertLastErrorCode: "unavailable", updatedAt: input.timestamp + 6000 },
    { alertDeliveredAt: input.timestamp + 1 },
    { alertResolvedAt: input.timestamp + 1 }
  ]) {
    docs.set(path, { ...original, ...malformed });
    await assert.rejects(adapters.recordCleanupAlertFailure({
      accountId: input.accountId, connectionId: input.connectionId,
      attempts: 1, nextAttemptAt: input.timestamp + 60000,
      lastErrorCode: "unavailable", timestamp: input.timestamp + 2
    }), error => error.code === "failed-precondition");
    await assert.rejects(adapters.markCleanupAlertDelivered({
      accountId: input.accountId, connectionId: input.connectionId,
      timestamp: input.timestamp + 2
    }), error => error.code === "failed-precondition");
  }
  assert.equal(docs.get(path).alertStatus, "pending");
});


test("resolved cleanup alert terminal metadata is validated on reads and repeat completion", async () => {
  const { db, docs } = fakeFirestore();
  const adapters = createMailboxConnectionFirestoreAdapters(db);
  const input = {
    accountId: active.accountId, connectionId: active.connectionId,
    secretRef: active.credentialSecretRef, reason: "connection_revoked",
    timestamp: active.createdAt + 1
  };
  await adapters.recordSecretCleanup(input);
  await exhaustCleanup(adapters, input);
  const path = "accounts/synthetic-account/mailboxCredentialCleanup/synthetic-connection";
  await adapters.completeSecretCleanup({
    accountId: input.accountId, connectionId: input.connectionId,
    timestamp: input.timestamp + 2
  });
  const stored = docs.get(path);
  stored.alertDeliveredAt = stored.alertResolvedAt + 1;
  assert.equal(await adapters.loadSecretCleanup({
    accountId: input.accountId, connectionId: input.connectionId
  }), null, "contradictory terminal timestamps are not readable");
  await assert.rejects(adapters.completeSecretCleanup({
    accountId: input.accountId, connectionId: input.connectionId,
    timestamp: input.timestamp + 3
  }), error => error.code === "failed-precondition");
  assert.equal(stored.alertStatus, "resolved", "corrupt terminal record remains unchanged");
});


test("completion rejects stray alert metadata on a pending cleanup ticket", async () => {
  const { db, docs } = fakeFirestore();
  const adapters = createMailboxConnectionFirestoreAdapters(db);
  const input = {
    accountId: active.accountId, connectionId: active.connectionId,
    secretRef: active.credentialSecretRef, reason: "connection_revoked",
    timestamp: active.createdAt + 1
  };
  await adapters.recordSecretCleanup(input);
  const path = "accounts/" + input.accountId + "/mailboxCredentialCleanup/" + input.connectionId;
  const original = docs.get(path);
  for (const malformed of [
    { alertAttempts: 1 },
    { alertNextAttemptAt: input.timestamp + 1000 },
    { alertLastErrorCode: "unavailable" },
    { alertDeliveredAt: input.timestamp + 1 },
    { alertResolvedAt: input.timestamp + 1 },
    { alertStatus: "pending" }
  ]) {
    docs.set(path, { ...original, ...malformed });
    await assert.rejects(adapters.completeSecretCleanup({
      accountId: input.accountId, connectionId: input.connectionId,
      timestamp: input.timestamp + 2
    }), error => error.code === "failed-precondition");
    assert.equal(docs.get(path).status, "pending");
  }
  docs.set(path, original);
  await adapters.completeSecretCleanup({
    accountId: input.accountId, connectionId: input.connectionId,
    timestamp: input.timestamp + 2
  });
  assert.equal(docs.get(path).status, "complete");
});


test("completed cleanup reads reject malformed completion and retry history", async () => {
  const { db, docs } = fakeFirestore();
  const adapters = createMailboxConnectionFirestoreAdapters(db);
  const input = {
    accountId: active.accountId, connectionId: active.connectionId,
    secretRef: active.credentialSecretRef, reason: "connection_revoked",
    timestamp: active.createdAt + 1
  };
  await adapters.recordSecretCleanup(input);
  await adapters.completeSecretCleanup({
    accountId: input.accountId, connectionId: input.connectionId,
    timestamp: input.timestamp + 1
  });
  const path = "accounts/" + input.accountId + "/mailboxCredentialCleanup/" + input.connectionId;
  const stored = docs.get(path);
  for (const malformed of [
    { completedAt: 0 },
    { completedAt: stored.updatedAt + 1 },
    { updatedAt: stored.completedAt - 1 },
    { nextAttemptAt: stored.updatedAt + 1000 },
    { alertAttempts: 1 },
    { alertResolvedAt: stored.updatedAt + 1 }
  ]) {
    docs.set(path, { ...stored, ...malformed });
    assert.equal(await adapters.loadSecretCleanup({
      accountId: input.accountId, connectionId: input.connectionId
    }), null);
  }
  docs.set(path, stored);
  assert.equal((await adapters.loadSecretCleanup({
    accountId: input.accountId, connectionId: input.connectionId
  })).status, "complete");
});

test("completed cleanup clears obsolete retry schedule but retains validated retry history", async () => {
  const { db, docs } = fakeFirestore();
  const adapters = createMailboxConnectionFirestoreAdapters(db);
  const input = {
    accountId: active.accountId, connectionId: active.connectionId,
    secretRef: active.credentialSecretRef, reason: "connection_revoked",
    timestamp: active.createdAt + 1
  };
  await adapters.recordSecretCleanup(input);
  await adapters.recordSecretCleanupFailure({
    accountId: input.accountId, connectionId: input.connectionId, secretRef: input.secretRef,
    attempts: 2, nextAttemptAt: input.timestamp + 60000,
    lastErrorCode: "unavailable", timestamp: input.timestamp + 1
  });
  const path = "accounts/" + input.accountId + "/mailboxCredentialCleanup/" + input.connectionId;
  await adapters.completeSecretCleanup({
    accountId: input.accountId, connectionId: input.connectionId,
    timestamp: input.timestamp + 60000
  });
  const stored = docs.get(path);
  assert.equal(stored.status, "complete");
  assert.equal(stored.nextAttemptAt, null);
  assert.equal(stored.lastErrorCode, "unavailable");
  assert.equal((await adapters.loadSecretCleanup({
    accountId: input.accountId, connectionId: input.connectionId
  })).status, "complete");
  await adapters.completeSecretCleanup({
    accountId: input.accountId, connectionId: input.connectionId,
    timestamp: input.timestamp + 60001
  });
  docs.set(path, { ...stored, lastErrorCode: "INVALID CODE" });
  assert.equal(await adapters.loadSecretCleanup({
    accountId: input.accountId, connectionId: input.connectionId
  }), null);
});

test("exhausted cleanup terminal timestamps cannot postdate the ticket update clock", async () => {
  const { db, docs } = fakeFirestore();
  const adapters = createMailboxConnectionFirestoreAdapters(db);
  const input = {
    accountId: active.accountId, connectionId: active.connectionId,
    secretRef: active.credentialSecretRef, reason: "connection_revoked",
    timestamp: active.createdAt + 1
  };
  await adapters.recordSecretCleanup(input);
  await exhaustCleanup(adapters, input);
  const path = "accounts/" + input.accountId + "/mailboxCredentialCleanup/" + input.connectionId;
  const exhausted = docs.get(path);
  exhausted.alertStatus = "delivered";
  exhausted.alertDeliveredAt = exhausted.updatedAt + 1;
  assert.equal(await adapters.loadSecretCleanup({
    accountId: input.accountId, connectionId: input.connectionId
  }), null);
  await assert.rejects(adapters.markCleanupAlertDelivered({
    accountId: input.accountId, connectionId: input.connectionId,
    timestamp: input.timestamp + 2
  }), error => error.code === "failed-precondition");
  await assert.rejects(adapters.completeSecretCleanup({
    accountId: input.accountId, connectionId: input.connectionId,
    timestamp: input.timestamp + 2
  }), error => error.code === "failed-precondition");

  exhausted.alertStatus = "pending";
  exhausted.alertAttempts = 0;
  exhausted.alertNextAttemptAt = null;
  exhausted.alertLastErrorCode = null;
  exhausted.alertDeliveredAt = null;
  await adapters.completeSecretCleanup({
    accountId: input.accountId, connectionId: input.connectionId,
    timestamp: input.timestamp + 3
  });
  const completed = docs.get(path);
  completed.alertResolvedAt = completed.updatedAt + 1;
  assert.equal(await adapters.loadSecretCleanup({
    accountId: input.accountId, connectionId: input.connectionId
  }), null);
  await assert.rejects(adapters.completeSecretCleanup({
    accountId: input.accountId, connectionId: input.connectionId,
    timestamp: input.timestamp + 4
  }), error => error.code === "failed-precondition");
});

test("repeat completion rejects corrupt resolved alert retry history", async () => {
  const { db, docs } = fakeFirestore();
  const adapters = createMailboxConnectionFirestoreAdapters(db);
  const input = {
    accountId: active.accountId, connectionId: active.connectionId,
    secretRef: active.credentialSecretRef, reason: "connection_revoked",
    timestamp: active.createdAt + 1
  };
  await adapters.recordSecretCleanup(input);
  await exhaustCleanup(adapters, input);
  await adapters.completeSecretCleanup({
    accountId: input.accountId, connectionId: input.connectionId,
    timestamp: input.timestamp + 2
  });
  const path = "accounts/" + input.accountId + "/mailboxCredentialCleanup/" + input.connectionId;
  const stored = docs.get(path);
  assert.equal((await adapters.loadSecretCleanup({
    accountId: input.accountId, connectionId: input.connectionId
  })).status, "complete");
  stored.alertAttempts = 2;
  stored.alertLastErrorCode = null;
  await assert.rejects(adapters.completeSecretCleanup({
    accountId: input.accountId, connectionId: input.connectionId,
    timestamp: input.timestamp + 3
  }), error => error.code === "failed-precondition");
  assert.equal(stored.status, "complete");
  assert.equal(stored.alertStatus, "resolved");
});


test("repeat completion rejects stray alert metadata when no alert status exists", async () => {
  const { db, docs } = fakeFirestore();
  const adapters = createMailboxConnectionFirestoreAdapters(db);
  const input = {
    accountId: active.accountId, connectionId: active.connectionId,
    secretRef: active.credentialSecretRef, reason: "connection_revoked",
    timestamp: active.createdAt + 1
  };
  await adapters.recordSecretCleanup(input);
  await adapters.completeSecretCleanup({
    accountId: input.accountId, connectionId: input.connectionId,
    timestamp: input.timestamp + 1
  });
  const path = "accounts/" + input.accountId + "/mailboxCredentialCleanup/" + input.connectionId;
  const stored = docs.get(path);
  stored.alertResolvedAt = input.timestamp + 2;
  await assert.rejects(adapters.completeSecretCleanup({
    accountId: input.accountId, connectionId: input.connectionId,
    timestamp: input.timestamp + 3
  }), error => error.code === "failed-precondition");
  assert.equal(stored.status, "complete");
  assert.equal(stored.alertStatus, null);
});


test("repeated alert delivery rejects contradictory resolved timestamp", async () => {
  const { db, docs } = fakeFirestore();
  const adapters = createMailboxConnectionFirestoreAdapters(db);
  const input = {
    accountId: active.accountId, connectionId: active.connectionId,
    secretRef: active.credentialSecretRef, reason: "connection_revoked",
    timestamp: active.createdAt + 1
  };
  await adapters.recordSecretCleanup(input);
  await exhaustCleanup(adapters, input);
  await adapters.markCleanupAlertDelivered({
    accountId: input.accountId, connectionId: input.connectionId,
    timestamp: input.timestamp + 2
  });
  const path = "accounts/" + input.accountId + "/mailboxCredentialCleanup/" + input.connectionId;
  const stored = docs.get(path);
  stored.alertResolvedAt = input.timestamp + 3;
  await assert.rejects(adapters.markCleanupAlertDelivered({
    accountId: input.accountId, connectionId: input.connectionId,
    timestamp: input.timestamp + 4
  }), error => error.code === "failed-precondition");
  assert.equal(stored.alertStatus, "delivered");
  assert.equal(stored.alertResolvedAt, input.timestamp + 3);
});


test("cleanup ticket reason is immutable across idempotent enqueue and validated at every read boundary", async () => {
  const { db, docs } = fakeFirestore();
  const adapters = createMailboxConnectionFirestoreAdapters(db);
  const input = {
    accountId: active.accountId, connectionId: active.connectionId,
    secretRef: active.credentialSecretRef, reason: "connection_revoked",
    timestamp: active.createdAt + 1
  };
  await adapters.recordSecretCleanup(input);
  await assert.rejects(adapters.recordSecretCleanup({ ...input, reason: "setup_failed" }),
    error => error.code === "failed-precondition");
  const path = "accounts/" + input.accountId + "/mailboxCredentialCleanup/" + input.connectionId;
  assert.equal(docs.get(path).reason, "connection_revoked");

  docs.set(path, { ...docs.get(path), reason: "INVALID REASON" });
  assert.equal(await adapters.loadSecretCleanup({
    accountId: input.accountId, connectionId: input.connectionId
  }), null);
  assert.deepEqual(await adapters.listPendingSecretCleanup({ accountId: input.accountId }), []);
  await assert.rejects(adapters.recordSecretCleanupFailure({
    accountId: input.accountId, connectionId: input.connectionId,
    secretRef: input.secretRef, attempts: 2, nextAttemptAt: input.timestamp + 1000,
    lastErrorCode: "unavailable", timestamp: input.timestamp + 1
  }), error => error.code === "failed-precondition");
  await assert.rejects(adapters.completeSecretCleanup({
    accountId: input.accountId, connectionId: input.connectionId,
    timestamp: input.timestamp + 2
  }), error => error.code === "failed-precondition");
  assert.equal(docs.get(path).status, "pending");
});


test("exhausted cleanup alert query and acknowledgement reject malformed ticket reason", async () => {
  const { db, docs } = fakeFirestore();
  const adapters = createMailboxConnectionFirestoreAdapters(db);
  const input = {
    accountId: active.accountId, connectionId: active.connectionId,
    secretRef: active.credentialSecretRef, reason: "connection_revoked",
    timestamp: active.createdAt + 1
  };
  await adapters.recordSecretCleanup(input);
  await exhaustCleanup(adapters, input);
  const path = "accounts/" + input.accountId + "/mailboxCredentialCleanup/" + input.connectionId;
  docs.set(path, { ...docs.get(path), reason: "BAD REASON" });
  assert.deepEqual(await adapters.listPendingCleanupAlerts({ accountId: input.accountId }), []);
  await assert.rejects(adapters.markCleanupAlertDelivered({
    accountId: input.accountId, connectionId: input.connectionId,
    timestamp: input.timestamp + 2
  }), error => error.code === "failed-precondition");
});
