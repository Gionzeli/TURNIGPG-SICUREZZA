import { createHash } from "node:crypto";

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const TYPES = new Set(["turno", "turno_riposo", "riposo", "riposo_compensativo", "ferie", "permesso", "malattia"]);
const SHIFT_FIELDS = new Set(["date", "type", "post", "start_time", "end_time", "hours", "is_night", "is_sunday", "is_piantonato", "is_rest_not_enjoyed", "has_meal_voucher"]);
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}
function validDate(value) {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function normalizedEmail(value) {
  if (typeof value !== "string" || value.length > 254) return null;
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}
function normalizeShift(input, { existing = false } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).some(key => !SHIFT_FIELDS.has(key))) fail("invalid-argument", "Unsupported parsed shift fields.");
  if (!validDate(input.date) || !TYPES.has(input.type)) fail("invalid-argument", "Parsed shift has an invalid date or type.");
  if (!existing && ["post", "start_time", "end_time", "hours"].some(key => !Object.hasOwn(input, key))) {
    fail("invalid-argument", "Parsed shift must explicitly include post, start/end times and hours.");
  }
  const post = input.post ?? "";
  const start_time = input.start_time ?? "";
  const end_time = input.end_time ?? "";
  const hours = input.hours ?? 0;
  if (typeof post !== "string" || post.length > 80 ||
      (start_time !== "" && (typeof start_time !== "string" || !TIME.test(start_time))) ||
      (end_time !== "" && (typeof end_time !== "string" || !TIME.test(end_time))) ||
      ((start_time === "") !== (end_time === "")) ||
      (start_time !== "" && start_time === end_time) ||
      typeof hours !== "number" || !Number.isFinite(hours) || hours < 0 || hours > 48) {
    fail("invalid-argument", "Parsed shift contains invalid post, time or hours.");
  }
  const result = { date: input.date, type: input.type, post, start_time, end_time, hours };
  for (const key of ["is_night", "is_sunday", "is_piantonato", "is_rest_not_enjoyed", "has_meal_voucher"]) {
    if (!existing && !Object.hasOwn(input, key)) continue;
    const value = input[key] ?? false;
    if (typeof value !== "boolean") fail("invalid-argument", "Parsed shift contains an invalid flag.");
    result[key] = value;
  }
  return result;
}
function shiftKey(shift) {
  return [shift.date, shift.post.toLowerCase(), shift.start_time, shift.end_time].join("|");
}
function sameShift(a, b) {
  return Object.keys(a).every(key => a[key] === b[key]);
}
function buildChanges(incoming, existing) {
  const existingRows = existing.map(row => ({ ...row }));
  const byExact = new Map();
  const byDatePost = new Map();
  for (const row of existingRows) {
    const exact = shiftKey(row);
    byExact.set(exact, [...(byExact.get(exact) ?? []), row]);
    const group = row.date + "|" + row.post.toLowerCase();
    byDatePost.set(group, [...(byDatePost.get(group) ?? []), row]);
  }
  const incomingGroups = new Map();
  for (const shift of incoming) {
    const group = shift.date + "|" + shift.post.toLowerCase();
    incomingGroups.set(group, (incomingGroups.get(group) ?? 0) + 1);
  }
  const used = new Set();
  const changes = [];
  const before = [];
  for (const shift of incoming) {
    const exactMatches = (byExact.get(shiftKey(shift)) ?? []).filter(row => !used.has(row.shiftId));
    if (exactMatches.length > 1) fail("failed-precondition", "Ambiguous duplicate existing shifts.");
    let match = exactMatches[0] ?? null;
    if (!match) {
      const group = shift.date + "|" + shift.post.toLowerCase();
      const candidates = (byDatePost.get(group) ?? []).filter(row => !used.has(row.shiftId));
      if (candidates.length > 1 || (candidates.length === 1 && incomingGroups.get(group) > 1)) {
        fail("failed-precondition", "Ambiguous shift match; manual review required.");
      }
      if (candidates.length === 1) match = candidates[0];
    }
    if (!match) {
      changes.push({ operation: "create", shift });
      before.push(null);
      continue;
    }
    used.add(match.shiftId);
    if (sameShift(shift, match)) continue;
    const fields = {};
    for (const key of Object.keys(shift)) {
      if (key === "date") continue;
      const oldValue = match[key] ?? (key === "post" ? "" : key === "hours" ? 0 : false);
      const newValue = shift[key] ?? (key === "post" ? "" : key === "hours" ? 0 : false);
      if (oldValue !== newValue) fields[key] = newValue;
    }
    if (Object.keys(fields).length) {
      changes.push({ operation: "update", shiftId: match.shiftId, expectedRevision: match.revision, changes: fields });
      before.push({ ...Object.fromEntries([...SHIFT_FIELDS].filter(key => Object.hasOwn(match, key)).map(key => [key, match[key]])), revision: match.revision });
    }
  }
  // Absence from a PDF is never interpreted as deletion: documents may be partial.
  return { changes, before };
}

/**
 * Provider-neutral ingestion boundary. All provider access, mailbox secrets,
 * canonical Employee lookup, durable idempotency and Firestore writes are
 * injected trusted-server dependencies. This module never updates live shifts.
 */
