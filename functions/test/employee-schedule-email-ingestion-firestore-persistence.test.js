import test from "node:test";
import assert from "node:assert/strict";
import { createEmployeeScheduleEmailIngestionFirestorePersistence } from "../src/membership/employee-schedule-email-ingestion-firestore-persistence.js";

test("email ingestion persistence composes durable jobs and employee proposals without side effects", () => {
  let touched = 0;
  const db = {
    doc() { touched++; throw new Error("Firestore must not be accessed during composition."); },
    runTransaction() { touched++; throw new Error("Firestore must not be accessed during composition."); }
  };
  const persistence = createEmployeeScheduleEmailIngestionFirestorePersistence({ db, now: () => 1_800_000_000_000 });
  assert.equal(typeof persistence.claimIngestionJob, "function");
  assert.equal(typeof persistence.finishIngestionJob, "function");
  assert.equal(typeof persistence.createEmployeeProposal, "function");
  assert.equal(touched, 0);
});
