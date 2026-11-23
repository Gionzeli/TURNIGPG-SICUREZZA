import { BaseRepository } from "./base-repository.js";
import { DatabaseError, DB_ERROR_CODES } from "../database/database-errors.js";

const ITEM_TYPES = new Set(["shift", "template", "skill", "profile", "parameter", "extra", "unknown"]);
const REASONS = new Set([
  "invalid-data", "duplicate", "conflict", "missing-field",
  "unsupported-format", "manual-review"
]);
const RESOLUTION_STATUSES = new Set(["pending", "reviewed", "released", "discarded"]);
const ITEM_FIELDS = new Set(["itemType", "sourceIndex", "reason", "resolutionStatus", "noteCode"]);

function validationError(message) {
  return new DatabaseError(DB_ERROR_CODES.VALIDATION_FAILED, message);
}

function validateItemData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw validationError("Dati dell'elemento in quarantena non validi.");
  }
  for (const key of Object.keys(data)) {
    if (!ITEM_FIELDS.has(key)) {
      throw validationError(`Campo non consentito in quarantena: ${key}.`);
    }
  }
  if (data.itemType !== undefined && !ITEM_TYPES.has(data.itemType)) {
    throw validationError("Tipo elemento non riconosciuto.");
  }
  if (data.reason !== undefined && !REASONS.has(data.reason)) {
    throw validationError("Motivo di quarantena non riconosciuto.");
  }
  if (data.resolutionStatus !== undefined && !RESOLUTION_STATUSES.has(data.resolutionStatus)) {
    throw validationError("Stato di revisione non riconosciuto.");
  }
  if (data.sourceIndex !== undefined && (!Number.isSafeInteger(data.sourceIndex) || data.sourceIndex < 0)) {
    throw validationError("Indice sorgente non valido.");
  }
  if (data.noteCode !== undefined &&
      (typeof data.noteCode !== "string" || data.noteCode.length > 80 || !/^[a-z0-9-]*$/.test(data.noteCode))) {
    throw validationError("Codice nota non valido.");
  }
  if (data.resolutionStatus !== undefined && data.resolutionStatus !== "pending") {
    throw validationError("Un nuovo elemento in quarantena deve iniziare in stato pending.");
  }
}

const ITEM_TRANSITIONS = new Map([
  ["pending", new Set(["reviewed", "discarded"])],
  ["reviewed", new Set(["discarded"])],
  ["released", new Set()],
  ["discarded", new Set()]
]);

export class QuarantineRepository extends BaseRepository {
  constructor(options) {
    super({ ...options, storeName: "migration_quarantine" });
  }

  async createItem(data) {
    validateItemData(data);
    return this.create({ resolutionStatus: "pending", ...data });
  }

  async updateItem(id, changes, options = {}) {
    // On update, "pending" is a valid explicit transition only when unchanged.
    const status = changes?.resolutionStatus;
    if (status !== undefined && !RESOLUTION_STATUSES.has(status)) {
      throw validationError("Stato di revisione non riconosciuto.");
    }
    const current = status === undefined ? null : await this.getItem(id);
    if (status !== undefined && !current) return null;
    if (status !== undefined && status !== current.data.resolutionStatus &&
        !ITEM_TRANSITIONS.get(current.data.resolutionStatus)?.has(status)) {
      throw validationError("Transizione di quarantena non consentita: il rilascio richiede un futuro processo di migrazione.");
    }
    const validationPayload = { ...changes };
    validateItemDataForUpdate(validationPayload);
    return this.update(id, changes, {
      ...options,
      ...(status !== undefined ? { expectedRevision: options.expectedRevision ?? current.revision } : {})
    });
  }

  getItem(id) { return this.getById(id); }
  getItems() { return this.getAll(); }
  deleteItem(id, options = {}) { return this.delete(id, options); }
}

function validateItemDataForUpdate(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw validationError("Dati dell'elemento in quarantena non validi.");
  }
  for (const key of Object.keys(data)) {
    if (!ITEM_FIELDS.has(key)) throw validationError(`Campo non consentito in quarantena: ${key}.`);
  }
  if (data.itemType !== undefined && !ITEM_TYPES.has(data.itemType)) throw validationError("Tipo elemento non riconosciuto.");
  if (data.reason !== undefined && !REASONS.has(data.reason)) throw validationError("Motivo di quarantena non riconosciuto.");
  if (data.resolutionStatus !== undefined && !RESOLUTION_STATUSES.has(data.resolutionStatus)) throw validationError("Stato di revisione non riconosciuto.");
  if (data.sourceIndex !== undefined && (!Number.isSafeInteger(data.sourceIndex) || data.sourceIndex < 0)) throw validationError("Indice sorgente non valido.");
  if (data.noteCode !== undefined && (typeof data.noteCode !== "string" || data.noteCode.length > 80 || !/^[a-z0-9-]*$/.test(data.noteCode))) throw validationError("Codice nota non valido.");
}
