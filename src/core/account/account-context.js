import { DatabaseError, DB_ERROR_CODES } from "../database/database-errors.js";

const ACCOUNT_ID_PATTERN = /^[A-Za-z0-9._:@_-]{1,160}$/;

export function createAccountContext() {
  let activeAccount = null;
  let disposed = false;

  return Object.freeze({
    activate({ accountId, identitySource, verifiedAt = new Date().toISOString() } = {}) {
      if (disposed) throw new DatabaseError(DB_ERROR_CODES.ACCESS_DENIED, "Contesto account dismesso definitivamente.");
      if (typeof accountId !== "string" || !ACCOUNT_ID_PATTERN.test(accountId)) {
        throw new DatabaseError(DB_ERROR_CODES.VALIDATION_FAILED, "Identificativo account non valido.");
      }

      if (identitySource !== "local") {
        throw new DatabaseError(DB_ERROR_CODES.ACCESS_DENIED, "Usare activateFirebase per identità remote.");
      }
      activeAccount = Object.freeze({ accountId, identitySource, verifiedAt });
      return activeAccount;
    },

    activateFirebase(principal) {
      if (disposed) throw new DatabaseError(DB_ERROR_CODES.ACCESS_DENIED, "Contesto account dismesso definitivamente.");
      // The adapter is the client-side trust boundary; this check prevents accidental
      // use of UI claims or incomplete objects. It is NOT a defense against same-origin
      // malicious code: server authorization must still protect every data operation.
      if (!principal || !Object.isFrozen(principal) ||
          !Object.isFrozen(principal.permissions) ||
          principal.identityProvider !== "firebase" ||
          principal.authorizationSource !== "server" ||
          typeof principal.uid !== "string" || !/^[A-Za-z0-9._:@-]{1,160}$/.test(principal.uid) ||
          typeof principal.accountId !== "string" || !ACCOUNT_ID_PATTERN.test(principal.accountId) ||
          typeof principal.role !== "string" || !/^[A-Za-z0-9._:-]{1,64}$/.test(principal.role) ||
          !Array.isArray(principal.permissions) ||
          principal.permissions.some(value => typeof value !== "string" || !value || value.length > 128) ||
          !Number.isFinite(principal.expiresAt) || principal.expiresAt <= Date.now()) {
        throw new DatabaseError(DB_ERROR_CODES.ACCESS_DENIED, "Principal Firebase non valido o scaduto.");
      }
      activeAccount = Object.freeze({
        accountId: principal.accountId,
        identitySource: "firebase",
        uid: principal.uid,
        role: principal.role,
        permissions: Object.freeze([...principal.permissions]),
        verifiedAt: new Date().toISOString(),
        expiresAt: principal.expiresAt
      });
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
    },

    dispose() {
      disposed = true;
      activeAccount = null;
    }
  });
}
