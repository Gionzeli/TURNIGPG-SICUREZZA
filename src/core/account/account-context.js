import { DatabaseError, DB_ERROR_CODES } from "../database/database-errors.js";

const ACCOUNT_ID_PATTERN = /^[A-Za-z0-9._:@-]{1,160}$/;

export function createAccountContext() {
  let activeAccount = null;

  return Object.freeze({
    activate({ accountId, identitySource, verifiedAt = new Date().toISOString() } = {}) {
      if (typeof accountId !== "string" || !ACCOUNT_ID_PATTERN.test(accountId)) {
        throw new DatabaseError(DB_ERROR_CODES.VALIDATION_FAILED, "Identificativo account non valido.");
      }

      if (!["local", "firebase_verified"].includes(identitySource)) {
        throw new DatabaseError(DB_ERROR_CODES.ACCESS_DENIED, "Origine dell'identità non riconosciuta.");
      }

      activeAccount = Object.freeze({ accountId, identitySource, verifiedAt });
      return activeAccount;
    },

    getActive() {
      return activeAccount;
    },

    requireActive() {
      if (!activeAccount) {
        throw new DatabaseError(DB_ERROR_CODES.ACCOUNT_REQUIRED, "Nessun account attivo.");
      }
      return activeAccount;
    },

    clear() {
      activeAccount = null;
    }
  });
}
