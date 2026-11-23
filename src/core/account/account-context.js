import { DatabaseError, DB_ERROR_CODES } from "../database/database-errors.js";

const ACCOUNT_ID_PATTERN = /^[A-Za-z0-9._:@-]{1,160}$/;

export function createAccountContext() {
  let activeAccount = null;

  return Object.freeze({
    activate({ accountId, identitySource, verifiedAt = new Date().toISOString() } = {}) {
      if (typeof accountId !== "string" || !ACCOUNT_ID_PATTERN.test(accountId)) {
        throw new DatabaseError(DB_ERROR_CODES.VALIDATION_FAILED, "Identificativo account non valido.");
      }

      // This client-side context cannot verify Firebase credentials. Until a
      // trusted authentication adapter exists, only local/demo contexts are allowed.
      if (identitySource !== "local") {
        throw new DatabaseError(DB_ERROR_CODES.ACCESS_DENIED, "Identità remota non verificabile da questo contesto locale.");
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
