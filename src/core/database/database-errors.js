export class DatabaseError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "DatabaseError";
    this.code = code;
  }
}

export const DB_ERROR_CODES = Object.freeze({
  UNAVAILABLE: "DB_UNAVAILABLE",
  OPEN_FAILED: "DB_OPEN_FAILED",
  VERSION_ERROR: "DB_VERSION_ERROR",
  BLOCKED: "DB_UPGRADE_BLOCKED",
  TRANSACTION_FAILED: "DB_TRANSACTION_FAILED",
  QUOTA_EXCEEDED: "DB_QUOTA_EXCEEDED",
  ACCOUNT_REQUIRED: "DB_ACCOUNT_REQUIRED",
  ACCESS_DENIED: "DB_ACCESS_DENIED",
  VALIDATION_FAILED: "DB_VALIDATION_FAILED",
  RECORD_NOT_FOUND: "DB_RECORD_NOT_FOUND",
  REVISION_CONFLICT: "DB_REVISION_CONFLICT"
});

export function toDatabaseError(error, fallbackCode = DB_ERROR_CODES.TRANSACTION_FAILED) {
  if (error instanceof DatabaseError) return error;

  if (error?.name === "QuotaExceededError") {
    return new DatabaseError(DB_ERROR_CODES.QUOTA_EXCEEDED, "Spazio locale insufficiente.", { cause: error });
  }

  if (error?.name === "VersionError") {
    return new DatabaseError(DB_ERROR_CODES.VERSION_ERROR, "La versione del database non è compatibile.", { cause: error });
  }

  return new DatabaseError(fallbackCode, "Operazione sul database non riuscita.", { cause: error });
}
