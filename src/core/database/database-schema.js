export const DSM_DB_NAME = "DSM_ENTERPRISE_DB";
export const DSM_DB_VERSION = 2;

const ACCOUNT_INDEXED_STORES = Object.freeze({
  accounts: [],
  profiles: [],
  settings: [],
  shifts: [],
  absences: ["startDate", "endDate", "kind"],
  history: ["createdAt"],
  migration_jobs: ["status", "createdAt"],
  migration_quarantine: ["reason", "createdAt"]
});

function ensureIndex(store, name, keyPath, options = {}) {
  if (!store.indexNames.contains(name)) store.createIndex(name, keyPath, options);
}

function ensureAccountStore(db, transaction, name, extraIndexes = []) {
  const store = db.objectStoreNames.contains(name)
    ? transaction.objectStore(name)
    : db.createObjectStore(name, { keyPath: "id" });
  ensureIndex(store, "accountId", "accountId");
  ensureIndex(store, "accountId_id", ["accountId", "id"], { unique: true });
  for (const field of extraIndexes) ensureIndex(store, field, field);
}

export function upgradeDatabase(db, transaction, oldVersion) {
  for (const [name, indexes] of Object.entries(ACCOUNT_INDEXED_STORES)) {
    ensureAccountStore(db, transaction, name, indexes);
  }
  if (!db.objectStoreNames.contains("schema_metadata")) {
    db.createObjectStore("schema_metadata", { keyPath: "key" });
  }
  transaction.objectStore("schema_metadata").put({
    key: "schemaVersion", value: DSM_DB_VERSION,
    upgradedFrom: oldVersion, updatedAt: new Date().toISOString()
  });
}

export const DSM_OBJECT_STORES = Object.freeze([
  ...Object.keys(ACCOUNT_INDEXED_STORES), "schema_metadata"
]);
