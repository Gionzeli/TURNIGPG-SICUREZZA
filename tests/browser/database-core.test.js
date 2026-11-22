import {
  openDSMDatabase, closeDSMDatabase, getDSMDatabaseStatus,
  createAccountContext, ProfileRepository, ShiftRepository, ProfileService, ShiftService, inspectLegacySnapshot, inspectLegacyExtras, inspectLegacyArchive, inspectLegacyReconciliation, inspectLegacyExport, inspectLegacyShiftChronology, DB_ERROR_CODES
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

  await test("SVC-007 — isolamento account applicato anche ai servizi", async () => {
    const service = new ProfileService({ repository: profiles });
    const record = await service.create({ profile: { role: "Privato A" } });
    context.activate({ accountId: "browser-test-account-B", identitySource: "local" });
    assert(await service.getById(record.id) === null, "Il servizio ha esposto il profilo di A all'account B.");
    assert((await service.getAll()).length === 0, "Il servizio ha restituito profili di un altro account.");
    context.activate({ accountId: "browser-test-account-A", identitySource: "local" });
    assert((await service.getById(record.id))?.data.profile.role === "Privato A", "Account A non ritrova il proprio profilo.");
  });

  await test("SVC-008 — delete servizio richiede revisione corrente", async () => {
    const service = new ShiftService({ repository: shifts });
    const record = await service.create({ date: "2026-11-22", type: "turno", hours: 7 });
    const updated = await service.update(record.id, { hours: 7.5 }, { expectedRevision: 1 });
    let conflict, missingRevision;
    try { await service.delete(record.id, { expectedRevision: 1 }); } catch (error) { conflict = error; }
    try { await service.delete(record.id); } catch (error) { missingRevision = error; }
    assert(conflict?.code === DB_ERROR_CODES.REVISION_CONFLICT, "Delete con revisione obsoleta non bloccato dal servizio.");
    assert(missingRevision?.code === DB_ERROR_CODES.VALIDATION_FAILED, "Delete senza revisione attesa accettato.");
    assert((await service.getById(record.id))?.revision === updated.revision, "Il servizio ha cancellato il record nonostante il conflitto.");
    assert(await service.delete(record.id, { expectedRevision: updated.revision }), "Delete con revisione corrente non riuscito.");
  });

  await test("LEGACY-001 — anteprima snapshot valido senza scritture", async () => {
    const snapshot = JSON.stringify({
      params: { paga_base: 1250, ore_turno: 7.25 },
      profile: { ccnl: "Servizi", role: "Operatore" },
      shifts: [{ id: "turno-1", date: "2026-11-22", type: "turno", start_time: "08:00", end_time: "16:00", hours: 8 }]
    });
    const preview = inspectLegacySnapshot(snapshot);
    assert(preview.mode === "read-only-preview" && preview.writesPerformed === false, "L'anteprima non è dichiarata read-only.");
    assert(preview.importable && preview.profile.valid, "Snapshot valido segnalato come non importabile.");
    assert(preview.shifts.ready.length === 1 && preview.shifts.quarantined.length === 0, "Turno valido non riconosciuto.");
    assert(preview.shifts.ready[0].legacyId === "turno-1", "ID legacy non mantenuto nell'anteprima.");
  });

  await test("LEGACY-002 — turni non validi messi in quarantena individualmente", async () => {
    const preview = inspectLegacySnapshot(JSON.stringify({
      params: {}, profile: {},
      shifts: [
        { id: "ok", date: "2026-11-22", type: "turno", hours: 8 },
        { id: "bad-date", date: "2026-02-30", type: "turno", hours: 8 },
        { id: "bad-time", date: "2026-11-22", type: "turno", start_time: "25:00", hours: 8 },
        { id: "bad-flag", date: "2026-11-22", type: "turno", is_night: "true", hours: 8 }
      ]
    }));
    assert(preview.shifts.ready.length === 1, "Conteggio turni pronti errato.");
    assert(preview.shifts.quarantined.length === 3, "Turni non validi non isolati in quarantena.");
    assert(!preview.importable, "Snapshot con record in quarantena segnalato importabile.");
  });

  await test("LEGACY-003 — duplicati ID e campi non mappati segnalati", async () => {
    const preview = inspectLegacySnapshot(JSON.stringify({
      shifts: [
        { id: "a!b", date: "2026-11-22", type: "turno", hours: 8 },
        { id: "ab", date: "2026-11-23", type: "turno", hours: 8 },
        { id: "extra", date: "2026-11-24", type: "turno", hours: 8, custom: "dato" }
      ]
    }));
    assert(preview.shifts.ready.length === 1, "ID normalizzato duplicato non rilevato.");
    assert(preview.shifts.quarantined.length === 2, "Duplicato/campo extra non messi in quarantena.");
  });

  await test("LEGACY-004 — correzioni automatiche legacy solo come avviso", async () => {
    const preview = inspectLegacySnapshot(JSON.stringify({ params: { ore_turno: 7.15 }, profile: {}, shifts: [] }));
    assert(preview.profile.params.ore_turno === 7.15, "Il valore originale è stato modificato.");
    assert(preview.warnings.some(item => item.includes("7,25")), "Avviso sulla correzione legacy mancante.");
    assert(preview.writesPerformed === false, "L'analisi ha dichiarato scritture.");
  });

  await test("LEGACY-005 — JSON non valido rifiutato", async () => {
    let caught;
    try { inspectLegacySnapshot("{non-json"); } catch (error) { caught = error; }
    assert(caught?.code === DB_ERROR_CODES.VALIDATION_FAILED, "JSON corrotto non rifiutato con errore di validazione.");
  });

  await test("LEGACY-006 — anteprima extra quota, mensili, modelli e formazione", async () => {
    const preview = inspectLegacyExtras(JSON.stringify({
      quota: { ferie: 12, perm: 4.5 },
      real: { "2026-10": 1450, invalid: -2 },
      tpl: [{ type: "turno", post: "Sede A", st: "08:00", en: "16:00", n: false }],
      skills: [{ id: "skill-1", title: "Primo soccorso", issuer: "Ente", hours: 8 }],
      leavePayslip: { importedAt: "2026-11-01", ferie: { maturate: 10, godute: 2, residue: 8 } },
      role: "gpg", name: "Profilo locale"
    }));
    assert(preview.mode === "read-only-preview" && preview.writesPerformed === false, "Anteprima extra non read-only.");
    assert(preview.data.quota.ferie === 12 && preview.data.quota.perm === 4.5, "Quote ferie/permessi errate.");
    assert(preview.data.real["2026-10"] === 1450, "Valore mensile non letto.");
    assert(preview.data.templates.length === 1 && preview.data.skills.length === 1, "Modelli o formazione non analizzati.");
    assert(preview.data.leavePayslip.ferie.residue === 8, "Residuo busta paga non analizzato.");
  });

  await test("LEGACY-007 — credenziali PIN/salt mai esposte dall'adapter", async () => {
    const preview = inspectLegacyExtras(JSON.stringify({
      pin: "a".repeat(64), salt: "b".repeat(32), it: 150000, name: "Locale"
    }));
    assert(preview.credentials.present === true, "Materiale credenziale non rilevato.");
    assert(preview.credentials.valuesExposed === false && preview.credentials.imported === false, "Hash o salt dichiarati esposti/importati.");
    assert(!Object.hasOwn(preview.data, "pin") && !Object.hasOwn(preview.data, "salt"), "PIN o salt presenti nei dati restituiti.");
    assert(preview.warnings.some(item => item.includes("transizione autenticazione")), "Avviso transizione credenziali mancante.");
  });

  await test("LEGACY-008 — modelli e formazione non validi isolati", async () => {
    const preview = inspectLegacyExtras(JSON.stringify({
      quota: { ferie: -4 },
      tpl: [{ type: "UNKNOWN" }],
      skills: [{ title: "" }, { title: "Corso valido" }]
    }));
    assert(preview.templatesQuarantined.length === 1, "Modello non valido non isolato.");
    assert(preview.skillsQuarantined.length === 1 && preview.data.skills.length === 1, "Voce formazione non valida non isolata.");
    assert(preview.warnings.some(item => item.includes("Quota ferie non valida")), "Quota non valida non segnalata.");
  });


  await test("LEGACY-009 — inventario backup, storico, per-utente e formazione read-only", async () => {
    const archive = inspectLegacyArchive({
      tg_online_v1_pre_local_backup: JSON.stringify({ params: {}, profile: {}, shifts: [] }),
      tg_extra_v1_pre_local_backup: JSON.stringify({ quota: { ferie: 8 }, skills: [] }),
      tg_online_v1_user_privateSuffix: JSON.stringify({ params: {}, profile: {}, shifts: [{ date: "2026-11-22", type: "turno", hours: 8 }] }),
      tg_extra_v1_user_privateSuffix: JSON.stringify({ quota: { perm: 3 }, pin: "a".repeat(64), salt: "b".repeat(32) }),
      tg_change_history_v1: JSON.stringify([{ kind: "turn_add", before: null, after: { secret: "not returned" } }]),
      tg_training_local_v1: JSON.stringify([{ id: "x", title: "Primo soccorso", provider: "Ente", date: "2026-01-01", hours: 8 }, { title: "" }])
    });
    assert(archive.mode === "read-only-inventory" && archive.writesPerformed === false, "Inventario non read-only.");
    assert(archive.perUser.online === 1 && archive.perUser.extras === 1, "Conteggio chiavi per-utente errato.");
    assert(!JSON.stringify(archive).includes("privateSuffix") && !JSON.stringify(archive).includes("secret"), "Inventario espone suffissi o contenuti dello storico.");
    assert(archive.history.count === 1 && archive.history.kinds[0] === "turn_add", "Storico non inventariato.");
    assert(archive.training.ready.length === 1 && archive.training.quarantined.length === 1, "Formazione non inventariata/quarantinata.");
    assert(archive.snapshots.tg_online_v1_pre_local_backup.shifts.total === 0, "Backup precedente non analizzato.");
    assert(archive.snapshots.tg_extra_v1_pre_local_backup.counts.skills === 0, "Extra backup precedente non analizzato.");
  });

  await test("LEGACY-010 — backup cifrati riconosciuti senza decifrazione", async () => {
    const archive = inspectLegacyArchive({
      "backup-cifrato": JSON.stringify({ app: "Turni Gpg/sicurezza online", v: 3, enc: { alg: "AES-256-GCM" }, data: "ciphertext" })
    });
    assert(archive.encryptedBackups.length === 1 && archive.encryptedBackups[0].version === 3, "Backup cifrato v3 non riconosciuto.");
    assert(archive.encryptedBackups[0].decryptableHere === false && archive.writesPerformed === false, "Inventario ha dichiarato decifratura o scritture.");
  });


  await test("LEGACY-011 — riconciliazione distingue copie identiche, conflitti e possibili duplicati", async () => {
    const make = (id, hours = 8) => JSON.stringify({
      params: { paga_base: 1250 }, profile: { role: "Operatore" },
      shifts: [{ id, date: "2026-11-22", type: "turno", post: "Sede A", start_time: "08:00", end_time: "16:00", hours }]
    });
    const result = inspectLegacyReconciliation([
      { source: "backup-A", rawJson: make("turno-1") },
      { source: "backup-B", rawJson: make("turno-1") },
      { source: "profilo-utente", rawJson: make("turno-diverso", 8) }
    ]);
    assert(result.mode === "read-only-reconciliation" && result.writesPerformed === false, "Riconciliazione non read-only.");
    assert(result.automaticMergePerformed === false, "La riconciliazione ha dichiarato merge automatici.");
    assert(result.identicalRecords.length === 1, "Copie identiche non riconosciute.");
    assert(result.possibleDuplicates.length === 1, "Possibile duplicato con ID diversi non segnalato.");
    assert(result.idConflicts.length === 0, "Creato conflitto ID inatteso.");
  });

  await test("LEGACY-012 — stesso ID con dati diversi e profilo divergente sono conflitti", async () => {
    const make = (hours, salary) => JSON.stringify({
      params: { paga_base: salary }, profile: { role: "Operatore" },
      shifts: [{ id: "same-id", date: "2026-11-22", type: "turno", hours }]
    });
    const result = inspectLegacyReconciliation([
      { source: "copia-1", rawJson: make(8, 1200) },
      { source: "copia-2", rawJson: make(9, 1300) }
    ]);
    assert(result.idConflicts.length === 1, "Conflitto sullo stesso ID non rilevato.");
    assert(result.profileConflicts.some(item => item.section === "params" && item.field === "paga_base"), "Differenza parametro profilo non segnalata.");
    assert(result.totals.shiftsReady === 2, "I record delle due fonti non sono stati preservati nel report.");
  });

  await test("LEGACY-013 — record non validi restano conteggiati in quarantena", async () => {
    const result = inspectLegacyReconciliation([
      { source: "copia-a", rawJson: JSON.stringify({ shifts: [{ id: "ok", date: "2026-11-22", type: "turno" }, { date: "2026-02-30", type: "turno" }] }) },
      { source: "copia-b", rawJson: JSON.stringify({ shifts: [{ id: "ok", date: "2026-11-22", type: "turno" }] }) }
    ]);
    assert(result.quarantine.shifts === 1, "Turno non valido non conteggiato in quarantena.");
    assert(result.identicalRecords.length === 1, "Copia valida non riconosciuta.");
  });


  await test("LEGACY-014 — export senza password riconosciuto senza esporre dati", async () => {
    const report = inspectLegacyExport(JSON.stringify({
      app: "Turni Gpg/sicurezza online",
      params: { paga_base: 1250 }, profile: { role: "Operatore" },
      shifts: [{ id: "x", date: "2026-11-22", type: "turno", hours: 8 }],
      extra: { quota: { ferie: 12 }, skills: [{ title: "Primo soccorso" }], tpl: [] }
    }));
    assert(report.mode === "read-only-preview" && report.writesPerformed === false, "Export non read-only.");
    assert(report.snapshot.shiftsReady === 1 && report.extras.skills === 1, "Dati export non riconosciuti.");
    assert(!Object.hasOwn(report, "params") && !Object.hasOwn(report, "profile"), "Report espone dati personali grezzi.");
  });

  await test("LEGACY-015 — export ufficiali confrontano anche quote e formazione", async () => {
    const make = (ferie, skillTitle) => JSON.stringify({
      app: "Turni Gpg/sicurezza online", params: {}, profile: {},
      shifts: [{ id: "shared", date: "2026-11-22", type: "turno", hours: 8 }],
      extra: { quota: { ferie }, skills: [{ title: skillTitle }] }
    });
    const result = inspectLegacyReconciliation([
      { source: "export-1", rawJson: make(10, "Corso A") },
      { source: "export-2", rawJson: make(12, "Corso B") }
    ]);
    assert(result.extraConflicts.some(item => item.field === "quota.ferie"), "Differenza quota ferie non rilevata.");
    assert(result.extraConflicts.some(item => item.field === "skills"), "Differenza formazione non rilevata.");
    assert(result.identicalRecords.length === 1, "Turni uguali tra export non riconosciuti.");
  });

  await test("LEGACY-016 — cronologia distingue sovrapposizioni e turni consecutivi", async () => {
    const report = inspectLegacyShiftChronology([
      { id: "night", date: "2026-11-01", type: "turno", start_time: "18:00", end_time: "06:00" },
      { id: "overlap", date: "2026-11-02", type: "turno", start_time: "05:00", end_time: "09:00" },
      { id: "morning", date: "2026-11-03", type: "turno", start_time: "06:00", end_time: "14:00" },
      { id: "afternoon", date: "2026-11-03", type: "turno", start_time: "14:00", end_time: "18:00" }
    ]);
    assert(report.mode === "read-only-chronology" && report.writesPerformed === false, "Cronologia non read-only.");
    assert(report.overlaps.length === 1 && report.overlaps[0].overlapMinutes === 60, "Sovrapposizione tra date non rilevata.");
    assert(report.adjacentSegments.length === 1, "Turni consecutivi non distinti dai riposi.");
    assert(report.adjacentSegments[0].gapMinutes === 0, "Intervallo tra turni consecutivi errato.");
  });

  await test("LEGACY-017 — cronologia esclude turni non validi e ignora assenze", async () => {
    const report = inspectLegacyShiftChronology([
      { id: "valid", date: "2026-11-04", type: "turno", start_time: "08:00", end_time: "16:00" },
      { id: "bad-date", date: "2026-02-30", type: "turno", start_time: "16:00", end_time: "20:00" },
      { id: "bad-time", date: "2026-11-05", type: "turno", start_time: "25:00", end_time: "06:00" },
      { id: "leave", date: "2026-11-05", type: "ferie", start_time: "", end_time: "" }
    ]);
    assert(report.shiftsAnalyzed === 1, "Sono stati inclusi turni non validi o assenze.");
    assert(report.warnings.length === 2, "I turni non validi non sono stati segnalati entrambi.");
    assert(report.overlaps.length === 0 && report.transitions.length === 0, "La cronologia ha creato intervalli inattesi.");
    assert(report.writesPerformed === false, "L'analisi cronologica ha eseguito scritture.");
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
