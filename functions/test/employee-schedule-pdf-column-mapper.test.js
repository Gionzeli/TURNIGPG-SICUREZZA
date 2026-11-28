import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createPdfScheduleColumnExtractor, mapPdfScheduleTables } from "../src/membership/employee-schedule-pdf-column-mapper.js";

const tableDocument = {
  employeeMatchKey: "employee-42",
  confidence: 0.999,
  dateContext: "2026-06-02",
  tables: [{
    headers: ["Data", "Postazione", "Orario", "Info", "Ore totali", "Mansione", "Flag notte"],
    rows: [
      ["02/06/2026", "Reception", "08:00 - 14:00", "Portare il badge", "99", "Accoglienza", "SI"],
      ["", "Ingresso nord", "14:00–20:00", "Cambio ingresso", "99", "Controllo", "NO"]
    ]
  }]
};

test("PDF table mapper extracts only date, postazione, time and optional info", () => {
  const result = mapPdfScheduleTables({ documents: [tableDocument] });
  assert.deepEqual(result.documents[0].shifts, [
    { date: "2026-06-02", post: "Reception", start_time: "08:00", end_time: "14:00" },
    { date: "2026-06-02", post: "Ingresso nord", start_time: "14:00", end_time: "20:00" }
  ]);
  assert.deepEqual(result.documents[0].additionalInfo, ["Portare il badge", "Cambio ingresso"]);
  assert.equal(Object.hasOwn(result.documents[0].shifts[0], "hours"), false);
  assert.equal(Object.hasOwn(result.documents[0].shifts[0], "type"), false);
  assert.equal(Object.hasOwn(result.documents[0].shifts[0], "is_night"), false);
});

test("PDF table mapper supports separate start and end columns and date context", () => {
  const result = mapPdfScheduleTables({ documents: [{
    confidence: 0.99, dateContext: "2026-06-03",
    tables: [{ headers: ["Postazione", "Dalle", "Alle"], rows: [["Magazzino", "22:00", "06:00"]] }]
  }] });
  assert.deepEqual(result.documents[0].shifts[0], {
    date: "2026-06-03", post: "Magazzino", start_time: "22:00", end_time: "06:00"
  });
});

test("unreadable rows, ambiguous columns and conflicting time layouts fail closed", () => {
  for (const document of [
    { confidence: 0.99, tables: [{ headers: ["Postazione", "Orario"], rows: [["Reception", "08:00-"]] }] },
    { confidence: 0.99, tables: [{ headers: ["Postazione", "Post", "Orario"], rows: [["A", "A", "08:00-09:00"]] }] },
    { confidence: 0.99, tables: [{ headers: ["Postazione", "Orario", "Inizio", "Fine"], rows: [["A", "08:00-09:00", "08:00", "09:00"]] }] },
    { confidence: 0.99, tables: [{ headers: ["Postazione", "Orario"], rows: [["A", "08:00-09:00"]] }] }
  ]) {
    assert.throws(() => mapPdfScheduleTables({ documents: [document] }));
  }
});

test("invalid calendar dates are not hidden by a document date context", () => {
  assert.throws(() => mapPdfScheduleTables({ documents: [{
    confidence: 1, dateContext: "2026-06-02",
    tables: [{ headers: ["Data", "Postazione", "Orario"], rows: [["31/02/2026", "A", "08:00-09:00"]] }]
  }] }));
});

test("invalid calendar dates and excessive PDF rows are rejected", () => {
  assert.throws(() => mapPdfScheduleTables({ documents: [{
    confidence: 1, tables: [{ headers: ["Data", "Postazione", "Orario"], rows: [["31/02/2026", "A", "08:00-09:00"]] }]
  }] }));
  assert.throws(() => mapPdfScheduleTables({ documents: [{
    confidence: 1, tables: [{ headers: ["Postazione", "Orario"], rows: Array.from({length:501}, () => ["A","08:00-09:00"]) }]
  }] }));
});

test("extractor delegates PDF/OCR to an injected engine then applies strict column mapping", async () => {
  const calls = [];
  const extract = createPdfScheduleColumnExtractor({
    extractPdfTables: async input => { calls.push(input.filename); return { documents: [tableDocument] }; }
  });
  const bytes = Buffer.from("%PDF-synthetic");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const result = await extract({ bytes, filename: "turni.pdf", sha256 });
  assert.deepEqual(calls, ["turni.pdf"]);
  assert.equal(result.documents[0].shifts.length, 2);
  assert.deepEqual(result.documents[0].additionalInfo, ["Portare il badge", "Cambio ingresso"]);
});

test("extractor refuses to pretend that a PDF engine exists", () => {
  assert.throws(() => createPdfScheduleColumnExtractor({}));
});

test("extractor verifies PDF signature and content digest before calling the engine", async () => {
  let calls = 0;
  const extract = createPdfScheduleColumnExtractor({
    extractPdfTables: async () => { calls += 1; return { documents: [tableDocument] }; }
  });
  const validBytes = Buffer.from("%PDF-synthetic");
  const validHash = createHash("sha256").update(validBytes).digest("hex");
  await assert.rejects(
    extract({ bytes: Buffer.from("not-a-pdf"), filename: "turni.pdf", sha256: validHash })
  );
  await assert.rejects(
    extract({ bytes: validBytes, filename: "turni.pdf", sha256: "a".repeat(64) })
  );
  assert.equal(calls, 0);
});

test("extractor snapshots attachment bytes before asynchronous parser access", async () => {
  const original = Buffer.from("%PDF-synthetic");
  const expected = Buffer.from(original);
  const sha256 = createHash("sha256").update(expected).digest("hex");
  let parserBytes;
  let releaseParser;
  const parserGate = new Promise(resolve => { releaseParser = resolve; });
  const extract = createPdfScheduleColumnExtractor({
    extractPdfTables: async input => {
      parserBytes = Buffer.from(input.bytes);
      await parserGate;
      return { documents: [tableDocument] };
    }
  });
  const pending = extract({ bytes: original, filename: "turni.pdf", sha256 });
  original.fill(0);
  releaseParser();
  await pending;
  assert.deepEqual(parserBytes, expected);
});
