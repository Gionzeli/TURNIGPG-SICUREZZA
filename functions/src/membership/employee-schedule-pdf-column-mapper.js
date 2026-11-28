import { createHash } from "node:crypto";

const MAX_PDF_BYTES = 10 * 1024 * 1024;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const IT_DATE = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/;
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const RANGE = /^\s*((?:[01]\d|2[0-3]):[0-5]\d)\s*(?:-|–|—|alle|a)\s*((?:[01]\d|2[0-3]):[0-5]\d)\s*$/i;
const ALIASES = Object.freeze({
  date: new Set(["data", "giorno", "date"]),
  post: new Set(["postazione", "post", "sede operativa"]),
  range: new Set(["orario", "ora", "orario turno", "fascia oraria"]),
  start: new Set(["inizio", "ora inizio", "dalle"]),
  end: new Set(["fine", "ora fine", "alle"]),
  info: new Set(["info", "informazioni", "note", "comunicazioni"])
});
const MAX_DOCUMENTS = 100;
const MAX_TABLES = 20;
const MAX_ROWS = 500;
const MAX_INFO = 8;

function fail(message) {
  const error = new Error(message);
  error.code = "invalid-argument";
  throw error;
}
function header(value) {
  if (typeof value !== "string" || value.length > 80) return "";
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().trim().replace(/\s+/g, " ");
}
function dateValue(value) {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  let normalized = raw;
  const it = IT_DATE.exec(raw);
  if (it) normalized = it[3] + "-" + it[2].padStart(2, "0") + "-" + it[1].padStart(2, "0");
  if (!ISO_DATE.test(normalized)) return null;
  const parsed = new Date(normalized + "T00:00:00Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === normalized ? normalized : null;
}
function cellText(value, max = 300) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  const text = String(value).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "").trim();
  return text.length <= max ? text : "";
}
function mappedColumns(headers) {
  if (!Array.isArray(headers) || headers.length < 1 || headers.length > 40) fail("Invalid PDF table headers.");
  const found = {};
  headers.forEach((value, index) => {
    const key = header(value);
    for (const [field, aliases] of Object.entries(ALIASES)) {
      if (!aliases.has(key)) continue;
      if (Object.hasOwn(found, field)) fail("Ambiguous PDF schedule columns.");
      found[field] = index;
    }
  });
  if (!Object.hasOwn(found, "post") ||
      !(Object.hasOwn(found, "range") || (Object.hasOwn(found, "start") && Object.hasOwn(found, "end")))) {
    fail("PDF table is missing postazione or time columns.");
  }
  if (Object.hasOwn(found, "range") && (Object.hasOwn(found, "start") || Object.hasOwn(found, "end"))) {
    fail("PDF table has conflicting time column layouts.");
  }
  return found;
}
function timeRange(row, columns) {
  if (Object.hasOwn(columns, "range")) {
    const match = RANGE.exec(cellText(row[columns.range], 40));
    return match ? { start_time: match[1], end_time: match[2] } : null;
  }
  const start_time = cellText(row[columns.start], 10);
  const end_time = cellText(row[columns.end], 10);
  return TIME.test(start_time) && TIME.test(end_time) ? { start_time, end_time } : null;
}
function safeInfo(value) {
  const text = cellText(value, 300);
  return text ? text : "";
}

/**
 * Converts structured PDF table output into the strict calendar extraction DTO.
 * The injected table reader performs PDF/OCR; this mapper deliberately reads
 * only date context, postazione, time and the optional info/note column.
 */
export function mapPdfScheduleTables({ documents }) {
  if (!Array.isArray(documents) || documents.length < 1 || documents.length > MAX_DOCUMENTS) {
    fail("Invalid PDF document collection.");
  }
  return {
    documents: documents.map(document => {
      if (!document || typeof document !== "object" || Array.isArray(document) ||
          !Number.isFinite(document.confidence) || document.confidence < 0 || document.confidence > 1 ||
          !Array.isArray(document.tables) || document.tables.length < 1 || document.tables.length > MAX_TABLES) {
        fail("Invalid PDF employee document.");
      }
      const employeeMatchKey = document.employeeMatchKey == null ? null : cellText(document.employeeMatchKey, 128);
      if (document.employeeMatchKey != null && !employeeMatchKey) fail("Invalid employee matching key.");
      const dateContext = document.dateContext == null ? null : dateValue(document.dateContext);
      if (document.dateContext != null && !dateContext) fail("Invalid PDF date context.");
      const shifts = [];
      const additionalInfo = [];
      let totalRows = 0;
      for (const table of document.tables) {
        if (!table || typeof table !== "object" || Array.isArray(table) || !Array.isArray(table.rows)) {
          fail("Invalid PDF schedule table.");
        }
        const columns = mappedColumns(table.headers);
        totalRows += table.rows.length;
        if (totalRows > MAX_ROWS) fail("PDF schedule contains too many rows.");
        for (const row of table.rows) {
          if (!Array.isArray(row) || row.length !== table.headers.length) fail("Malformed PDF schedule row.");
          const rawDate = Object.hasOwn(columns, "date") ? cellText(row[columns.date], 20) : "";
          const date = rawDate ? dateValue(rawDate) : dateContext;
          const post = cellText(row[columns.post], 80);
          const times = timeRange(row, columns);
          if (!date || !post || !times || times.start_time === times.end_time) {
            fail("PDF row has an unreadable date, postazione or time range.");
          }
          shifts.push({ date, post, ...times });
          if (Object.hasOwn(columns, "info")) {
            const info = safeInfo(row[columns.info]);
            if (info && !additionalInfo.includes(info)) additionalInfo.push(info);
          }
        }
      }
      if (additionalInfo.length > MAX_INFO) fail("PDF contains too many additional information items.");
      return { employeeMatchKey, confidence: document.confidence, shifts, additionalInfo };
    })
  };
}

/**
 * Adapter for a separately supplied PDF text/table extraction engine.
 * No OCR implementation, credentials, network or filesystem access is bundled.
 */
export function createPdfScheduleColumnExtractor({ extractPdfTables }) {
  if (typeof extractPdfTables !== "function") throw new TypeError("PDF table extraction engine is required.");
  return async input => {
    if (!input || !(input.bytes instanceof Uint8Array) || input.bytes.length < 8 ||
        input.bytes.length > MAX_PDF_BYTES ||
        Buffer.from(input.bytes.subarray(0, 5)).toString("ascii") !== "%PDF-" ||
        typeof input.filename !== "string" || !input.filename.trim() || input.filename.length > 255 ||
        typeof input.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(input.sha256)) {
      fail("Invalid PDF extraction input.");
    }
    // Snapshot once so the digest and parser always operate on identical bytes.
    const stableBytes = Buffer.from(input.bytes);
    const actualSha256 = createHash("sha256").update(stableBytes).digest("hex");
    if (actualSha256 !== input.sha256) fail("PDF attachment digest mismatch.");
    const extracted = await extractPdfTables({
      bytes: stableBytes,
      filename: input.filename,
      sha256: actualSha256
    });
    return mapPdfScheduleTables(extracted);
  };
}
