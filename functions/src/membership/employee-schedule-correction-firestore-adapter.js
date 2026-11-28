import { createHash } from "node:crypto";

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const HEX = /^[a-f0-9]{64}$/;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}
function validRecord(record) {
  return record && ID.test(record.accountId ?? "") && ID.test(record.actorUid ?? "") &&
    ["pdf_read", "manual_write", "proposal_review"].includes(record.stage) &&
    /^[a-z][a-z0-9_]{1,63}$/.test(record.issueCode ?? "") &&
    ["date", "post", "start_time", "end_time", "additionalInfo"].includes(record.field) &&
    typeof record.observed === "string" && record.observed.length > 0 && record.observed.length <= 300 &&
    typeof record.corrected === "string" && record.corrected.length > 0 && record.corrected.length <= 300 &&
    record.observed !== record.corrected && HEX.test(record.fingerprint ?? "") &&
    Number.isSafeInteger(record.recordedAt) && record.recordedAt > 0 && record.status === "captured";
}

/** Account-scoped immutable evidence store. No source PDF or raw email is persisted. */
export function createScheduleCorrectionFirestoreAdapter({ db }) {
  if (!db || typeof db.collection !== "function" || typeof db.runTransaction !== "function") {
    throw new TypeError("Trusted Firestore Admin database is required.");
  }
  const collectionFor = accountId => db.collection("accounts").doc(accountId).collection("scheduleCorrectionFeedback");
  const documentId = record => createHash("sha256")
    .update([record.fingerprint, record.actorUid, record.corrected].join("\n"))
    .digest("hex");

  return Object.freeze({
    async recordCorrection(record) {
      if (!validRecord(record)) fail("invalid-argument", "Invalid correction evidence.");
      const ref = collectionFor(record.accountId).doc(documentId(record));
      return db.runTransaction(async tx => {
        const snapshot = await tx.get(ref);
        if (snapshot.exists) {
          const prior = snapshot.data();
          if (!validRecord(prior) || prior.accountId !== record.accountId ||
              prior.fingerprint !== record.fingerprint || prior.actorUid !== record.actorUid ||
              prior.corrected !== record.corrected) {
            fail("failed-precondition", "Correction evidence identity conflict.");
          }
          return { duplicate: true };
        }
        tx.create(ref, record);
        return { duplicate: false };
      });
    },

    async listCorrections({ accountId, fingerprint, limit }) {
      if (!ID.test(accountId ?? "") || !HEX.test(fingerprint ?? "") ||
          !Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
        fail("invalid-argument", "Invalid correction history query.");
      }
      const snapshot = await collectionFor(accountId)
        .where("fingerprint", "==", fingerprint)
        .limit(limit)
        .get();
      return snapshot.docs.map(doc => {
        const value = doc.data();
        if (!validRecord(value) || value.accountId !== accountId || value.fingerprint !== fingerprint) {
          fail("failed-precondition", "Malformed correction history record.");
        }
        return value;
      });
    }
  });
}
