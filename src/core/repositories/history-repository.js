import { BaseRepository } from "./base-repository.js";
import { DatabaseError, DB_ERROR_CODES } from "../database/database-errors.js";

const ENTITY_TYPES = new Set(["shift", "profile", "setting"]);
const ACTIONS = new Set(["create", "update", "delete"]);
const ALLOWED_FIELDS = new Set([
  "entityType",
  "entityId",
  "action",
  "previousRevision",
  "newRevision"
]);

function validateEvent(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new DatabaseError(DB_ERROR_CODES.VALIDATION_FAILED, "Evento storico non valido.");
  }

  for (const key of Object.keys(data)) {
    if (!ALLOWED_FIELDS.has(key)) {
      throw new DatabaseError(DB_ERROR_CODES.VALIDATION_FAILED, `Campo storico non consentito: ${key}.`);
    }
  }

  if (!ENTITY_TYPES.has(data.entityType)) {
    throw new DatabaseError(DB_ERROR_CODES.VALIDATION_FAILED, "Categoria evento non valida.");
  }

  if (typeof data.entityId !== "string" || !data.entityId.trim() || data.entityId.length > 200) {
    throw new DatabaseError(DB_ERROR_CODES.VALIDATION_FAILED, "Identificativo record non valido.");
  }

  if (!ACTIONS.has(data.action)) {
    throw new DatabaseError(DB_ERROR_CODES.VALIDATION_FAILED, "Operazione storica non valida.");
  }

  for (const field of ["previousRevision", "newRevision"]) {
    const value = data[field];
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) {
      throw new DatabaseError(DB_ERROR_CODES.VALIDATION_FAILED, `${field} non valida.`);
    }
  }

  if (data.action === "create" && data.previousRevision !== undefined) {
    throw new DatabaseError(DB_ERROR_CODES.VALIDATION_FAILED, "Un evento di creazione non può avere una revisione precedente.");
  }

  if (data.action === "update" &&
      (data.previousRevision === undefined ||
       data.newRevision !== data.previousRevision + 1)) {
    throw new DatabaseError(DB_ERROR_CODES.VALIDATION_FAILED, "Revisioni di aggiornamento non coerenti.");
  }

  if (data.action === "delete" && data.previousRevision === undefined) {
    throw new DatabaseError(DB_ERROR_CODES.VALIDATION_FAILED, "La cancellazione richiede la revisione precedente.");
  }
}

export class HistoryRepository extends BaseRepository {
  constructor(options) {
    super({ ...options, storeName: "history" });
  }

  async create(data, options = {}) {
    validateEvent(data);
    return super.create(data, options);
  }

  async recordEvent(data) {
    return this.create(data);
  }

  async getEvents() {
    return this.getAll();
  }

  async getEventsForEntity(entityType, entityId) {
    if (!ENTITY_TYPES.has(entityType) ||
        typeof entityId !== "string" || !entityId.trim() || entityId.length > 200) {
      throw new DatabaseError(DB_ERROR_CODES.VALIDATION_FAILED, "Filtro cronologia non valido.");
    }
    const events = await this.getAll();
    return events
      .filter(event => event.data.entityType === entityType && event.data.entityId === entityId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }

  async getRecentEvents(limit = 50) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
      throw new DatabaseError(DB_ERROR_CODES.VALIDATION_FAILED, "Limite cronologia non valido (1-200).");
    }
    const events = await this.getAll();
    return events
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      .slice(0, limit);
  }

  async update() {
    throw new DatabaseError(DB_ERROR_CODES.VALIDATION_FAILED, "Gli eventi storici non possono essere modificati.");
  }

  async delete() {
    throw new DatabaseError(DB_ERROR_CODES.VALIDATION_FAILED, "Gli eventi storici non possono essere cancellati.");
  }
}
