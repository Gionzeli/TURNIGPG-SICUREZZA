import { randomBytes } from "node:crypto";

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const HASH = /^[a-f0-9]{64}$/;
const TERMINAL = new Set(["quarantined", "needs_review", "partially_processed", "proposals_created", "unchanged", "failed"]);

function fail(code, message) { const error = new Error(message); error.code = code; throw error; }

/**
 * Durable Firestore claim/lease adapter for one PDF attachment job.
 * A live processing lease and a completed job are duplicates; an expired
 * processing lease may be reclaimed with a higher fencing token.
 */
export function createEmployeeScheduleIngestionJobFirestoreAdapter({
  db, now = () => Date.now(), leaseMs = 120_000,
  jobRefForKey = ({ accountId, idempotencyKey }) =>
    db.doc(`accounts/${accountId}/scheduleIngestionJobs/${idempotencyKey}`),
  createLeaseToken = () => randomBytes(32).toString("hex")
}) {
  if (!db || typeof db.runTransaction !== "function" ||
      typeof jobRefForKey !== "function" || typeof createLeaseToken !== "function") {
    throw new TypeError("Firestore ingestion job dependencies are required.");
  }
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 10_000 || leaseMs > 15 * 60_000) {
    throw new TypeError("Ingestion job lease duration is invalid.");
  }
  function clock() {
    const value = now();
    if (!Number.isSafeInteger(value) || value < 1) fail("unavailable", "Ingestion job clock is invalid.");
    return value;
  }
  function validateScope(input) {
    if (!ID.test(input?.accountId ?? "") || !ID.test(input?.connectionId ?? "") ||
        !HASH.test(input?.idempotencyKey ?? "") || !HASH.test(input?.attachmentSha256 ?? "") ||
        typeof input.provider !== "string" || !["imap", "gmail_api", "microsoft_graph", "custom_api"].includes(input.provider) ||
        typeof input.messageId !== "string" || !input.messageId.trim() || input.messageId.length > 255) {
      fail("invalid-argument", "Ingestion job identity is invalid.");
    }
  }
  return Object.freeze({
    async claimIngestionJob(input) {
      validateScope(input);
      const ref = jobRefForKey({ accountId: input.accountId, idempotencyKey: input.idempotencyKey });
      const timestamp = clock();
      if (!Number.isSafeInteger(timestamp + leaseMs)) fail("unavailable", "Ingestion job lease expiry is outside the safe clock range.");
      const leaseToken = createLeaseToken();
      if (typeof leaseToken !== "string" || !/^[a-f0-9]{32,128}$/.test(leaseToken)) {
        fail("unavailable", "Ingestion job lease token is invalid.");
      }
      return db.runTransaction(async tx => {
        const snapshot = await tx.get(ref);
        const current = snapshot?.exists ? snapshot.data() : null;
        if (!current) {
          const job = {
            jobId: input.idempotencyKey, idempotencyKey: input.idempotencyKey,
            accountId: input.accountId, connectionId: input.connectionId,
            provider: input.provider, messageId: input.messageId,
            attachmentSha256: input.attachmentSha256, status: "processing",
            attempt: 1, fencingToken: 1, leaseToken,
            leaseExpiresAt: timestamp + leaseMs, createdAt: timestamp, updatedAt: timestamp
          };
          tx.create(ref, job);
          return Object.freeze({ jobId: job.jobId, duplicate: false, leaseToken, fencingToken: 1 });
        }
        if (current.accountId !== input.accountId || current.connectionId !== input.connectionId ||
            current.provider !== input.provider || current.messageId !== input.messageId ||
            current.attachmentSha256 !== input.attachmentSha256 ||
            current.idempotencyKey !== input.idempotencyKey ||
            current.jobId !== input.idempotencyKey ||
            !Number.isSafeInteger(current.fencingToken) || current.fencingToken < 1 ||
            !Number.isSafeInteger(current.attempt) || current.attempt < 1 ||
            !Number.isSafeInteger(current.updatedAt) || current.updatedAt < 1) {
          fail("failed-precondition", "Existing ingestion job identity is malformed.");
        }
        if (TERMINAL.has(current.status)) {
          return Object.freeze({ jobId: current.jobId, duplicate: true });
        }
        if (current.status !== "processing" || typeof current.leaseToken !== "string" ||
            !/^[a-f0-9]{32,128}$/.test(current.leaseToken) ||
            !Number.isSafeInteger(current.leaseExpiresAt) || current.leaseExpiresAt < 1) {
          fail("failed-precondition", "Existing ingestion job state is malformed.");
        }
        if (current.leaseExpiresAt > timestamp) {
          return Object.freeze({ jobId: current.jobId, duplicate: true });
        }
        if (current.fencingToken >= Number.MAX_SAFE_INTEGER || current.attempt >= Number.MAX_SAFE_INTEGER ||
            !Number.isSafeInteger(timestamp + leaseMs)) {
          fail("failed-precondition", "Ingestion job retry limit was reached.");
        }
        const nextFence = current.fencingToken + 1;
        tx.update(ref, {
          status: "processing", attempt: current.attempt + 1,
          fencingToken: nextFence, leaseToken, leaseExpiresAt: timestamp + leaseMs,
          updatedAt: timestamp
        });
        return Object.freeze({ jobId: current.jobId, duplicate: false, leaseToken, fencingToken: nextFence });
      });
    },
    async finishIngestionJob(input) {
      if (!ID.test(input?.accountId ?? "") || !ID.test(input?.jobId ?? "") ||
          !/^[a-f0-9]{32,128}$/.test(input?.leaseToken ?? "") ||
          !TERMINAL.has(input?.status)) fail("invalid-argument", "Ingestion job completion is invalid.");
      const ref = jobRefForKey({ accountId: input.accountId, idempotencyKey: input.jobId });
      const timestamp = clock();
      return db.runTransaction(async tx => {
        const snapshot = await tx.get(ref);
        if (!snapshot?.exists) fail("not-found", "Ingestion job does not exist.");
        const current = snapshot.data();
        if (!current || current.accountId !== input.accountId || current.jobId !== input.jobId) {
          fail("failed-precondition", "Ingestion job identity does not match.");
        }
        if (TERMINAL.has(current.status)) {
          if (current.status !== input.status) fail("failed-precondition", "Ingestion job already has a different terminal result.");
          return Object.freeze({ status: current.status, duplicate: true });
        }
        if (current.leaseToken !== input.leaseToken) {
          fail("failed-precondition", "Stale ingestion worker cannot finish this job.");
        }
        if (current.status !== "processing" || !Number.isSafeInteger(current.leaseExpiresAt) ||
            current.leaseExpiresAt <= timestamp) fail("failed-precondition", "Ingestion job lease expired before completion.");
        const patch = {
          status: input.status, updatedAt: timestamp,
          leaseToken: null, leaseExpiresAt: null,
          reason: typeof input.reason === "string" ? input.reason.slice(0, 100) : null,
          proposalCount: Number.isSafeInteger(input.proposalCount) && input.proposalCount >= 0 ? input.proposalCount : 0,
          blockedCount: Number.isSafeInteger(input.blockedCount) && input.blockedCount >= 0 ? input.blockedCount : 0
        };
        tx.update(ref, patch);
        return Object.freeze({ status: input.status, duplicate: false });
      });
    }
  });
}