export function createEmployeeScheduleEmailIngestion({
  loadMailboxConnection,
  verifyMessage,
  scanAttachment,
  extractSchedule,
  resolveEmployee,
  loadEmployeeShifts,
  claimIngestionJob,
  createEmployeeProposal,
  finishIngestionJob,
  now = () => Date.now(),
  maxAttachmentBytes = MAX_ATTACHMENT_BYTES,
  minConfidence = 0.98
}) {
  for (const [name, fn] of Object.entries({
    loadMailboxConnection, verifyMessage, scanAttachment, extractSchedule,
    resolveEmployee, loadEmployeeShifts, claimIngestionJob,
    createEmployeeProposal, finishIngestionJob
  })) if (typeof fn !== "function") throw new TypeError(name + " dependency is required.");
  if (!Number.isSafeInteger(maxAttachmentBytes) || maxAttachmentBytes < 1024 ||
      !Number.isFinite(minConfidence) || minConfidence < 0.98 || minConfidence > 1) {
    throw new TypeError("Safe attachment and confidence limits are required.");
  }

  return Object.freeze({
    async ingest({ accountId, connectionId, message, attachments }) {
      if (!ID.test(accountId ?? "") || !ID.test(connectionId ?? "")) fail("invalid-argument", "Invalid account or mailbox connection.");
      if (!message || typeof message !== "object" || Array.isArray(message) ||
          typeof message.messageId !== "string" || !message.messageId.trim() || message.messageId.length > 255 ||
          !Array.isArray(attachments) || attachments.length < 1 || attachments.length > 10) {
        fail("invalid-argument", "Invalid normalized email message.");
      }
      const connection = await loadMailboxConnection({ accountId, connectionId });
      if (!connection || connection.accountId !== accountId || connection.connectionId !== connectionId ||
          connection.status !== "active" || typeof connection.provider !== "string" ||
          !["imap", "gmail_api", "microsoft_graph", "custom_api"].includes(connection.provider)) {
        fail("failed-precondition", "Mailbox connection is not active or supported.");
      }
      const sender = normalizedEmail(message.from);
      if (!sender || !Number.isSafeInteger(message.receivedAt) || message.receivedAt < 1) fail("invalid-argument", "Invalid sender or received timestamp.");
      const allowlist = Array.isArray(connection.allowedSenders) ? connection.allowedSenders.map(normalizedEmail) : [];
      if (!allowlist.includes(sender)) fail("permission-denied", "Email sender is not in the verified mailbox allowlist.");
      const auth = await verifyMessage({ connection, message, sender });
      if (!auth || auth.authenticated !== true || auth.senderAllowed !== true || auth.dmarc !== "pass" ||
          (auth.dkim !== "pass" && auth.spf !== "pass")) {
        fail("permission-denied", "Email sender authentication or allowlist verification failed.");
      }
      const results = [];
      for (const attachment of attachments) {
        if (!attachment || typeof attachment !== "object" || typeof attachment.filename !== "string" ||
            attachment.filename.length > 180 || /[\x00-\x1f\x7f]/.test(attachment.filename) ||
          !attachment.filename.toLowerCase().endsWith(".pdf") ||
            !["application/pdf", "application/octet-stream"].includes(attachment.contentType)) {
          results.push({ status: "ignored", reason: "not_a_pdf" });
          continue;
        }
        const bytes = Buffer.isBuffer(attachment.bytes) ? attachment.bytes :
          attachment.bytes instanceof Uint8Array ? Buffer.from(attachment.bytes) : null;
        if (!bytes || bytes.length < 8 || bytes.length > maxAttachmentBytes || bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
          results.push({ status: "quarantined", reason: "invalid_or_oversized_pdf" });
          continue;
        }
        const attachmentSha256 = createHash("sha256").update(bytes).digest("hex");
        const idempotencyKey = createHash("sha256")
          .update([connection.provider, connectionId, message.messageId, attachmentSha256].join("\n"))
          .digest("hex");
        const claim = await claimIngestionJob({
          accountId, connectionId, provider: connection.provider,
          messageId: message.messageId, attachmentSha256, idempotencyKey,
          receivedAt: Number.isSafeInteger(message.receivedAt) ? message.receivedAt : null
        });
        if (!claim || typeof claim.jobId !== "string" || !ID.test(claim.jobId)) fail("failed-precondition", "Ingestion job could not be claimed.");
        if (claim.duplicate === true) {
          results.push({ status: "duplicate", jobId: claim.jobId });
          continue;
        }
        try {
          const scan = await scanAttachment({ bytes, filename: attachment.filename, sha256: attachmentSha256 });
          if (!scan || scan.status !== "clean") {
            await finishIngestionJob({ accountId, jobId: claim.jobId, status: "quarantined", reason: "malware_or_scan_unavailable" });
            results.push({ status: "quarantined", jobId: claim.jobId, reason: "malware_or_scan_unavailable" });
            continue;
          }
          const parsed = await extractSchedule({ bytes, filename: attachment.filename, sha256: attachmentSha256 });
          if (!parsed || !Array.isArray(parsed.documents) || parsed.documents.length < 1 || parsed.documents.length > 100) {
            await finishIngestionJob({ accountId, jobId: claim.jobId, status: "needs_review", reason: "no_structured_schedule" });
            results.push({ status: "needs_review", jobId: claim.jobId, reason: "no_structured_schedule" });
            continue;
          }
          const proposals = [];
          const blocked = [];
          const resolvedEmployeeIds = new Set();
          for (const document of parsed.documents) {
            if (!document || typeof document.employeeMatchKey !== "string" ||
                document.employeeMatchKey.length < 1 || document.employeeMatchKey.length > 128 ||
                !Number.isFinite(document.confidence) || document.confidence < minConfidence ||
                !Array.isArray(document.shifts) || document.shifts.length < 1 || document.shifts.length > 62) {
              blocked.push({ reason: "low_confidence_or_invalid_document" });
              continue;
            }
            let employee;
            try { employee = await resolveEmployee({ accountId, connectionId, employeeMatchKey: document.employeeMatchKey }); }
            catch { employee = null; }
            if (!employee || employee.accountId !== accountId || !ID.test(employee.employeeId ?? "") ||
                !ID.test(employee.employeeUid ?? "") || employee.status !== "active" || employee.mappingVerified !== true) {
              blocked.push({ reason: "employee_mapping_unverified" });
              continue;
            }
            if (resolvedEmployeeIds.has(employee.employeeId)) {
              blocked.push({ reason: "duplicate_employee_document" });
              continue;
            }
            resolvedEmployeeIds.add(employee.employeeId);
            let shifts;
            try { shifts = document.shifts.map(normalizeShift); }
            catch { blocked.push({ reason: "invalid_parsed_shift" }); continue; }
            const keys = shifts.map(shiftKey);
            if (new Set(keys).size !== keys.length) { blocked.push({ reason: "duplicate_parsed_shift" }); continue; }
            const fromDate = shifts.reduce((min, shift) => shift.date < min ? shift.date : min, shifts[0].date);
            const toDate = shifts.reduce((max, shift) => shift.date > max ? shift.date : max, shifts[0].date);
            const existing = await loadEmployeeShifts({ accountId, employeeId: employee.employeeId, fromDate, toDate });
            let normalizedExisting;
            try {
              if (!Array.isArray(existing) || existing.length > 200) throw new Error("Invalid existing schedule bound.");
              normalizedExisting = existing.map(row => {
                if (!row || row.accountId !== accountId || row.employeeId !== employee.employeeId ||
                    !ID.test(row.shiftId ?? "") || !Number.isSafeInteger(row.revision) || row.revision < 1 ||
                    !validDate(row.date) || row.date < fromDate || row.date > toDate) throw new Error("Invalid existing shift identity.");
                const fields = Object.fromEntries([...SHIFT_FIELDS].filter(key => Object.hasOwn(row, key)).map(key => [key, row[key]]));
                return {
                  ...normalizeShift({ ...fields, post: fields.post ?? "", start_time: fields.start_time ?? "",
                    end_time: fields.end_time ?? "", hours: fields.hours ?? 0 }, { existing: true }),
                  accountId, employeeId: employee.employeeId, shiftId: row.shiftId, revision: row.revision
                };
              });
            } catch {
              blocked.push({ reason: "existing_schedule_unavailable" });
              continue;
            }
            let diff;
            try { diff = buildChanges(shifts, normalizedExisting); }
            catch { blocked.push({ reason: "ambiguous_schedule_diff" }); continue; }
            if (diff.changes.length === 0) {
              proposals.push({ employeeId: employee.employeeId, status: "unchanged", changeCount: 0 });
              continue;
            }
            const created = await createEmployeeProposal({
              accountId, employeeId: employee.employeeId, employeeUid: employee.employeeUid,
              source: "employer_email", sourceVerified: true, proposerUid: employee.employeeUid,
              ingestionJobId: claim.jobId, attachmentSha256, receivedAt: message.receivedAt,
              sender, idempotencyKey: claim.jobId + "_" + employee.employeeId,
              changes: diff.changes, before: diff.before
            });
            if (!created || typeof created.proposalId !== "string" || !ID.test(created.proposalId)) {
              blocked.push({ reason: "proposal_creation_failed" });
              continue;
            }
            proposals.push({ employeeId: employee.employeeId, proposalId: created.proposalId, status: "pending", changeCount: diff.changes.length });
          }
          const status = blocked.length ? (proposals.length ? "partially_processed" : "needs_review") :
            proposals.some(item => item.status === "pending") ? "proposals_created" : "unchanged";
          await finishIngestionJob({
            accountId, jobId: claim.jobId, status, attachmentSha256,
            proposalCount: proposals.filter(item => item.status === "pending").length,
            blockedCount: blocked.length
          });
          results.push({ status, jobId: claim.jobId, proposals, blocked });
        } catch (error) {
          await finishIngestionJob({ accountId, jobId: claim.jobId, status: "failed", reason: "processing_error" });
          throw error;
        }
      }
      return results;
    }
  });
}
