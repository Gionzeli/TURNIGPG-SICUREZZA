import test from "node:test";
import assert from "node:assert/strict";
import { createPdfBackedEmployeeScheduleEmailIngestion } from "../src/membership/employee-schedule-email-ingestion-pdf-composition.js";

const pdf = Buffer.from("%PDF-1.7 synthetic fixture");
const message = {
  messageId: "<pdf-composition@example.invalid>",
  from: "turni@azienda.example",
  receivedAt: Date.UTC(2026, 5, 1)
};

function dependencies(overrides = {}) {
  const calls = { proposals: [], parser: 0 };
  return {
    calls,
    values: {
      loadMailboxConnection: async () => ({
        accountId: "account-1", connectionId: "mailbox-1", provider: "imap",
        mode: "shared", status: "active", allowedSenders: ["turni@azienda.example"]
      }),
      verifyMessage: async () => ({
        authenticated: true, senderAllowed: true, dmarc: "pass", dkim: "pass", spf: "pass"
      }),
      scanAttachment: async () => ({ status: "clean" }),
      resolveEmployee: async () => ({
        accountId: "account-1", employeeId: "employee-1", employeeUid: "uid-1",
        status: "active", mappingVerified: true
      }),
      loadEmployeeShifts: async () => [],
      claimIngestionJob: async () => ({
        jobId: "job-1", duplicate: false, leaseToken: "a".repeat(64), fencingToken: 1
      }),
      createEmployeeProposal: async input => {
        calls.proposals.push(input);
        return { proposalId: "proposal-1", status: "pending", duplicate: false };
      },
      finishIngestionJob: async () => {},
      extractPdfTables: async () => {
        calls.parser++;
        return { documents: [{
          employeeMatchKey: "employee-code-1",
          confidence: 0.999,
          dateContext: "2026-06-02",
          tables: [{
            headers: ["Postazione", "Orario", "Ore", "Mansione", "Note"],
            rows: [["Reception", "08:00 alle 14:00", "6", "Accoglienza", "Portare badge"]]
          }]
        }] };
      },
      ...overrides
    }
  };
}

test("PDF composition routes parsed data through strict columns before proposing", async () => {
  const { values, calls } = dependencies();
  const { extractPdfTables, ...ingestionDependencies } = values;
  const service = createPdfBackedEmployeeScheduleEmailIngestion({
    ...ingestionDependencies,
    extractPdfTables
  });
  const result = await service.ingest({
    accountId: "account-1",
    connectionId: "mailbox-1",
    message,
    attachments: [{
      filename: "turni.pdf",
      contentType: "application/pdf",
      bytes: pdf
    }]
  });
  assert.equal(calls.parser, 1);
  assert.equal(calls.proposals.length, 1);
  assert.deepEqual(calls.proposals[0].changes[0].after, {
    date: "2026-06-02",
    type: "turno",
    post: "Reception",
    start_time: "08:00",
    end_time: "14:00",
    hours: 6
  });
  assert.deepEqual(calls.proposals[0].additionalInfo, ["Portare badge"]);
  assert.equal(result[0].status, "proposals_created");
});

test("PDF composition refuses missing or bypassed parser dependencies", () => {
  const { values } = dependencies();
  const { extractPdfTables, ...ingestionDependencies } = values;
  assert.throws(() => createPdfBackedEmployeeScheduleEmailIngestion(ingestionDependencies));
  assert.throws(() => createPdfBackedEmployeeScheduleEmailIngestion({
    ...ingestionDependencies,
    extractPdfTables,
    extractSchedule: async () => ({ documents: [] })
  }));
});
