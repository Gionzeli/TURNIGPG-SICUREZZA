import { DatabaseError, DB_ERROR_CODES, toDatabaseError } from "../database/database-errors.js";
import { requireAccountContext } from "../account/account-guard.js";
import { requestToPromise, transactionToPromise, abortTransaction } from "../database/database-transactions.js";

const RESERVED_FIELDS = new Set(["id", "accountId", "createdAt", "updatedAt", "revision", "schemaVersion"]);

function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    return [...bytes].map(value => value.toString(16).padStart(2, "0")).join("");
  }
  throw new DatabaseError(DB_ERROR_CODES.UNAVAILABLE, "Generatore casuale sicuro non disponibile.");
}

function historyEntityType(storeName) {
  if (storeName === "shifts") return "shift";
  if (storeName === "profiles") return "profile";
  if (storeName === "settings") return "setting";
  return null;
}

function createHistoryRecord({ accountId, entityType, entityId, action, previousRevision, newRevision, now }) {
  const data = { entityType, entityId, action };
  if (previousRevision !== undefined) data.previousRevision = previousRevision;
  if (newRevision !== undefined) data.newRevision = newRevision;
  return {
    id: createId(), accountId, createdAt: now, updatedAt: now,
    revision: 1, schemaVersion: 1, data
  };
}

function validateId(id) {
  if (typeof id !== "string" || !id.trim() || id.length > 200) {
    throw new DatabaseError(DB_ERROR_CODES.VALIDATION_FAILED, "ID record non valido.");
  }
}

function validateData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new DatabaseError(DB_ERROR_CODES.VALIDATION_FAILED, "Il contenuto del record deve essere un oggetto.");
  }
  for (const key of RESERVED_FIELDS) {
    if (Object.hasOwn(data, key)) {
      throw new DatabaseError(DB_ERROR_CODES.VALIDATION_FAILED, `Il campo ${key} è gestito dal repository.`);
    }
  }
}

export class BaseRepository {
  constructor({ db, accountContext, storeName, clock = () => new Date().toISOString() }) {
    if (!db || !storeName) throw new DatabaseError(DB_ERROR_CODES.VALIDATION_FAILED, "Database e object store sono obbligatori.");
    if (!db.objectStoreNames.contains(storeName)) throw new DatabaseError(DB_ERROR_CODES.VALIDATION_FAILED, `Object store non disponibile: ${storeName}.`);
    this.db = db;
    this.accountContext = accountContext;
    this.storeName = storeName;
    this.clock = clock;
  }

  async create(data, options = {}) {
    const { accountId } = requireAccountContext(this.accountContext);
    validateData(data);
    const id = options.id === undefined ? createId() : options.id;
    validateId(id);
    const now = this.clock();
    const record = { id, accountId, createdAt: now, updatedAt: now, revision: 1, schemaVersion: 1, data: { ...data } };
    const entityType = historyEntityType(this.storeName);
    const storeNames = entityType ? [this.storeName, "history"] : [this.storeName];
    const transaction = this.db.transaction(storeNames, "readwrite");
    const done = transactionToPromise(transaction);
    const request = transaction.objectStore(this.storeName).add(record);
    if (entityType) {
      transaction.objectStore("history").add(createHistoryRecord({
        accountId, entityType, entityId: id, action: "create",
        newRevision: 1, now
      }));
    }
    try {
      await requestToPromise(request);
      await done;
      return record;
    } catch (error) {
      abortTransaction(transaction);
      await done.catch(() => {});
      throw toDatabaseError(error);
    }
  }

  async getById(id) {
    const { accountId } = requireAccountContext(this.accountContext);
    validateId(id);
    const transaction = this.db.transaction([this.storeName], "readonly");
    const done = transactionToPromise(transaction);
    const request = transaction.objectStore(this.storeName).index("accountId_id").get([accountId, id]);
    try {
      const record = await requestToPromise(request);
      await done;
      return record || null;
    } catch (error) { throw toDatabaseError(error); }
  }

