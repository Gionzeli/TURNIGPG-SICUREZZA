import { DatabaseError, DB_ERROR_CODES } from "../database/database-errors.js";

export function requireAccountContext(accountContext) {
  if (!accountContext || typeof accountContext.requireActive !== "function") {
    throw new DatabaseError(DB_ERROR_CODES.ACCOUNT_REQUIRED, "Contesto account non disponibile.");
  }
  return accountContext.requireActive();
}

export function assertRecordAccount(record, accountId) {
  if (!record || record.accountId !== accountId) {
    throw new DatabaseError(DB_ERROR_CODES.ACCESS_DENIED, "Il record non appartiene all'account attivo.");
  }
  return record;
}
