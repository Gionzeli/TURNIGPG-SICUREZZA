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

function validationError(message) {
  return new DatabaseError(DB_ERROR_CODES.VALIDATION_FAILED, message);
}

function validateJobData(data, { partial = false } = {}) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw validationError("Dati del lavoro di migrazione non validi.");
  }
  for (const key of Object.keys(data)) {
    if (!JOB_FIELDS.has(key)) {
      throw validationError(`Campo non consentito nel lavoro di migrazione: ${key}.`);
    }
  }
  if (data.status !== undefined && !JOB_STATUSES.has(data.status)) {
    throw validationError("Stato del lavoro di migrazione non riconosciuto.");
  }
  if (data.mode !== undefined && data.mode !== "read-only") {
    throw validationError("In questa fase sono ammessi solo lavori in sola lettura.");
  }
  for (const field of ["sourceCount", "processedCount", "quarantinedCount"]) {
    if (data[field] !== undefined && (!Number.isSafeInteger(data[field]) || data[field] < 0)) {
      throw validationError(`${field} deve essere un intero non negativo.`);
    }
  }
  if (data.errorCode !== undefined &&
      (typeof data.errorCode !== "string" || data.errorCode.length > 80 || !/^[A-Z0-9_]*$/.test(data.errorCode))) {
    throw validationError("Codice errore non valido.");
  }
  if (!partial && data.status !== undefined && data.status !== "analysis") {
    throw validationError("Un nuovo job deve iniziare dallo stato analysis.");
  }
}

const JOB_TRANSITIONS = new Map([
  ["analysis", new Set(["review-required", "paused", "failed", "cancelled"])],
  ["review-required", new Set(["paused", "failed", "cancelled"])],
  ["paused", new Set(["review-required", "failed", "cancelled"])],
  ["approved", new Set()],
  ["ready-to-execute", new Set()],
  ["failed", new Set()],
  ["cancelled", new Set()],
  ["completed", new Set()]
]);

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
    return this.updateWithCurrent(id, current => {
      if (changes.status !== undefined && changes.status !== current.data.status) {
        const allowed = JOB_TRANSITIONS.get(current.data.status);
        if (!allowed?.has(changes.status)) throw validationError("Transizione di stato del job non consentita in modalità sola lettura.");
      }
      return { ...current.data, ...changes };
    }, options);
  }

  getJob(id) { return this.getById(id); }
  getJobs() { return this.getAll(); }
  deleteJob(id, options = {}) { return this.delete(id, options); }
}
