import test from "node:test";
import assert from "node:assert/strict";
import { createEmployeeScheduleEmailIngestion } from "../src/membership/employee-schedule-email-ingestion.js";

const accountId = "synthetic-account";
const connectionId = "synthetic-mailbox";
const pdf = Buffer.from("%PDF-1.7\nsynthetic schedule fixture");
const message = {
  messageId: "<synthetic-message-01@example.invalid>",
  from: "turni@azienda.example",
  receivedAt: Date.UTC(2026, 5, 1),
};
const attachment = { filename: "turni-giugno.pdf", contentType: "application/pdf", bytes: pdf };

function harness(overrides = {}) {
  const calls = { claims: [], proposals: [], finished: [], scans: 0 };
  const service = createEmployeeScheduleEmailIngestion({
    loadMailboxConnection: async () => ({
      accountId, connectionId, provider: "imap", status: "active", allowedSenders: ["turni@azienda.example"]
    }),
    verifyMessage: async () => ({ authenticated: true, senderAllowed: true, dmarc: "pass", dkim: "pass", spf: "pass" }),
    scanAttachment: async () => { calls.scans++; return { status: "clean" }; },
    extractSchedule: async () => ({
      documents: [{
        employeeMatchKey: "verified-employee-code",
        confidence: 0.999,
        shifts: [
          { date: "2026-06-02", type: "turno", post: "Reception", start_time: "08:00", end_time: "14:00", hours: 6 },
          { date: "2026-06-03", type: "turno", post: "Reception", start_time: "14:00", end_time: "20:00", hours: 6 }
        ]
      }]
    }),
    resolveEmployee: async () => ({
      accountId, employeeId: "synthetic-employee", employeeUid: "synthetic-employee-uid",
      status: "active", mappingVerified: true
    }),
    loadEmployeeShifts: async () => [{
      accountId, employeeId: "synthetic-employee", shiftId: "existing-shift",
      date: "2026-06-02", type: "turno", post: "Reception",
      start_time: "08:00", end_time: "13:00", hours: 5, revision: 4
    }],
    claimIngestionJob: async input => {
      calls.claims.push(input);
      return { jobId: "synthetic-job-01", duplicate: false };
    },
    createEmployeeProposal: async input => {
      calls.proposals.push(input);
      return { proposalId: "synthetic-proposal-01" };
    },
    finishIngestionJob: async input => { calls.finished.push(input); },
    ...overrides
  });
  return { service, calls };
}

test("trusted email ingestion creates per-employee proposals but never mutates the live schedule", async () => {
  const { service, calls } = harness();
  const result = await service.ingest({ accountId, connectionId, message, attachments: [attachment] });
  assert.equal(result[0].status, "proposals_created");
  assert.equal(result[0].proposals[0].status, "pending");
  assert.equal(calls.proposals.length, 1);
  const proposal = calls.proposals[0];
  assert.equal(proposal.source, "employer_email");
  assert.equal(proposal.sourceVerified, true);
  assert.equal(proposal.proposerUid, "synthetic-employee-uid");
  assert.equal(proposal.employeeId, "synthetic-employee");
  assert.match(proposal.idempotencyKey, /^synthetic-job-01_synthetic-employee$/);
  assert.match(proposal.attachmentSha256, /^[a-f0-9]{64}$/);
  assert.equal(Object.hasOwn(proposal, "bytes"), false, "raw PDF bytes must not enter the proposal record");
  assert.equal(proposal.changes.length, 2);
  assert.equal(proposal.changes[0].operation, "update");
  assert.equal(proposal.changes[0].expectedRevision, 4);
  assert.equal(proposal.before[0].hours, 5);
  assert.equal(proposal.changes[1].operation, "create");
  assert.equal(proposal.before[1], null);
  assert.equal(proposal.changes.some(item => item.operation === "delete"), false);
  assert.equal(calls.finished[0].status, "proposals_created");
});

test("a PDF containing multiple collaborators is partitioned into separate personal proposals", async () => {
  const { service, calls } = harness({
    extractSchedule: async () => ({ documents: [
      { employeeMatchKey: "employee-A", confidence: 0.999, shifts: [
        { date: "2026-06-02", type: "turno", post: "Reception A", start_time: "08:00", end_time: "14:00", hours: 6 }
      ] },
      { employeeMatchKey: "employee-B", confidence: 0.999, shifts: [
        { date: "2026-06-02", type: "turno", post: "Reception B", start_time: "14:00", end_time: "20:00", hours: 6 }
      ] }
    ] }),
    resolveEmployee: async ({ employeeMatchKey }) => ({
      accountId, employeeId: employeeMatchKey, employeeUid: "uid-" + employeeMatchKey,
      status: "active", mappingVerified: true
    }),
    loadEmployeeShifts: async ({ employeeId }) => [{
      accountId, employeeId, shiftId: "existing-" + employeeId,
      date: "2026-06-02", type: "turno", post: employeeId === "employee-A" ? "Reception A" : "Reception B",
      start_time: "07:00", end_time: "13:00", hours: 6, revision: 1
    }],
    createEmployeeProposal: async input => {
      calls.proposals.push(input);
      return { proposalId: "proposal-" + input.employeeId };
    }
  });
  const result = await service.ingest({ accountId, connectionId, message, attachments: [attachment] });
  assert.equal(result[0].proposals.length, 2);
  assert.deepEqual(calls.proposals.map(item => item.employeeId).sort(), ["employee-A", "employee-B"]);
  assert.equal(calls.proposals.find(item => item.employeeId === "employee-A").before[0].post, "Reception A");
  assert.equal(calls.proposals.find(item => item.employeeId === "employee-B").before[0].post, "Reception B");
  assert.equal(calls.proposals.find(item => item.employeeId === "employee-A").changes[0].changes.start_time, "08:00");
  assert.equal(calls.proposals.find(item => item.employeeId === "employee-B").changes[0].changes.start_time, "14:00");
  assert.equal(result[0].proposals.every(item => item.status === "pending"), true);
});

