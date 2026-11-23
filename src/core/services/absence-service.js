import { validationError, requirePlainObject, validateDate, validateExpectedRevision } from "./service-validation.js";

const ABSENCE_KINDS = new Set(["ferie", "permesso", "malattia"]);
const ALLOWED_KEYS = ["kind", "startDate", "endDate"];

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
