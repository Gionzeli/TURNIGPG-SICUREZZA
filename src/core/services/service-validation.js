import { DatabaseError, DB_ERROR_CODES } from "../database/database-errors.js";

export function validationError(message) {
  throw new DatabaseError(DB_ERROR_CODES.VALIDATION_FAILED, message);
}

export function requirePlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    validationError(`${label} deve essere un oggetto semplice.`);
  }
  return value;
}

export function validateDate(value, label = "Data") {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) validationError(`${label} non valida.`);
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    validationError(`${label} inesistente.`);
  }
  return value;
}

export function validateExpectedRevision(options = {}) {
  const revision = options.expectedRevision;
  if (!Number.isSafeInteger(revision) || revision < 1) validationError("expectedRevision è obbligatoria e deve essere un intero positivo.");
  return revision;
}
