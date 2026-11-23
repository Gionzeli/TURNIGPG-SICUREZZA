import { validationError, requirePlainObject, validateDate, validateExpectedRevision } from "./service-validation.js";

const ABSENCE_KINDS = new Set(["ferie", "permesso", "malattia"]);
const ALLOWED_KEYS = ["kind", "startDate", "endDate"];
const MAX_RANGE_DAYS = 3660;

function normalizeAbsence(input) {
  const source = requirePlainObject(input, "Assenza");
  for (const key of Object.keys(source)) {
    if (!ALLOWED_KEYS.includes(key)) validationError(`Campo assenza non riconosciuto: ${key}.`);
  }
  if (!ABSENCE_KINDS.has(source.kind)) validationError("Tipo di assenza non valido.");
  validateDate(source.startDate, "Data iniziale assenza");
  validateDate(source.endDate, "Data finale assenza");
  if (source.endDate < source.startDate) validationError("La data finale non può precedere quella iniziale.");
  return { kind: source.kind, startDate: source.startDate, endDate: source.endDate };
}

function validateRange(startDate, endDate) {
  validateDate(startDate, "Data iniziale intervallo");
  validateDate(endDate, "Data finale intervallo");
  if (endDate < startDate) validationError("La data finale non può precedere quella iniziale.");
  const days = (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86400000 + 1;
  if (days > MAX_RANGE_DAYS) validationError("Intervallo troppo ampio: massimo 10 anni.");
}

function daysBetweenInclusive(startDate, endDate) {
  return (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86400000 + 1;
}

function eachDate(startDate, endDate, callback) {
  const date = new Date(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  while (date.getTime() <= end) {
    callback(date.toISOString().slice(0, 10));
    date.setUTCDate(date.getUTCDate() + 1);
  }
}

export class AbsenceService {
  constructor({ repository }) {
    if (!repository) throw new TypeError("AbsenceService richiede un repository.");
    this.repository = repository;
  }

  async create(data, options = {}) {
    return this.repository.create(normalizeAbsence(data), options);
  }

  async getById(id) { return this.repository.getById(id); }
  async getAll() { return this.repository.getAll(); }

  async getInRange(startDate, endDate) {
    validateRange(startDate, endDate);
    const records = await this.repository.getAll();
    return records.filter(record =>
      record.data.startDate <= endDate && record.data.endDate >= startDate
    );
  }

  async summarizeRange(startDate, endDate) {
    validateRange(startDate, endDate);
    const records = await this.getInRange(startDate, endDate);
    const kinds = Object.fromEntries([...ABSENCE_KINDS].map(kind => [kind, { records: 0, uniqueCalendarDays: 0 }]));
    const coveredDays = Object.fromEntries([...ABSENCE_KINDS].map(kind => [kind, new Set()]));
    const overlaps = [];

    records.forEach(record => {
      const { kind, startDate: from, endDate: to } = record.data;
      const clippedStart = from < startDate ? startDate : from;
      const clippedEnd = to > endDate ? endDate : to;
      kinds[kind].records += 1;
      eachDate(clippedStart, clippedEnd, date => coveredDays[kind].add(date));
    });
    for (const kind of ABSENCE_KINDS) kinds[kind].uniqueCalendarDays = coveredDays[kind].size;

    for (let i = 0; i < records.length; i++) {
      for (let j = i + 1; j < records.length; j++) {
        const a = records[i].data, b = records[j].data;
        const overlapStart = a.startDate > b.startDate ? a.startDate : b.startDate;
        const overlapEnd = a.endDate < b.endDate ? a.endDate : b.endDate;
        if (overlapStart <= overlapEnd) {
          const clippedStart = overlapStart < startDate ? startDate : overlapStart;
          const clippedEnd = overlapEnd > endDate ? endDate : overlapEnd;
          if (clippedStart <= clippedEnd) overlaps.push({
            kinds: [a.kind, b.kind],
            startDate: clippedStart,
            endDate: clippedEnd,
            calendarDays: daysBetweenInclusive(clippedStart, clippedEnd)
          });
        }
      }
    }
    return Object.freeze({
      startDate, endDate, records: records.length,
      kinds: Object.freeze(Object.fromEntries(Object.entries(kinds).map(([kind, value]) => [kind, Object.freeze(value)]))),
      overlaps: Object.freeze(overlaps.map(item => Object.freeze({ ...item, kinds: Object.freeze([...item.kinds]) })))
    });
  }

  async update(id, changes, options = {}) {
    const expectedRevision = validateExpectedRevision(options);
    const current = await this.repository.getById(id);
    if (!current) return null;
    return this.repository.update(
      id,
      normalizeAbsence({ ...current.data, ...requirePlainObject(changes, "Modifiche assenza") }),
      { expectedRevision }
    );
  }

  async delete(id, options = {}) {
    return this.repository.delete(id, { expectedRevision: validateExpectedRevision(options) });
  }
}
