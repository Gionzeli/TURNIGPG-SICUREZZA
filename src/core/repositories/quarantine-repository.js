import { BaseRepository } from "./base-repository.js";
import { DatabaseError, DB_ERROR_CODES } from "../database/database-errors.js";

const ITEM_TYPES = new Set(["shift", "template", "skill", "profile", "parameter", "extra", "unknown"]);
const REASONS = new Set([
  "invalid-data", "duplicate", "conflict", "missing-field",
  "unsupported-format", "manual-review"
]);
const RESOLUTION_STATUSES = new Set(["pending", "reviewed", "released", "discarded"]);
const ITEM_FIELDS = new Set(["itemType", "sourceIndex", "reason", "resolutionStatus", "noteCode"]);

function validateItemData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new DatabaseError(DB_ERROR_CODES.VALIDATION_FAILED, "Dati dell'elemento in quarantena non validi.");
  }
  for (const key of Object.keys(data)) {
    if (!ITEM_FIELDS.has(key)) {
      throw new DatabaseError(DB_ERROR_CODES.VALIDATION_FAILED, `Campo non consentito in quarantena: ${key}.`);
    }
  }
  if (data.itemType !== undefined && !ITEM_TYPES.has(data.itemType)) {
    throw new DatabaseError(DB_ERROR_CODES.VALIDATION_FAILED, "Tipo elemento non riconosciuto.");
  }
  if (data.reason !== undefined && !REASONS.has(data.reason)) {
    throw new DatabaseError(DB_ERROR_CODES.VALIDATION_FAILED, "Motivo di quarantena non riconosciuto.");
  }
  if (data.resolutionStatus !== undefined && !RESOLUTION_STATUSES.has(data.resolutionStatus)) {
    throw new DatabaseError(DB_ERROR_CODES.VALIDATION_FAILED, "Stato di revisione non riconosciuto.");
  }
  if (data.sourceIndex !== undefined && (!Number.isSafeInteger(data.sourceIndex) || data.sourceIndex < 0)) {
    throw new DatabaseError(DB_ERROR_CODES.VALIDATION_FAILED, "Indice sorgente non valido.");
  }
  if (data.noteCode !== undefined &&
      (typeof data.noteCode !== "string" || data.noteCode.length > 80 || !/^[a-z0-9-]*$/.test(data.noteCode))) {
    throw new DatabaseError(DB_ERROR_CODES.VALIDATION_FAILED, "Codice nota non valido.");
  }
}

export class QuarantineRepository extends BaseRepository {
  constructor(options) {
    super({ ...options, storeName: "migration_quarantine" });
  }

  async createItem(data) {
    validateItemData(data);
    return this.create({ resolutionStatus: "pending", ...data });
  }

  async updateItem(id, changes, options = {}) {
    validateItemData(changes);
    return this.update(id, changes, options);
  }

  getItem(id) { return this.getById(id); }
  getItems() { return this.getAll(); }
  deleteItem(id, options = {}) { return this.delete(id, options); }
}
