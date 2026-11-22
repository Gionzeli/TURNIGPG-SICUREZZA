import {
  openDSMDatabase,
  closeDSMDatabase,
  getDSMDatabaseStatus,
  createAccountContext,
  ProfileRepository,
  ShiftRepository,
  DB_ERROR_CODES
} from "../../src/core/database/index.js";

const summary = document.querySelector("#summary");
const results = document.querySelector("#results");
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function test(name, callback) {
  const item = document.createElement("li");
  item.textContent = name;
  results.append(item);
  try {
    await callback();
    item.className = "pass";
    item.textContent += " — PASS";
    passed += 1;
  } catch (error) {
    item.className = "fail";
    item.textContent += ` — FAIL: ${error?.message || error}`;
    failed += 1;
  }
  summary.textContent = `${passed} superati · ${failed} falliti`;
}

const context = createAccountContext();
let db;
let profiles;
let shifts;
let createdProfileId;
let createdShiftId;

await test("DB-001 — apertura IndexedDB e stato", async () => {
  db = await openDSMDatabase();
  assert(db instanceof IDBDatabase, "Il risultato non è un IDBDatabase.");
  assert(getDSMDatabaseStatus().isOpen, "Lo stato non segnala il database aperto.");
});

await test("DB-002 — creazione e presenza degli object store", async () => {
  const required = [
    "accounts", "profiles", "settings", "shifts", "history",
    "migration_jobs", "migration_quarantine", "schema_metadata"
  ];
  for (const name of required) {
    assert(db.objectStoreNames.contains(name), `Object store mancante: ${name}`);
  }
});

await test("DB-003 — blocco operazioni senza account attivo", async () => {
  profiles = new ProfileRepository({ db, accountContext: context });
  let caught;
  try { await profiles.getAll(); } catch (error) { caught = error; }
  assert(caught?.code === DB_ERROR_CODES.ACCOUNT_REQUIRED, "L'accesso senza account non è stato bloccato.");
});

await test("DB-004 — creazione e lettura profilo account A", async () => {
  context.activate({ accountId: "browser-test-account-A", identitySource: "local" });
  profiles = new ProfileRepository({ db, accountContext: context });
  const record = await profiles.create({ displayName: "Profilo test browser" });
  createdProfileId = record.id;
  assert(record.accountId === "browser-test-account-A", "Account ID non assegnato dal contesto.");
  assert((await profiles.getById(record.id))?.data.displayName === "Profilo test browser", "Il profilo non è stato letto correttamente.");
});

await test("DB-005 — aggiornamento, revisione e cancellazione", async () => {
  const updated = await profiles.update(createdProfileId, { displayName: "Profilo aggiornato" });
  assert(updated?.revision === 2, "La revisione non è stata incrementata.");
  assert(updated.data.displayName === "Profilo aggiornato", "I dati aggiornati non corrispondono.");
  assert(await profiles.delete(createdProfileId), "La cancellazione non ha restituito true.");
  assert((await profiles.getById(createdProfileId)) === null, "Il record cancellato è ancora presente.");
});

await test("DB-006 — isolamento tra account", async () => {
  const record = await profiles.create({ displayName: "Privato account A" });
  createdProfileId = record.id;
  context.activate({ accountId: "browser-test-account-B", identitySource: "local" });
  assert((await profiles.getById(createdProfileId)) === null, "Account B ha letto il record di A.");
  assert((await profiles.getAll()).length === 0, "Account B vede record appartenenti ad A.");
  context.activate({ accountId: "browser-test-account-A", identitySource: "local" });
  assert((await profiles.getById(createdProfileId))?.accountId === "browser-test-account-A", "Il record di A non è più accessibile ad A.");
});

await test("DB-007 — creazione turno e persistenza dopo riapertura", async () => {
  shifts = new ShiftRepository({ db, accountContext: context });
  const shift = await shifts.create({ date: "2099-01-01", type: "TEST" });
  createdShiftId = shift.id;
  closeDSMDatabase();
  db = await openDSMDatabase();
  profiles = new ProfileRepository({ db, accountContext: context });
  shifts = new ShiftRepository({ db, accountContext: context });
  assert((await shifts.getById(createdShiftId))?.data.type === "TEST", "Il turno non persiste dopo la riapertura.");
  assert((await profiles.getById(createdProfileId)) !== null, "Il profilo non persiste dopo la riapertura.");
});

await test("DB-008 — errore su ID duplicato senza corrompere la transazione", async () => {
  const id = `duplicate-${crypto.randomUUID()}`;
  await profiles.create({ marker: "first" }, { id });
  let caught;
  try { await profiles.create({ marker: "second" }, { id }); } catch (error) { caught = error; }
  assert(Boolean(caught), "L'ID duplicato non ha prodotto un errore.");
  assert((await profiles.getById(id))?.data.marker === "first", "Il record originale è stato alterato.");
});

await test("DB-009 — rifiuto dei campi riservati", async () => {
  let caught;
  try { await profiles.create({ accountId: "browser-test-account-B" }); } catch (error) { caught = error; }
  assert(caught?.code === DB_ERROR_CODES.VALIDATION_FAILED, "Il campo accountId non è stato rifiutato.");
});

closeDSMDatabase();
summary.textContent = `Completato: ${passed} superati · ${failed} falliti`;
summary.dataset.result = failed === 0 ? "pass" : "fail";
