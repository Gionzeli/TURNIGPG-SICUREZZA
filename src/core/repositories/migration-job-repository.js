import { BaseRepository } from "./base-repository.js";
import { DatabaseError, DB_ERROR_CODES } from "../database/database-errors.js";

const JOB_STATUSES = new Set([
  "analysis", "review-required", "approved", "ready-to-execute",
  "paused", "failed", "cancelled", "completed"
]);
const JOB_FIELDS = new Set([
  "status", "mode", "sourceCount", "processedCount",
  "quarantinedCount", "errorCode"
]);

function validateJobData(data, { partial = false } = {}) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new DatabaseError(DB_ERROR_CODES.VALIDATION_FAILED, "Dati del lavoro di migrazione non validi.");
  }
  for (const key of Object.keys(data)) {
    if (!JOB_FIELDS.has(key)) {
      throw new DatabaseError(DB_ERROR_CODES.VALIDATION_FAILED, `Campo non consentito nel lavoro di migrazione: ${key}.`);
    }
  }
  if (data.status !== undefined && !JOB_STATUSES.has(data.status)) {
    throw new DatabaseError(DB_ERROR_CODES.VALIDATION_FAILED, "Stato del lavoro di migrazione non riconosciuto.");
  }
  if (data.mode !== undefined && data.mode !== "read-only") {
    throw new DatabaseError(DB_ERROR_CODES.VALIDATION_FAILED, "In questa fase sono ammessi solo lavori in sola lettura.");
  }
  for (const field of ["sourceCount", "processedCount", "quarantinedCount"]) {
    if (data[field] !== undefined && (!Number.isSafeInteger(data[field]) || data[field] < 0)) {
      throw new DatabaseError(DB_ERROR_CODES.VALIDATION_FAILED, `${field} deve essere un intero non negativo.`);
    }
  }
  if (data.errorCode !== undefined &&
      (typeof data.errorCode !== "string" || data.errorCode.length > 80 || !/^[A-Z0-9_]*$/.test(data.errorCode))) {
    throw new DatabaseError(DB_ERROR_CODES.VALIDATION_FAILED, "Codice errore non valido.");
  }
  if (!partial && data.status === undefined && data.mode !== undefined && data.mode !== "read-only") {
    throw new DatabaseError(DB_ERROR_CODES.VALIDATION_FAILED, "Modalità non valida.");
  }
}

export class MigrationJobRepository extends BaseRepository {
  constructor(options) {
    super({ ...options, storeName: "migration_jobs" });
  }

  async createJob(data = {}) {
    validateJobData(data);
    return this.create({ status: "analysis", mode: "read-only", sourceCount: 0, processedCount: 0, quarantinedCount: 0, ...data });
  }

  async updateJob(id, changes, options = {}) {
    validateJobData(changes, { partial: true });
    return this.update(id, changes, options);
  }

  getJob(id) { return this.getById(id); }
  getJobs() { return this.getAll(); }
  deleteJob(id, options = {}) { return this.delete(id, options); }
}