test("unverified sender is rejected before an ingestion job or PDF scan", async () => {
  const { service, calls } = harness({
    verifyMessage: async () => ({ authenticated: false, senderAllowed: false, dmarc: "fail", dkim: "fail", spf: "fail" })
  });
  await assert.rejects(
    service.ingest({ accountId, connectionId, message, attachments: [attachment] }),
    error => error.code === "permission-denied"
  );
  assert.equal(calls.claims.length, 0);
  assert.equal(calls.scans, 0);
});

test("an absent optional flag in a PDF does not clear a previously recorded value", async () => {
  const { service, calls } = harness({
    extractSchedule: async () => ({ documents: [{
      employeeMatchKey: "verified-employee-code", confidence: 0.999,
      shifts: [{ date: "2026-06-02", type: "turno", post: "Reception", start_time: "08:00", end_time: "13:00", hours: 5 }]
    }] }),
    loadEmployeeShifts: async () => [{
      accountId, employeeId: "synthetic-employee", shiftId: "existing-shift",
      date: "2026-06-02", type: "turno", post: "Reception",
      start_time: "08:00", end_time: "13:00", hours: 5, is_night: true, revision: 4
    }]
  });
  const result = await service.ingest({ accountId, connectionId, message, attachments: [attachment] });
  assert.equal(result[0].status, "unchanged");
  assert.equal(calls.proposals.length, 0);
});

test("authenticated but non-allowlisted sender is rejected", async () => {
  const { service, calls } = harness({
    loadMailboxConnection: async () => ({
      accountId, connectionId, provider: "imap", status: "active",
      allowedSenders: ["ufficio@azienda.example"]
    })
  });
  await assert.rejects(
    service.ingest({ accountId, connectionId, message, attachments: [attachment] }),
    error => error.code === "permission-denied"
  );
  assert.equal(calls.claims.length, 0);
  assert.equal(calls.scans, 0);
});

test("duplicate provider message and attachment are idempotently skipped", async () => {
  const { service, calls } = harness({
    claimIngestionJob: async input => {
      calls.claims.push(input);
      return { jobId: "synthetic-job-01", duplicate: true };
    }
  });
  const result = await service.ingest({ accountId, connectionId, message, attachments: [attachment] });
  assert.equal(result[0].status, "duplicate");
  assert.equal(calls.scans, 0);
  assert.equal(calls.proposals.length, 0);
});

test("low-confidence employee extraction is blocked without creating a proposal", async () => {
  const { service, calls } = harness({
    extractSchedule: async () => ({
      documents: [{ employeeMatchKey: "maybe-employee", confidence: 0.7, shifts: [
        { date: "2026-06-02", type: "turno" }
      ] }]
    })
  });
  const result = await service.ingest({ accountId, connectionId, message, attachments: [attachment] });
  assert.equal(result[0].status, "needs_review");
  assert.equal(result[0].proposals.length, 0);
  assert.equal(result[0].blocked[0].reason, "low_confidence_or_invalid_document");
  assert.equal(calls.proposals.length, 0);
});

test("ambiguous shift matching is blocked instead of guessing", async () => {
  const { service, calls } = harness({
    extractSchedule: async () => ({ documents: [{
      employeeMatchKey: "verified-employee-code", confidence: 0.999,
      shifts: [{ date: "2026-06-02", type: "turno", post: "Reception", start_time: "10:00", end_time: "16:00", hours: 6 }]
    }] }),
    loadEmployeeShifts: async () => [
      { accountId, employeeId: "synthetic-employee", shiftId: "shift-a", date: "2026-06-02", type: "turno", post: "Reception", start_time: "07:00", end_time: "13:00", hours: 6, revision: 1 },
      { accountId, employeeId: "synthetic-employee", shiftId: "shift-b", date: "2026-06-02", type: "turno", post: "Reception", start_time: "08:00", end_time: "14:00", hours: 6, revision: 1 }
    ]
  });
  const result = await service.ingest({ accountId, connectionId, message, attachments: [attachment] });
  assert.equal(result[0].status, "needs_review");
  assert.equal(calls.proposals.length, 0);
});

test("non-PDF and malformed PDF attachments never reach the parser", async () => {
  const { service, calls } = harness();
  const result = await service.ingest({
    accountId, connectionId, message,
    attachments: [
      { filename: "cedolino.pdf", contentType: "application/pdf", bytes: Buffer.from("not a PDF") },
      { filename: "note.txt", contentType: "text/plain", bytes: Buffer.from("hello") }
    ]
  });
  assert.deepEqual(result.map(item => item.status), ["quarantined", "ignored"]);
  assert.equal(calls.proposals.length, 0);
  assert.equal(calls.scans, 0);
});