  async getAll() {
    const { accountId } = requireAccountContext(this.accountContext);
    const transaction = this.db.transaction([this.storeName], "readonly");
    const done = transactionToPromise(transaction);
    const request = transaction.objectStore(this.storeName).index("accountId").getAll(accountId);
    try {
      const records = await requestToPromise(request);
      await done;
      return records;
    } catch (error) { throw toDatabaseError(error); }
  }

  async update(id, changes, options = {}) {
    const { accountId } = requireAccountContext(this.accountContext);
    validateId(id);
    validateData(changes);
    const expectedRevision = options.expectedRevision;
    if (expectedRevision !== undefined && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)) {
      throw new DatabaseError(DB_ERROR_CODES.VALIDATION_FAILED, "expectedRevision deve essere un intero positivo.");
    }

    const entityType = historyEntityType(this.storeName);
    const storeNames = entityType ? [this.storeName, "history"] : [this.storeName];
    const transaction = this.db.transaction(storeNames, "readwrite");
    const done = transactionToPromise(transaction);
    const store = transaction.objectStore(this.storeName);
    const historyStore = entityType ? transaction.objectStore("history") : null;
    const request = store.index("accountId_id").get([accountId, id]);
    let updated = null;
    let operationError = null;

    request.onsuccess = () => {
      const current = request.result;
      if (!current) return;
      if (expectedRevision !== undefined && current.revision !== expectedRevision) {
        operationError = new DatabaseError(DB_ERROR_CODES.REVISION_CONFLICT, "Il record è stato modificato da un'altra operazione. Ricaricare i dati prima di riprovare.");
        abortTransaction(transaction);
        return;
      }
      updated = {
        ...current,
        updatedAt: this.clock(),
        revision: current.revision + 1,
        data: { ...current.data, ...changes }
      };
      store.put(updated);
      if (historyStore) {
        historyStore.add(createHistoryRecord({
          accountId, entityType, entityId: id, action: "update",
          previousRevision: current.revision, newRevision: updated.revision,
          now: updated.updatedAt
        }));
      }
    };

    try {
      await done;
      return updated;
    } catch (error) {
      abortTransaction(transaction);
      await done.catch(() => {});
      if (operationError) throw operationError;
      throw toDatabaseError(error);
    }
  }

  async delete(id, options = {}) {
    const { accountId } = requireAccountContext(this.accountContext);
    validateId(id);
    const expectedRevision = options.expectedRevision;
    if (expectedRevision !== undefined && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)) {
      throw new DatabaseError(DB_ERROR_CODES.VALIDATION_FAILED, "expectedRevision deve essere un intero positivo.");
    }

    const entityType = historyEntityType(this.storeName);
    const storeNames = entityType ? [this.storeName, "history"] : [this.storeName];
    const transaction = this.db.transaction(storeNames, "readwrite");
    const done = transactionToPromise(transaction);
    const store = transaction.objectStore(this.storeName);
    const historyStore = entityType ? transaction.objectStore("history") : null;
    const request = store.index("accountId_id").get([accountId, id]);
    let deleted = false;
    let operationError = null;
    request.onsuccess = () => {
      const current = request.result;
      if (!current) return;
      if (expectedRevision !== undefined && current.revision !== expectedRevision) {
        operationError = new DatabaseError(DB_ERROR_CODES.REVISION_CONFLICT, "Il record è stato modificato da un'altra operazione. Ricaricare i dati prima di riprovare.");
        abortTransaction(transaction);
        return;
      }
      store.delete(id);
      if (historyStore) {
        historyStore.add(createHistoryRecord({
          accountId, entityType, entityId: id, action: "delete",
          previousRevision: current.revision, now: this.clock()
        }));
      }
      deleted = true;
    };
    try {
      await done;
      return deleted;
    } catch (error) {
      abortTransaction(transaction);
      await done.catch(() => {});
      if (operationError) throw operationError;
      throw toDatabaseError(error);
    }
  }
}
