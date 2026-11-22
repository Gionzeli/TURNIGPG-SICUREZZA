import {
  openDSMDatabase, closeDSMDatabase, getDSMDatabaseStatus,
  createAccountContext, ProfileRepository, ShiftRepository, DB_ERROR_CODES
} from "../../src/core/database/index.js";

const TEST_DB_NAME = "DSM_ENTERPRISE_TEST_DB";
const summary = document.querySelector("#summary");
const results = document.querySelector("#results");
let passed = 0, failed = 0, db, profiles, shifts, createdProfileId, createdShiftId;

function assert(condition, message) { if (!condition) throw new Error(message); }

async function deleteTestDatabase() {
  closeDSMDatabase();
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(TEST_DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error("Eliminazione database test fallita."));
    request.onblocked = () => reject(new Error("Eliminazione bloccata: chiudere altre schede che usano il DB test."));
  });
}

async function test(name, callback) {
  const item = document.createElement("li");
  item.textContent = name;
  results.append(item);
  try {
    await callback();
    item.className = "pass"; item.textContent += " — PASS"; passed++;
  } catch (error) {
    item.className = "fail"; item.textContent += ` — FAIL: ${error?.message || error}`; failed++;
  }
  summary.textContent = `${passed} superati · ${failed} falliti`;
}

async function run() {
  try { await deleteTestDatabase(); }
  catch (error) {
    summary.textContent = `Avvio bloccato: ${error.message}`; summary.dataset.result = "fail"; return;
  }
  const context = createAccountContext();

  await test("DB-001 — apertura database di test isolato", async () => {
    db = await openDSMDatabase({ name: TEST_DB_NAME });
    assert(db.name === TEST_DB_NAME, "Database diverso da quello test.");
    assert(db instanceof IDBDatabase, "Non è un IDBDatabase.");
    assert(getDSMDatabaseStatus().isOpen && getDSMDatabaseStatus().name === TEST_DB_NAME, "Status DB non coerente.");
  });
  await test("DB-002 — object store previsti", async () => {
    for (const name of ["accounts","profiles","settings","shifts","history","migration_jobs","migration_quarantine","schema_metadata"])
      assert(db.objectStoreNames.contains(name), `Object store mancante: ${name}`);
  });
  await test("DB-003 — blocco senza account attivo", async () => {
    profiles = new ProfileRepository({ db, accountContext: context });
    let caught; try { await profiles.getAll(); } catch (error) { caught = error; }
    assert(caught?.code === DB_ERROR_CODES.ACCOUNT_REQUIRED, "Operazione anonima non bloccata.");
  });
  await test("DB-004 — crea e legge profilo account A", async () => {
    context.activate({ accountId: "browser-test-account-A", identitySource: "local" });
    profiles = new ProfileRepository({ db, accountContext: context });
    const record = await profiles.create({ displayName: "Profilo test browser" });
    createdProfileId = record.id;
    assert(record.accountId === "browser-test-account-A", "Account ID errato.");
    assert((await profiles.getById(record.id))?.data.displayName === "Profilo test browser", "Lettura errata.");
  });
  await test("DB-005 — update, revision e delete", async () => {
    const updated = await profiles.update(createdProfileId, { displayName: "Profilo aggiornato" });
    assert(updated?.revision === 2 && updated.data.displayName === "Profilo aggiornato", "Update/revision errati.");
    assert(await profiles.delete(createdProfileId), "Delete non true.");
    assert(await profiles.getById(createdProfileId) === null, "Record cancellato ancora presente.");
  });
  await test("DB-006 — isolamento account A/B", async () => {
    const record = await profiles.create({ displayName: "Privato account A" }); createdProfileId = record.id;
    context.activate({ accountId: "browser-test-account-B", identitySource: "local" });
    assert(await profiles.getById(createdProfileId) === null, "B legge un record di A.");
    assert((await profiles.getAll()).length === 0, "B vede dati di A.");
    context.activate({ accountId: "browser-test-account-A", identitySource: "local" });
    assert((await profiles.getById(createdProfileId))?.accountId === "browser-test-account-A", "A non ritrova il suo record.");
  });
  await test("DB-007 — turno e persistenza dopo riapertura", async () => {
    shifts = new ShiftRepository({ db, accountContext: context });
    createdShiftId = (await shifts.create({ date: "2099-01-01", type: "TEST" })).id;
    closeDSMDatabase();
    db = await openDSMDatabase({ name: TEST_DB_NAME });
    profiles = new ProfileRepository({ db, accountContext: context });
    shifts = new ShiftRepository({ db, accountContext: context });
    assert((await shifts.getById(createdShiftId))?.data.type === "TEST", "Turno non persistito.");
    assert(await profiles.getById(createdProfileId) !== null, "Profilo non persistito.");
  });
  await test("DB-008 — ID duplicato preserva record originale", async () => {
    const id = `duplicate-${crypto.randomUUID()}`;
    await profiles.create({ marker: "first" }, { id });
    let caught; try { await profiles.create({ marker: "second" }, { id }); } catch (error) { caught = error; }
    assert(Boolean(caught), "ID duplicato non ha prodotto errore.");
    assert((await profiles.getById(id))?.data.marker === "first", "Record originale alterato.");
  });
  await test("DB-009 — campi riservati rifiutati", async () => {
    let caught; try { await profiles.create({ accountId: "browser-test-account-B" }); } catch (error) { caught = error; }
    assert(caught?.code === DB_ERROR_CODES.VALIDATION_FAILED, "accountId non rifiutato.");
  });

  try {
    await deleteTestDatabase();
    const item = document.createElement("li"); item.textContent = "DB-CLEANUP — database test eliminato — PASS"; item.className = "pass"; results.append(item);
  } catch (error) {
    failed++; const item = document.createElement("li"); item.textContent = `DB-CLEANUP — FAIL: ${error.message}`; item.className = "fail"; results.append(item);
  }
  summary.textContent = `Completato: ${passed} superati · ${failed} falliti`;
  summary.dataset.result = failed === 0 ? "pass" : "fail";
}
run();
