import test from "node:test";
import assert from "node:assert/strict";
import { createScheduleCorrectionLearning } from "../src/membership/employee-schedule-correction-learning.js";

function harness() {
  const records = [];
  const service = createScheduleCorrectionLearning({
    now: () => 1770000000000 + records.length,
    recordCorrection: async record => {
      const duplicate = records.some(item =>
        item.accountId === record.accountId &&
        item.fingerprint === record.fingerprint &&
        item.corrected === record.corrected && item.actorUid === record.actorUid
      );
      if (!duplicate) records.push(record);
      return { duplicate };
    },
    listCorrections: async ({ accountId, fingerprint, limit }) =>
      records.filter(item => item.accountId === accountId && item.fingerprint === fingerprint).slice(0, limit)
  });
  return { service, records };
}

const base = {
  accountId: "account-1",
  actorUid: "manager-1",
  stage: "pdf_read",
  issueCode: "ocr_post_confusion",
  field: "post",
  observed: "Recep tion",
  corrected: "Reception"
};

test("captures minimal correction evidence without source document or employee identity", async () => {
  const { service, records } = harness();
  const result = await service.capture(base);
  assert.equal(result.status, "captured");
  assert.equal(records.length, 1);
  assert.equal(records[0].corrected, "Reception");
  assert.equal(Object.hasOwn(records[0], "pdf"), false);
  assert.equal(Object.hasOwn(records[0], "employeeName"), false);
  assert.equal(Object.hasOwn(records[0], "email"), false);
});

test("repeated identical corrections suggest a rule but never auto-apply it", async () => {
  const { service } = harness();
  await service.capture(base);
  await service.capture({ ...base, actorUid: "manager-2" });
  await service.capture({ ...base, actorUid: "manager-3" });
  const suggestion = await service.suggestRule({
    accountId: base.accountId,
    stage: base.stage,
    issueCode: base.issueCode,
    field: base.field,
    observed: base.observed
  });
  assert.equal(suggestion.status, "review_required");
  assert.equal(suggestion.suggestedCorrection, "Reception");
  assert.equal(suggestion.supportingExamples, 3);
  assert.equal(suggestion.automaticallyApplied, false);
});

test("conflicting corrections never produce an automatic consensus", async () => {
  const { service } = harness();
  await service.capture(base);
  await service.capture({ ...base, corrected: "Reparto" });
  await service.capture({ ...base, actorUid: "manager-3" });
  const suggestion = await service.suggestRule({
    accountId: base.accountId, stage: base.stage, issueCode: base.issueCode,
    field: base.field, observed: base.observed
  });
  assert.equal(suggestion.status, "insufficient_consensus");
});

test("correction history is isolated by account", async () => {
  const { service } = harness();
  await service.capture(base);
  await service.capture({ ...base, accountId: "account-2" });
  const suggestion = await service.suggestRule({
    accountId: "account-2", stage: base.stage, issueCode: base.issueCode,
    field: base.field, observed: base.observed
  });
  assert.equal(suggestion.status, "insufficient_consensus");
});

test("rejects unsafe or irrelevant correction payloads", async () => {
  const { service } = harness();
  await assert.rejects(service.capture({ ...base, corrected: " " }));
  await assert.rejects(service.capture({ ...base, field: "employeeName" }));
  await assert.rejects(service.capture({ ...base, observed: "bad\u0000value" }));
});
