import {
  openDSMDatabase, closeDSMDatabase, getDSMDatabaseStatus,
  createAccountContext, ProfileRepository, ShiftRepository, ProfileService, ShiftService, DB_ERROR_CODES
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

  await test("DB-000 — nome database vuoto rifiutato senza fallback", async () => {
    let caught;
    try { await openDSMDatabase({ name: "" }); } catch (error) { caught = error; }
    assert(caught?.code === DB_ERROR_CODES.VALIDATION_FAILED, "Nome vuoto non rifiutato.");
    assert(!getDSMDatabaseStatus().isOpen, "Un database è stato aperto durante la validazione.");
  });

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
    const updated = await profiles.update(createdProfileId, { displayName: "Profilo aggiornato" }, { expectedRevision: 1 });
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

  await test("DB-010 — conflitto revisione obsoleta", async () => {
    const record = await profiles.create({ value: "iniziale" });
    const first = await profiles.update(record.id, { value: "prima modifica" }, { expectedRevision: 1 });
    assert(first.revision === 2, "Prima modifica non ha incrementato la revisione.");
    let caught;
    try { await profiles.update(record.id, { value: "modifica obsoleta" }, { expectedRevision: 1 }); } catch (error) { caught = error; }
    assert(caught?.code === DB_ERROR_CODES.REVISION_CONFLICT, "Conflitto di revisione non rilevato.");
    const persisted = await profiles.getById(record.id);
    assert(persisted.revision === 2 && persisted.data.value === "prima modifica", "Il dato originale è stato sovrascritto.");
  });
  await test("DB-011 — ID vuoti e revisione attesa invalida", async () => {
    let badId, badRevision;
    try { await profiles.getById(""); } catch (error) { badId = error; }
    try { await profiles.update(createdProfileId, { safe: true }, { expectedRevision: 0 }); } catch (error) { badRevision = error; }
    assert(badId?.code === DB_ERROR_CODES.VALIDATION_FAILED, "ID vuoto accettato.");
    assert(badRevision?.code === DB_ERROR_CODES.VALIDATION_FAILED, "Revisione attesa non valida accettata.");
  });
  await test("DB-012 — aggiornamento record inesistente", async () => {
    const missing = await profiles.update("missing-test-record", { value: "x" }, { expectedRevision: 1 });
    assert(missing === null, "Update inesistente non restituisce null.");
  });


  await test("DB-013 — due aggiornamenti concorrenti sulla stessa revisione", async () => {
    const record = await profiles.create({ value: "base concorrente" });
    const outcomes = await Promise.allSettled([
      profiles.update(record.id, { value: "scrittura A" }, { expectedRevision: 1 }),
      profiles.update(record.id, { value: "scrittura B" }, { expectedRevision: 1 })
    ]);
    const fulfilled = outcomes.filter(item => item.status === "fulfilled");
    const rejected = outcomes.filter(item => item.status === "rejected");
    assert(fulfilled.length === 1 && rejected.length === 1, "Non è stata accettata esattamente una scrittura.");
    assert(rejected[0].reason?.code === DB_ERROR_CODES.REVISION_CONFLICT, "La seconda scrittura non ha ricevuto conflitto.");
    const persisted = await profiles.getById(record.id);
    assert(persisted.revision === 2, "Revisione finale non coerente.");
    assert(["scrittura A", "scrittura B"].includes(persisted.data.value), "Valore finale inatteso.");
  });

  await test("DB-014 — delete protetto da revisione attesa", async () => {
    const record = await profiles.create({ value: "da proteggere" });
    const updated = await profiles.update(record.id, { value: "modificato" }, { expectedRevision: 1 });
    assert(updated.revision === 2, "Revisione non incrementata prima del delete.");
    let caught;
    try { await profiles.delete(record.id, { expectedRevision: 1 }); } catch (error) { caught = error; }
    assert(caught?.code === DB_ERROR_CODES.REVISION_CONFLICT, "Delete con revisione obsoleta non bloccato.");
    assert((await profiles.getById(record.id))?.revision === 2, "Il record è stato cancellato da una richiesta obsoleta.");
    assert(await profiles.delete(record.id, { expectedRevision: 2 }), "Delete con revisione corrente non riuscito.");
    assert(await profiles.getById(record.id) === null, "Record ancora presente dopo delete valido.");
  });

  await test("SVC-001 — profilo normalizzato con valori predefiniti", async () => {
    const service = new ProfileService({ repository: profiles });
    const record = await service.create({ params: { paga_base: 1250 }, profile: { ccnl: "Servizi" } });
    assert(record.data.params.paga_base === 1250 && record.data.params.ore_turno === 7.25, "Parametri profilo non normalizzati.");
    assert(record.data.profile.ccnl === "Servizi" && record.data.profile.role === "", "Dati profilo non normalizzati.");
  });

  await test("SVC-002 — profilo rifiuta percentuali e campi non validi", async () => {
    const service = new ProfileService({ repository: profiles });
    let badPercent, badField, badPatch;
    try { await service.create({ params: { irpef_rate: 101 } }); } catch (error) { badPercent = error; }
    try { await service.create({ profile: { admin: true } }); } catch (error) { badField = error; }
    try {
      const record = await service.create({});
      await service.update(record.id, { unexpected: true }, { expectedRevision: 1 });
    } catch (error) { badPatch = error; }
    assert(badPercent?.code === DB_ERROR_CODES.VALIDATION_FAILED, "Percentuale oltre 100 accettata.");
    assert(badField?.code === DB_ERROR_CODES.VALIDATION_FAILED, "Campo profilo sconosciuto accettato.");
    assert(badPatch?.code === DB_ERROR_CODES.VALIDATION_FAILED, "Patch profilo sconosciuta accettata.");
  });

  await test("SVC-003 — aggiornamento profilo richiede revisione e conserva sezioni", async () => {
    const service = new ProfileService({ repository: profiles });
    const record = await service.create({ params: { paga_base: 1000 }, profile: { ccnl: "A" } });
    let missingRevision;
    try { await service.update(record.id, { profile: { role: "Operatore" } }); } catch (error) { missingRevision = error; }
    assert(missingRevision?.code === DB_ERROR_CODES.VALIDATION_FAILED, "Aggiornamento senza revisione attesa accettato.");
    const updated = await service.update(record.id, { profile: { role: "Operatore" } }, { expectedRevision: 1 });
    assert(updated.revision === 2 && updated.data.params.paga_base === 1000, "Aggiornamento non ha conservato i parametri.");
    assert(updated.data.profile.ccnl === "A" && updated.data.profile.role === "Operatore", "Merge dei dati profilo errato.");
  });

  await test("SVC-004 — turno valido normalizzato e orari verificati", async () => {
    const service = new ShiftService({ repository: shifts });
    const record = await service.create({ date: "2026-11-22", type: "turno", start_time: "08:30", end_time: "16:00", hours: 7.5 });
    assert(record.data.date === "2026-11-22" && record.data.start_time === "08:30", "Data o orario valido rifiutato.");
    assert(record.data.is_night === false && record.data.post === "", "Valori predefiniti turno errati.");
  });

  await test("SVC-005 — turno rifiuta data, orario e flag non validi", async () => {
    const service = new ShiftService({ repository: shifts });
    let badDate, badTime, badFlag;
    try { await service.create({ date: "2026-02-30", type: "turno" }); } catch (error) { badDate = error; }
    try { await service.create({ date: "2026-11-22", type: "turno", start_time: "25:90" }); } catch (error) { badTime = error; }
    try { await service.create({ date: "2026-11-22", type: "turno", is_night: "yes" }); } catch (error) { badFlag = error; }
    assert(badDate?.code === DB_ERROR_CODES.VALIDATION_FAILED, "Data inesistente accettata.");
    assert(badTime?.code === DB_ERROR_CODES.VALIDATION_FAILED, "Orario impossibile accettato.");
    assert(badFlag?.code === DB_ERROR_CODES.VALIDATION_FAILED, "Flag non booleano accettato.");
  });

  await test("SVC-006 — aggiornamento turno con conflitto revisione", async () => {
    const service = new ShiftService({ repository: shifts });
    const record = await service.create({ date: "2026-11-22", type: "turno", hours: 7 });
    const updated = await service.update(record.id, { hours: 8 }, { expectedRevision: 1 });
    assert(updated.revision === 2 && updated.data.hours === 8, "Aggiornamento turno non riuscito.");
    let conflict;
    try { await service.update(record.id, { hours: 9 }, { expectedRevision: 1 }); } catch (error) { conflict = error; }
    assert(conflict?.code === DB_ERROR_CODES.REVISION_CONFLICT, "Conflitto turno non rilevato.");
    assert((await service.getById(record.id)).data.hours === 8, "Scrittura obsoleta ha alterato il turno.");
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
