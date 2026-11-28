import { createHash } from "node:crypto";

const STAGES = new Set(["pdf_read", "manual_write", "proposal_review"]);
const FIELDS = new Set(["date", "post", "start_time", "end_time", "additionalInfo"]);
const ISSUE = /^[a-z][a-z0-9_]{1,63}$/;
const MAX_VALUE = 300;

function fail(message) {
  const error = new Error(message);
  error.code = "invalid-argument";
  throw error;
}
function safeValue(value) {
  if (typeof value !== "string" || value.length > MAX_VALUE ||
      /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) fail("Correction values must be bounded plain text.");
  return value.trim();
}
function canonical(value) {
  return JSON.stringify(value);
}

/**
 * Captures a reviewed human correction without storing source PDFs, employee
 * names, email addresses, or raw mailbox content. Corrections are evidence,
 * not executable rules: repeated examples only produce review candidates.
 */
export function createScheduleCorrectionLearning({
  recordCorrection,
  listCorrections,
  now = () => Date.now(),
  minimumExamples = 3
}) {
  if (typeof recordCorrection !== "function" || typeof listCorrections !== "function") {
    throw new TypeError("Correction persistence dependencies are required.");
  }
  if (!Number.isSafeInteger(minimumExamples) || minimumExamples < 2 || minimumExamples > 20) {
    throw new TypeError("Correction threshold must be between 2 and 20.");
  }

  return Object.freeze({
    async capture(input) {
      if (!input || typeof input !== "object" || Array.isArray(input) ||
          !STAGES.has(input.stage) || !ISSUE.test(input.issueCode ?? "") ||
          !FIELDS.has(input.field) || typeof input.accountId !== "string" ||
          !/^[A-Za-z0-9_-]{1,128}$/.test(input.accountId) ||
          typeof input.actorUid !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(input.actorUid)) {
        fail("Invalid correction feedback identity or category.");
      }
      const observed = safeValue(input.observed);
      const corrected = safeValue(input.corrected);
      if (!observed || !corrected || observed === corrected) fail("Correction must contain distinct non-empty values.");
      const recordedAt = now();
      if (!Number.isSafeInteger(recordedAt) || recordedAt < 1) throw new TypeError("Invalid correction clock.");
      const fingerprint = createHash("sha256")
        .update(canonical([input.stage, input.issueCode, input.field, observed]))
        .digest("hex");
      const record = Object.freeze({
        accountId: input.accountId,
        stage: input.stage,
        issueCode: input.issueCode,
        field: input.field,
        observed,
        corrected,
        fingerprint,
        actorUid: input.actorUid,
        recordedAt,
        status: "captured"
      });
      const result = await recordCorrection(record);
      return Object.freeze({ fingerprint, status: "captured", duplicate: result?.duplicate === true });
    },

    async suggestRule({ accountId, stage, issueCode, field, observed }) {
      if (typeof accountId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(accountId) ||
          !STAGES.has(stage) || !ISSUE.test(issueCode ?? "") || !FIELDS.has(field)) {
        fail("Invalid correction candidate scope.");
      }
      const normalizedObserved = safeValue(observed);
      if (!normalizedObserved) fail("Observed value is required.");
      const fingerprint = createHash("sha256")
        .update(canonical([stage, issueCode, field, normalizedObserved]))
        .digest("hex");
      const records = await listCorrections({ accountId, fingerprint, limit: 50 });
      if (!Array.isArray(records) || records.length > 50) throw new TypeError("Invalid correction history.");
      const outcomes = new Map();
      for (const item of records) {
        if (!item || item.accountId !== accountId || item.fingerprint !== fingerprint ||
            item.stage !== stage || item.issueCode !== issueCode || item.field !== field ||
            item.observed !== normalizedObserved || typeof item.corrected !== "string" ||
            item.status !== "captured") continue;
        const actors = outcomes.get(item.corrected) ?? new Set();\n        actors.add(item.actorUid);\n        outcomes.set(item.corrected, actors);
      }
      const ranked = [...outcomes.entries()].map(([value, actors]) => [value, actors.size]).sort((a, b) => b[1] - a[1]);
      if (!ranked.length || ranked[0][1] < minimumExamples ||
          (ranked[1] && ranked[1][1] === ranked[0][1])) {
        return Object.freeze({ status: "insufficient_consensus", examples: records.length });
      }
      return Object.freeze({
        status: "review_required",
        accountId, stage, issueCode, field,
        observed: normalizedObserved,
        suggestedCorrection: ranked[0][0],
        supportingExamples: ranked[0][1],
        automaticallyApplied: false
      });
    }
  });
}
