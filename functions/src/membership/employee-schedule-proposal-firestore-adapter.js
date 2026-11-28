import { createHash } from "node:crypto";

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const HASH = /^[a-f0-9]{64}$/;
const TERMINAL = new Set(["quarantined", "needs_review", "partially_processed", "proposals_created", "unchanged", "failed"]);
const SHIFT_FIELDS = new Set(["date", "type", "post", "start_time", "end_time", "hours", "is_night", "is_sunday", "is_piantonato", "is_rest_not_enjoyed", "has_meal_voucher"]);

function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}
function same(a, b) { return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b)); }
function validateChanges(changes, before) {
  if (!Array.isArray(changes) || changes.length < 1 || changes.length > 30 ||
      !Array.isArray(before) || before.length !== changes.length) {
    fail("invalid-argument", "Proposal changes and before snapshots are invalid.");
  }
  for (const change of changes) {
    if (!change || typeof change !== "object" || Array.isArray(change) ||
        !["create", "update", "delete"].includes(change.operation)) fail("invalid-argument", "Invalid proposal operation.");
    if (change.operation === "create") {
      if (!change.shift || typeof change.shift !== "object" || Array.isArray(change.shift) ||
          Object.keys(change.shift).some(key => !SHIFT_FIELDS.has(key)) ||
          typeof change.shift.date !== "string" || !/^\\d{4}-\\d{2}-\\d{2}$/.test(change.shift.date) ||
          typeof change.shift.type !== "string") fail("invalid-argument", "Invalid proposed shift.");
    } else if (typeof change.shiftId !== "string" || !ID.test(change.shiftId) ||
      !Number.isSafeInteger(change.expectedRevision) || change.expectedRevision < 1 ||
      (change.operation === "update" && (!change.changes || typeof change.changes !== "object" || Array.isArray(change.changes) ||
        Object.keys(change.changes).length < 1 || Object.keys(change.changes).some(key => !SHIFT_FIELDS.has(key) || key === "date"))) ||
      (change.operation === "delete" && Object.hasOwn(change, "changes"))) {
      fail("invalid-argument", "Invalid proposed shift target.");
    }
  }
}

export function createEmployeeScheduleProposalFirestoreAdapter({
  db, authorizeEmployee, now = () => Date.now(),
  jobRefForKey = ({ accountId, jobId }) => db.doc(`accounts/${accountId}/scheduleIngestionJobs/${jobId}`),
  proposalRefForKey = ({ accountId, proposalKey }) => db.doc(`accounts/${accountId}/employeeShiftProposals/${proposalKey}`)
}) {
  if (!db || typeof db.runTransaction !== "function" || typeof authorizeEmployee !== "function" ||
      typeof now !== "function" || typeof jobRefForKey !== "function" || typeof proposalRefForKey !== "function") {
    throw new TypeError("Firestore, canonical employee authorization and reference factories are required.");
  }

  return Object.freeze({
    async createEmployeeProposal(input) {
      if (!ID.test(input?.accountId ?? "") || !ID.test(input?.employeeId ?? "") ||
          !ID.test(input?.employeeUid ?? "") || !ID.test(input?.ingestionJobId ?? "") ||
          !/^[a-f0-9]{32,128}$/.test(input?.ingestionLeaseToken ?? "") ||
          !Number.isSafeInteger(input?.ingestionFencingToken) || input.ingestionFencingToken < 1 ||
          !HASH.test(input?.attachmentSha256 ?? "") ||
          input?.source !== "employer_email" || input?.sourceVerified !== true ||
          input?.proposerUid !== input.employeeUid ||
          !Number.isSafeInteger(input?.receivedAt) || input.receivedAt < 1 ||
          typeof input?.sender !== "string" || input.sender.length > 254 ||
          !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(input.sender) ||
          input.idempotencyKey !== input.ingestionJobId + "_" + input.employeeId) {
        fail("invalid-argument", "Verified employer proposal identity is invalid.");
      }
      validateChanges(input.changes, input.before);
      const proposalKey = createHash("sha256").update(input.idempotencyKey).digest("hex");
      const jobRef = jobRefForKey({ accountId: input.accountId, jobId: input.ingestionJobId });
      const proposalRef = proposalRefForKey({ accountId: input.accountId, proposalKey });
      const timestamp = now();
      if (!Number.isSafeInteger(timestamp) || timestamp < 1) fail("unavailable", "Proposal adapter clock is invalid.");

      return db.runTransaction(async tx => {
        const [jobSnap, proposalSnap, accountSnap] = await Promise.all([
          tx.get(jobRef), tx.get(proposalRef), tx.get(db.doc(`accounts/${input.accountId}`))
        ]);
        if (!jobSnap?.exists) fail("failed-precondition", "Current ingestion job is unavailable.");
        const job = jobSnap.data();
        if (!job || job.accountId !== input.accountId || job.jobId !== input.ingestionJobId || job.idempotencyKey !== input.ingestionJobId ||
            job.attachmentSha256 !== input.attachmentSha256 ||
            job.status !== "processing" || job.leaseToken !== input.ingestionLeaseToken ||
            job.fencingToken !== input.ingestionFencingToken ||
            !Number.isSafeInteger(job.leaseExpiresAt) || job.leaseExpiresAt <= timestamp) {
          fail("failed-precondition", "Stale or expired ingestion worker cannot create proposals.");
        }
        if (!accountSnap?.exists || accountSnap.data().status !== "active") {
          fail("failed-precondition", "Active account required.");
        }
        const employee = await authorizeEmployee(tx, {
          accountId: input.accountId, employeeId: input.employeeId, employeeUid: input.employeeUid
        });
        if (!employee || employee.accountId !== input.accountId ||
            employee.employeeId !== input.employeeId || employee.uid !== input.employeeUid ||
            employee.status !== "active") fail("permission-denied", "Canonical Employee binding is not active.");

        const immutable = {
          proposalId: proposalKey, idempotencyKey: input.idempotencyKey,
          accountId: input.accountId, employeeId: input.employeeId, proposerUid: input.proposerUid,
          source: "employer_email", sourceVerified: true, ingestionJobId: input.ingestionJobId,
          attachmentSha256: input.attachmentSha256, receivedAt: input.receivedAt,
          sender: input.sender, changes: input.changes, before: input.before
        };
        if (proposalSnap?.exists) {
          const existing = proposalSnap.data();
          const keys = Object.keys(immutable);
          if (!existing || keys.some(key => !same(existing[key], immutable[key])) ||
              !["pending", "approved", "rejected", "superseded"].includes(existing.status)) {
            fail("failed-precondition", "Existing idempotent proposal conflicts with this ingestion.");
          }
          return Object.freeze({ proposalId: proposalSnap.id, status: existing.status, duplicate: true });
        }
        tx.create(proposalRef, {
          ...immutable, status: "pending", createdAt: timestamp, updatedAt: timestamp, schemaVersion: 1
        });
        return Object.freeze({ proposalId: proposalKey, status: "pending", duplicate: false });
      });
    }
  });
}
