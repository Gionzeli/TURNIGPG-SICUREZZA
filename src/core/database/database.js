import { DatabaseError, DB_ERROR_CODES, toDatabaseError } from "./database-errors.js";
import { DSM_DB_NAME, DSM_DB_VERSION, upgradeDatabase } from "./database-schema.js";

let openPromise = null;
let activeDatabase = null;
let activeDatabaseName = DSM_DB_NAME;

export function openDSMDatabase(options = {}) {
  if (activeDatabase) return Promise.resolve(activeDatabase);
  if (openPromise) return openPromise;

  const databaseName = options.name || DSM_DB_NAME;
  if (typeof databaseName !== "string" || !databaseName.trim()) {
    return Promise.reject(new DatabaseError(DB_ERROR_CODES.VALIDATION_FAILED, "Il nome del database deve essere una stringa non vuota."));
  }
  if (!globalThis.indexedDB) {
    return Promise.reject(new DatabaseError(DB_ERROR_CODES.UNAVAILABLE, "IndexedDB non è disponibile in questo ambiente."));
  }

  openPromise = new Promise((resolve, reject) => {
    let request;
    try {
      request = globalThis.indexedDB.open(databaseName, DSM_DB_VERSION);
    } catch (error) {
      reject(toDatabaseError(error, DB_ERROR_CODES.OPEN_FAILED));
      return;
    }

    request.onupgradeneeded = event => {
      try { upgradeDatabase(request.result, request.transaction, event.oldVersion); }
      catch (error) {
        try { request.transaction.abort(); } catch {}
        reject(toDatabaseError(error, DB_ERROR_CODES.VERSION_ERROR));
      }
    };
    request.onblocked = () => options.onBlocked?.();
    request.onerror = () => reject(toDatabaseError(request.error, DB_ERROR_CODES.OPEN_FAILED));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        if (activeDatabase === db) activeDatabase = null;
        openPromise = null;
        activeDatabaseName = DSM_DB_NAME;
      };
      db.onclose = () => {
        if (activeDatabase === db) activeDatabase = null;
        openPromise = null;
        activeDatabaseName = DSM_DB_NAME;
      };
      activeDatabase = db;
      activeDatabaseName = databaseName;
      resolve(db);
    };
  }).catch(error => {
    openPromise = null;
    throw error;
  });
  return openPromise;
}

export function closeDSMDatabase() {
  if (activeDatabase) activeDatabase.close();
  activeDatabase = null;
  openPromise = null;
  activeDatabaseName = DSM_DB_NAME;
}

export function getDSMDatabaseStatus() {
  return Object.freeze({ name: activeDatabaseName, version: DSM_DB_VERSION, isOpen: Boolean(activeDatabase) });
}
