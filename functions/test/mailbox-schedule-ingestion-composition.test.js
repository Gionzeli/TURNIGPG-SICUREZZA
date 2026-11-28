import test from "node:test";
import assert from "node:assert/strict";
import { createMailboxScheduleIngestionComposition } from "../src/membership/mailbox-schedule-ingestion-composition.js";

test("composition is disabled by default and rejects execution fail-closed", async () => {
  const composed = createMailboxScheduleIngestionComposition({});
  assert.equal(composed.enabled, false);
  await assert.rejects(composed.run({ accountId: "acct" }), { code: "failed-precondition" });
  await assert.rejects(composed.initializePollingState({ accountId: "acct", connectionId: "conn" }), { code: "failed-precondition" });
});

test("enabled composition requires explicit provider and ingest dependencies", () => {
  assert.throws(() => createMailboxScheduleIngestionComposition({ enabled: true }), /explicit providers/);
});

test("disabled composition does not touch Firestore or provider dependencies", async () => {
  let invoked = false;
  const composed = createMailboxScheduleIngestionComposition({
    db: { collection() { invoked = true; }, doc() { invoked = true; }, runTransaction() { invoked = true; } },
    leaseService: {}, providerAdapters: {}, ingestMessage: () => [], enabled: false
  });
  await assert.rejects(composed.run({ accountId: "acct" }), { code: "failed-precondition" });
  assert.equal(invoked, false);
});
