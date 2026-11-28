import { createHash } from "node:crypto";

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const HASH = /^[a-f0-9]{64}$/;
const SHIFT_FIELDS = new Set(["date", "type", "post", "start_time", "end_time", "hours", "is_night", "is_sunday", "is_piantonato", "is_rest_not_enjoyed", "has_meal_voucher"]);

function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}
function same(a, b) { return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b)); }
const TYPES = new Set(["turno", "turno_riposo", "riposo", "riposo_compensativo", "ferie", "permesso", "malattia"]);
const FLAGS = ["is_night", "is_sunday", "is_piantonato", "is_rest_not_enjoyed", "has_meal_voucher"];
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + "T00:00:00Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function validateFields(fields, { allowDate, requireCompleteInterval = false }) {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) fail("invalid-argument", "Shift fields are invalid.");
  for (const [key, value] of Object.entries(fields)) {
    if (!SHIFT_FIELDS.has(key) || (!allowDate && key === "date")) fail("invalid-argument", "Unsupported shift field.");
    if (key === "date" && !validDate(value)) fail("invalid-argument", "Invalid shift date.");
    if (key === "type" && !TYPES.has(value)) fail("invalid-argument", "Invalid shift type.");
    if (key === "post" && (typeof value !== "string" || value.length > 80)) fail("invalid-argument", "Invalid shift post.");
    if (["start_time", "end_time"].includes(key) && (typeof value !== "string" || (value !== "" && !TIME.test(value)))) fail("invalid-argument", "Invalid shift time.");
    if (key === "hours" && (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 48)) fail("invalid-argument", "Invalid shift hours.");
    if (FLAGS.includes(key) && typeof value !== "boolean") fail("invalid-argument", "Invalid shift flag.");
  }
  if ((requireCompleteInterval && Object.hasOwn(fields, "start_time") !== Object.hasOwn(fields, "end_time")) ||
      (fields.start_time && fields.end_time && fields.start_time === fields.end_time)) fail("invalid-argument", "Invalid shift interval.");
}
function validateChanges(changes, before) {
  if (!Array.isArray(changes) || changes.length < 1 || changes.length > 30 ||
      !Array.isArray(before) || before.length !== changes.length) {
    fail("invalid-argument", "Proposal changes and before snapshots are invalid.");
  }
  const seen = new Set();
  for (const [index, change] of changes.entries()) {
    if (!change || typeof change !== "object" || Array.isArray(change) ||
        !["create", "update", "delete"].includes(change.operation)) fail("invalid-argument", "Invalid proposal operation.");
    if (change.operation === "create") {
      if (Object.keys(change).some(key => !["operation", "shift"].includes(key)) ||
          !change.shift || typeof change.shift !== "object" || Array.isArray(change.shift)) fail("invalid-argument", "Invalid proposed shift.");
      validateFields(change.shift, { allowDate: true, requireCompleteInterval: true });
      if (!validDate(change.shift.date) || !TYPES.has(change.shift.type)) fail("invalid-argument", "Create proposal requires a valid date and type.");
    } else if (Object.keys(change).some(key => !["operation", "shiftId", "expectedRevision", "changes"].includes(key)) ||
      typeof change.shiftId !== "string" || !ID.test(change.shiftId) || seen.has(change.shiftId) ||
      !Number.isSafeInteger(change.expectedRevision) || change.expectedRevision < 1 ||
      (change.operation === "update" && (!change.changes || typeof change.changes !== "object" || Array.isArray(change.changes) ||
        Object.keys(change.changes).length < 1)) ||
      (change.operation === "delete" && Object.hasOwn(change, "changes"))) {
      fail("invalid-argument", "Invalid proposed shift target.");
    }
    if (change.operation !== "create") seen.add(change.shiftId);
    const snapshot = before[index];
    if (change.operation === "create" && snapshot !== null) {
      fail("invalid-argument", "Create proposal must not include a before snapshot.");
    }
    if (change.operation === "update") {
      validateFields(change.changes, { allowDate: false });
    }
    if (change.operation === "update" || change.operation === "delete") {
      if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) ||
          !Number.isSafeInteger(snapshot.revision) || snapshot.revision !== change.expectedRevision ||
          !validDate(snapshot.date) || !TYPES.has(snapshot.type)) {
        fail("invalid-argument", "Existing shift before snapshot does not match the expected revision.");
      }
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
      const additionalInfo = input.additionalInfo ?? [];
      if (!Array.isArray(additionalInfo) || additionalInfo.length > 8 ||
          additionalInfo.some(item => typeof item !== "string" || item.length > 300 ||
            /[\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f\\x7f]/.test(item) || item !== item.trim()) ||
          additionalInfo.join("\\n").length > 1500 ||
          new Set(additionalInfo).size !== additionalInfo.length) {
        fail("invalid-argument", "Additional proposal information is invalid.");
      }
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
          sender: input.sender, changes: input.changes, before: input.before,
          additionalInfo
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
