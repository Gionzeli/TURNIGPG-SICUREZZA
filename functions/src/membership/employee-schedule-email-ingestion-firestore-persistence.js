import { createEmployeeScheduleIngestionJobFirestoreAdapter } from "./employee-schedule-ingestion-job-firestore-adapter.js";
import { createEmployeeScheduleProposalFirestoreAdapter } from "./employee-schedule-proposal-firestore-adapter.js";
import { createEmployeeShiftFirestoreAuthorization } from "./employee-shift-firestore-authorization.js";

/**
 * Composes the durable Firestore persistence boundary used by the employer-PDF
 * ingestion core. It does not enable polling, providers, triggers or callables.
 * Employee authorization is resolved from the reciprocal canonical UID binding
 * inside the same proposal transaction.
 */
export function createEmployeeScheduleEmailIngestionFirestorePersistence({
  db, now = () => Date.now(), leaseMs
}) {
  if (!db || typeof db.runTransaction !== "function" || typeof db.doc !== "function") {
    throw new TypeError("Trusted Firestore is required.");
  }
  const authorization = createEmployeeShiftFirestoreAuthorization({ db, now });
  const jobs = createEmployeeScheduleIngestionJobFirestoreAdapter({
    db, now, ...(leaseMs === undefined ? {} : { leaseMs })
  });
  const proposals = createEmployeeScheduleProposalFirestoreAdapter({
    db, now,
    authorizeEmployee: async (tx, { accountId, employeeId, employeeUid }) => {
      const principal = await authorization.loadOwnPrincipal(tx, {
        accountId, actorUid: employeeUid, operation: "read"
      });
      return principal.employeeId === employeeId ? principal : null;
    }
  });
  return Object.freeze({
    claimIngestionJob: jobs.claimIngestionJob,
    finishIngestionJob: jobs.finishIngestionJob,
    createEmployeeProposal: proposals.createEmployeeProposal
  });
}
