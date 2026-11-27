import test from "node:test";
import assert from "node:assert/strict";
import { createMailboxConnectionFirestoreAdapters } from "../src/membership/mailbox-connection-firestore-adapters.js";

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
  await adapters.recordSecretCleanupFailure({
    accountId: input.accountId, connectionId: input.connectionId,
    secretRef: input.secretRef, attempts: 12, nextAttemptAt: null,
    lastErrorCode: "unavailable", timestamp: input.timestamp + 1
  });
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

test("cleanup retry ceiling moves tickets out of the pending queue", async () => {
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
    attempts: 12, nextAttemptAt: null, lastErrorCode: "unavailable",
    timestamp: input.timestamp + 1
  });
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
      secretRef: "vault://synthetic/" + i, reason: "connection_revoked",
      timestamp: active.createdAt + i
    });
    await adapters.recordSecretCleanupFailure({
      accountId: active.accountId, connectionId, secretRef: "vault://synthetic/" + i,
      attempts: 2, nextAttemptAt: 900000 + i, lastErrorCode: "unavailable",
      timestamp: 800000 + i
    });
  }
  await adapters.recordSecretCleanup({
    accountId: active.accountId, connectionId: "new-due",
    secretRef: "vault://synthetic/new", reason: "connection_revoked",
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
  await adapters.recordSecretCleanupFailure({
    accountId: input.accountId, connectionId: input.connectionId, secretRef: input.secretRef,
    attempts: 12, nextAttemptAt: null, lastErrorCode: "unavailable",
    timestamp: input.timestamp + 1
  });
  const queued = await adapters.listPendingCleanupAlerts({ accountId: input.accountId });
  assert.equal(queued.length, 1);
  assert.equal(queued[0].alertStatus, "pending");
  assert.equal(queued[0].connectionId, input.connectionId);
  assert.equal(queued[0].alertAttempts, 0);
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
  await adapters.recordSecretCleanupFailure({
    accountId: input.accountId, connectionId: input.connectionId, secretRef: input.secretRef,
    attempts: 12, nextAttemptAt: null, lastErrorCode: "unavailable",
    timestamp: input.timestamp + 1
  });
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
  await adapters.recordSecretCleanupFailure({
    accountId: input.accountId, connectionId: input.connectionId, secretRef: input.secretRef,
    attempts: 12, nextAttemptAt: null, lastErrorCode: "unavailable",
    timestamp: input.timestamp + 1
  });
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
  await adapters.recordSecretCleanupFailure({
    accountId: input.accountId, connectionId: input.connectionId, secretRef: input.secretRef,
    attempts: 12, nextAttemptAt: null, lastErrorCode: "unavailable",
    timestamp: input.timestamp + 1
  });
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
  await adapters.recordSecretCleanupFailure({
    accountId: input.accountId, connectionId: input.connectionId,
    secretRef: input.secretRef, attempts: 12, nextAttemptAt: null,
    lastErrorCode: "unavailable", timestamp: input.timestamp + 1
  });
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
