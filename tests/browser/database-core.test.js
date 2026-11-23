import { renderHistoryEvents } from "../../src/ui/history-viewer.js";
import {
  openDSMDatabase, closeDSMDatabase, getDSMDatabaseStatus, createDSMCoreSession,
  createAccountContext, createAccountLifecycleCoordinator, createAccountLifecycleCrossTabBridge, ProfileRepository, ShiftRepository, AbsenceRepository, SettingsRepository, MigrationJobRepository, QuarantineRepository, HistoryRepository, ProfileService, ShiftService, AbsenceService, HistoryService, inspectLegacySnapshot, inspectLegacyExtras, inspectLegacyArchive, inspectLegacyReconciliation, inspectLegacyExport, inspectLegacyShiftChronology, DB_ERROR_CODES
} from "../../src/core/database/index.js";

const TEST_DB_NAME = "DSM_ENTERPRISE_TEST_DB";
const summary = document.querySelector("#summary");
const results = document.querySelector("#results");
let passed = 0, failed = 0, db, profiles, shifts, createdProfileId, createdShiftId;

function assert(condition, message) { if (!condition) throw new Error(message); }

async function deleteTestDatabase() {
  await closeDSMDatabase();
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

  await test("AUTH-003 — lifecycle invalida risultati stale e svuota viste prima del nuovo account", async () => {
    const lifecycleContext = createAccountContext();
    const lifecycle = createAccountLifecycleCoordinator({ accountContext: lifecycleContext });
    const clearedViews = ["cached-record-from-A"];
    lifecycleContext.activate({ accountId: "lifecycle-account-A", identitySource: "local" });
    // Establish active lifecycle state through an explicit initial transition.
    const initial = await lifecycle.beginTransition("initialize");
    lifecycle.activateLocal(initial, "lifecycle-account-A");
    const captureA = lifecycle.capture();
    lifecycle.subscribe(event => {
      if (event.type === "transition-start") clearedViews.splice(0, clearedViews.length);
    });
    let disposed = 0;
    lifecycle.registerDisposable(() => { disposed += 1; });
    const switching = await lifecycle.beginTransition("switch");
    assert(clearedViews.length === 0, "La vista sintetica non è stata svuotata all'inizio della transizione.");
    assert(!lifecycle.isCurrent(captureA), "Il token dell'account A è ancora valido durante il cambio.");
    assert(lifecycle.getStatus().state === "switching", "La transizione non risulta in corso.");
    assert(disposed === 1, "La risorsa precedente non è stata dismessa.");
    lifecycle.activateLocal(switching, "lifecycle-account-B");
    assert(lifecycle.isCurrent(lifecycle.capture()), "Il nuovo account B non risulta attivo.");
    assert(!lifecycle.isCurrent(captureA), "Un risultato tardivo di A è stato considerato corrente dopo l'attivazione di B.");
    const logout = await lifecycle.beginTransition("logout");
    lifecycle.clear(logout);
    assert(lifecycle.getStatus().state === "cleared", "Logout non ha azzerato lo stato lifecycle.");
    assert(!lifecycle.isCurrent(captureA), "Il token precedente è valido dopo logout.");
    let blocked = false;
    try { lifecycle.capture(); } catch (error) { blocked = error?.code === DB_ERROR_CODES.ACCOUNT_REQUIRED; }
    assert(blocked, "capture() ha consentito una lettura senza account attivo.");
  });

  await test("AUTH-004 — cleanup fallito mantiene il contesto bloccato fino al retry", async () => {
    const lifecycleContext = createAccountContext();
    const lifecycle = createAccountLifecycleCoordinator({ accountContext: lifecycleContext });
    let attempts = 0;
    lifecycle.registerDisposable(() => {
      attempts += 1;
      if (attempts === 1) throw new Error("synthetic cleanup failure");
    });
    const token = await lifecycle.beginTransition("initialize");
    assert(lifecycle.getStatus().state === "switching", "Cleanup fallito non ha mantenuto lo stato switching.");
    assert(lifecycle.getStatus().cleanupComplete === false, "Cleanup fallito risulta completato.");
    let blocked = false;
    try { lifecycle.activateLocal(token, "lifecycle-account-C"); } catch (error) { blocked = error?.code === DB_ERROR_CODES.ACCESS_DENIED; }
    assert(blocked, "Attivazione consentita dopo cleanup fallito.");
    assert(await lifecycle.retryCleanup(token), "Retry cleanup non ha completato la pulizia.");
    lifecycle.activateLocal(token, "lifecycle-account-C");
    assert(lifecycle.getStatus().state === "active" && attempts === 2, "Il retry non ha attivato l'account dopo la pulizia.");
  });

  await test("AUTH-001 — contesto locale rifiuta identità Firebase non verificate", async () => {
    let caught;
    try {
      context.activate({
        accountId: "browser-test-unverified-remote",
        identitySource: "firebase_verified"
      });
    } catch (error) { caught = error; }
    assert(caught?.code === DB_ERROR_CODES.ACCESS_DENIED, "Il contesto ha accettato un'identità remota non verificata.");
    assert(context.getActive() === null, "Il tentativo remoto ha attivato un account.");
  });

  await test("DB-000 — nome database vuoto rifiutato senza fallback", async () => {
    let caught;
    try { await openDSMDatabase({ name: "" }); } catch (error) { caught = error; }
    assert(caught?.code === DB_ERROR_CODES.VALIDATION_FAILED, "Nome vuoto non rifiutato.");
    assert(!getDSMDatabaseStatus().isOpen, "Un database è stato aperto durante la validazione.");
  });

  await test("DB-001A — upgrade da schema v1 conserva dati e aggiunge assenze", async () => {
    const legacy = await new Promise((resolve, reject) => {
      const request = indexedDB.open(TEST_DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const name of ["accounts", "profiles", "settings", "shifts", "history", "migration_jobs", "migration_quarantine"]) {
          const store = db.createObjectStore(name, { keyPath: "id" });
          store.createIndex("accountId", "accountId");
          store.createIndex("accountId_id", ["accountId", "id"], { unique: true });
        }
        db.createObjectStore("schema_metadata", { keyPath: "key" });
        request.transaction.objectStore("schema_metadata").put({ key: "schemaVersion", value: 1 });
        request.transaction.objectStore("profiles").put({
          id: "upgrade-preserved-profile", accountId: "browser-test-account-A",
          createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
          revision: 1, schemaVersion: 1, data: { displayName: "Profilo conservato" }
        });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    assert(legacy.version === 1 && !legacy.objectStoreNames.contains("absences"), "Fixture v1 non corretta.");
    legacy.close();
    db = await openDSMDatabase({ name: TEST_DB_NAME });
    assert(db.version === 2, "Il database non è stato aggiornato alla versione 2.");
    assert(db.objectStoreNames.contains("absences"), "Lo store assenze non è stato creato.");
    const metadata = await new Promise((resolve, reject) => {
      const request = db.transaction(["schema_metadata"], "readonly")
        .objectStore("schema_metadata").get("schemaVersion");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    assert(metadata?.value === 2 && metadata.upgradedFrom === 1, "Metadati upgrade non coerenti.");
    const contextForUpgrade = createAccountContext();
    contextForUpgrade.activate({ accountId: "browser-test-account-A", identitySource: "local" });
    const preserved = await new ProfileRepository({ db, accountContext: contextForUpgrade })
      .getById("upgrade-preserved-profile");
    assert(preserved?.data.displayName === "Profilo conservato", "I dati preesistenti sono stati persi durante l'upgrade.");
  });

  await test("DB-001 — apertura database di test isolato", async () => {
    db = await openDSMDatabase({ name: TEST_DB_NAME });
    assert(db.name === TEST_DB_NAME, "Database diverso da quello test.");
    assert(db instanceof IDBDatabase, "Non è un IDBDatabase.");
    assert(getDSMDatabaseStatus().isOpen && getDSMDatabaseStatus().name === TEST_DB_NAME, "Status DB non coerente.");
  });
  await test("DB-001B — chiusura invalida un'apertura pendente", async () => {
    await closeDSMDatabase();
    const pending = openDSMDatabase({ name: TEST_DB_NAME });
    await closeDSMDatabase();
    let rejected = false;
    try { await pending; } catch (error) { rejected = error?.code === DB_ERROR_CODES.OPEN_FAILED; }
    assert(rejected, "L'apertura iniziata prima della chiusura non è stata invalidata.");
    assert(!getDSMDatabaseStatus().isOpen, "La connessione stale è rimasta attiva dopo la chiusura.");
    db = await openDSMDatabase({ name: TEST_DB_NAME });
    assert(getDSMDatabaseStatus().isOpen && db.name === TEST_DB_NAME, "La riapertura dopo l'invalidazione non funziona.");
  });
  await test("DB-002 — object store previsti", async () => {
    for (const name of ["accounts","profiles","settings","shifts","absences","history","migration_jobs","migration_quarantine","schema_metadata"])
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
  await test("AUTH-005 — repository collegato invalida letture e abortisce scritture pendenti al cambio account", async () => {
    const lifecycle = createAccountLifecycleCoordinator({ accountContext: context });
    const initial = await lifecycle.beginTransition("initialize");
    lifecycle.activateLocal(initial, "browser-test-account-A");
    const boundProfiles = new ProfileRepository({
      db, accountContext: context, lifecycleCoordinator: lifecycle
    });
    assert((await boundProfiles.getById(createdProfileId))?.accountId === "browser-test-account-A",
      "Il repository lifecycle non legge l'account attivo.");
    const pendingUpdate = boundProfiles.update(
      createdProfileId, { displayName: "scrittura-stale" }, { expectedRevision: 1 }
    );
    const switching = await lifecycle.beginTransition("switch");
    let rejected = false;
    try { await pendingUpdate; } catch { rejected = true; }
    assert(rejected, "Una scrittura pendente non è stata interrotta durante il cambio account.");
    lifecycle.activateLocal(switching, "browser-test-account-B");
    assert(await boundProfiles.getById(createdProfileId) === null,
      "Il repository collegato ha esposto ad account B il record di A.");
    const logout = await lifecycle.beginTransition("logout");
    lifecycle.clear(logout);
    context.activate({ accountId: "browser-test-account-A", identitySource: "local" });
  });

  await test("AUTH-006 — session factory condivide lifecycle tra repository e servizi", async () => {
    const session = await createDSMCoreSession({ db, accountId: "session-account-A" });
    const profile = await session.services.profiles.create({});
    assert(profile.accountId === "session-account-A", "Il servizio non usa il contesto iniziale.");
    for (const [name, repository] of Object.entries(session.repositories)) {
      assert(repository.lifecycleCoordinator === session.lifecycle,
        `Il repository ${name} non condivide il coordinatore della sessione.`);
    }
    await session.switchLocalAccount("session-account-B");
    assert((await session.services.profiles.getAll()).length === 0,
      "Il servizio espone record dell'account precedente dopo lo switch.");
    const status = session.lifecycle.getStatus();
    assert(status.state === "active" && status.accountId === "session-account-B",
      "Lo switch non ha attivato il nuovo account.");
    await session.logout();
    assert(session.lifecycle.getStatus().state === "cleared", "Logout sessione non completato.");
    context.activate({ accountId: "browser-test-account-A", identitySource: "local" });
  });

  await test("AUTH-007 — session factory consente retry cleanup dopo switch interrotto", async () => {
    const session = await createDSMCoreSession({ db, accountId: "session-retry-account-A" });
    let attempts = 0;
    session.lifecycle.registerDisposable(() => {
      attempts += 1;
      if (attempts === 1) throw new Error("synthetic view cleanup failure");
    });
    let blocked = false;
    try { await session.switchLocalAccount("session-retry-account-B"); }
    catch { blocked = true; }
    assert(blocked, "Lo switch ha ignorato il cleanup fallito.");
    assert(session.lifecycle.getStatus().state === "switching", "La sessione non è rimasta bloccata durante il cleanup.");
    const resumed = await session.resumePendingTransition();
    assert(resumed.state === "active" && resumed.accountId === "session-retry-account-B",
      "Il retry non ha completato lo switch verso B.");
    assert(attempts === 2, "Il cleanup non è stato ripetuto una sola volta.");
    await session.logout();
    context.activate({ accountId: "browser-test-account-A", identitySource: "local" });
  });

  await test("AUTH-008 — invalidazione cross-tab e protezione replay", async () => {
    const channels = [];
    function makeChannel() {
      const listeners = new Set();
      const channel = {
        listeners,
        addEventListener(type, listener) { if (type === "message") listeners.add(listener); },
        removeEventListener(type, listener) { if (type === "message") listeners.delete(listener); },
        postMessage(data) {
          for (const peer of channels) {
            if (peer === channel) continue;
            queueMicrotask(() => {
              for (const listener of [...peer.listeners]) listener({ data });
            });
          }
        }
      };
      channels.push(channel);
      return channel;
    }

    const contextA = createAccountContext();
    const contextB = createAccountContext();
    const lifecycleA = createAccountLifecycleCoordinator({ accountContext: contextA });
    const lifecycleB = createAccountLifecycleCoordinator({ accountContext: contextB });
    const initialA = await lifecycleA.beginTransition("initialize");
    lifecycleA.activateLocal(initialA, "cross-tab-account-A");
    const initialB = await lifecycleB.beginTransition("initialize");
    lifecycleB.activateLocal(initialB, "cross-tab-account-A");
    const channelA = makeChannel();
    const channelB = makeChannel();
    let remoteCleanupAttempts = 0;
    lifecycleB.registerDisposable(() => {
      remoteCleanupAttempts += 1;
      if (remoteCleanupAttempts === 1) throw new Error("synthetic remote cleanup failure");
    });
    const bridgeA = createAccountLifecycleCrossTabBridge({
      lifecycleCoordinator: lifecycleA, channel: channelA, tabId: "synthetic-tab-A"
    });
    const bridgeB = createAccountLifecycleCrossTabBridge({
      lifecycleCoordinator: lifecycleB, channel: channelB, tabId: "synthetic-tab-B"
    });

    const switching = await lifecycleA.beginTransition("switch");
    lifecycleA.activateLocal(switching, "cross-tab-account-B");
    await new Promise(resolve => setTimeout(resolve, 0));
    assert(lifecycleA.getStatus().state === "active", "La scheda mittente non ha completato lo switch locale.");
    assert(lifecycleB.getStatus().state === "switching", "La scheda ricevente non è rimasta bloccata dopo cleanup fallito.");
    assert(bridgeB.getStatus().pendingRemote && bridgeB.getStatus().cleanupPending,
      "Il bridge non ha conservato la transizione remota da riprendere.");
    await bridgeB.retryPendingInvalidation();
    assert(lifecycleB.getStatus().state === "cleared", "Il retry non ha invalidato la sessione ricevente.");
    assert(bridgeB.getStatus().pendingRemote === false && remoteCleanupAttempts === 2,
      "Il retry cross-tab non ha completato la pulizia una sola volta.");

    channelA.postMessage({
      type: "dsm-account-transition", version: 1, senderId: "synthetic-tab-A", sequence: 1
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert(lifecycleB.getStatus().state === "cleared", "Un messaggio duplicato ha riattivato la sessione.");

    bridgeA.dispose();
    bridgeB.dispose();
    assert(bridgeA.getStatus().disposed && bridgeB.getStatus().disposed,
      "I bridge non sono stati dismessi correttamente.");
  });

  await test("DB-005 — update, revision e delete", async () => {
    const updated = await profiles.update(createdProfileId, { displayName: "Profilo aggiornato" }, { expectedRevision: 1 });
    assert(updated?.revision === 2 && updated.data.displayName === "Profilo aggiornato", "Update/revision errati.");
    assert(await profiles.delete(createdProfileId), "Delete non true.");
    assert(await profiles.getById(createdProfileId) === null, "Record cancellato ancora presente.");
  });
  await test("DB-005A — aggiornamenti concorrenti con la stessa revisione non si sovrascrivono", async () => {
    const history = new HistoryRepository({ db, accountContext: context });
    const profile = await profiles.create({ displayName: "Profilo concorrenza iniziale" });
    const outcomes = await Promise.allSettled([
      profiles.update(profile.id, { displayName: "Modifica concorrente A" }, { expectedRevision: 1 }),
      profiles.update(profile.id, { displayName: "Modifica concorrente B" }, { expectedRevision: 1 })
    ]);
    const fulfilled = outcomes.filter(item => item.status === "fulfilled");
    const rejected = outcomes.filter(item => item.status === "rejected");
    assert(fulfilled.length === 1, "Non è stata accettata esattamente una modifica concorrente.");
    assert(rejected.length === 1 && rejected[0].reason?.code === DB_ERROR_CODES.REVISION_CONFLICT,
      "La seconda modifica non ha ricevuto REVISION_CONFLICT.");
    const persisted = await profiles.getById(profile.id);
    assert(persisted?.revision === 2, "La revisione finale non è 2.");
    assert(["Modifica concorrente A", "Modifica concorrente B"].includes(persisted.data.displayName),
      "Il valore finale non corrisponde alla modifica vincente.");
    const events = (await history.getEvents()).filter(item => item.data.entityId === profile.id);
    assert(events.length === 2 && events.map(item => item.data.action).join(",") === "create,update",
      "La modifica rifiutata ha lasciato un evento storico o la modifica vincente non è stata registrata.");
  });
  await test("DB-006 — isolamento account A/B", async () => {
    const record = await profiles.create({ displayName: "Privato account A" }); createdProfileId = record.id;
    context.activate({ accountId: "browser-test-account-B", identitySource: "local" });
    assert(await profiles.getById(createdProfileId) === null, "B legge un record di A.");
    assert((await profiles.getAll()).length === 0, "B vede dati di A.");
    context.activate({ accountId: "browser-test-account-A", identitySource: "local" });
    assert((await profiles.getById(createdProfileId))?.accountId === "browser-test-account-A", "A non ritrova il suo record.");
  });
  await test("AUTH-002 — clear del contesto blocca accesso ma non cancella IndexedDB", async () => {
    context.activate({ accountId: "browser-test-account-A", identitySource: "local" });
    const repository = new ProfileRepository({ db, accountContext: context });
    const profile = await repository.create({ displayName: "Profilo logout sintetico" });
    context.clear();
    assert(context.getActive() === null, "Il contesto non è stato azzerato.");
    let caught;
    try { await repository.getAll(); } catch (error) { caught = error; }
    assert(caught?.code === DB_ERROR_CODES.ACCOUNT_REQUIRED, "Il repository ha consentito accesso dopo clear.");
    context.activate({ accountId: "browser-test-account-A", identitySource: "local" });
    assert((await repository.getById(profile.id))?.id === profile.id,
      "Il logout ha cancellato inaspettatamente i dati persistenti.");
  });

  await test("DB-007 — turno e persistenza dopo riapertura", async () => {
    shifts = new ShiftRepository({ db, accountContext: context });
    createdShiftId = (await shifts.create({ date: "2099-01-01", type: "TEST" })).id;
    await closeDSMDatabase();
    db = await openDSMDatabase({ name: TEST_DB_NAME });
    profiles = new ProfileRepository({ db, accountContext: context });
    shifts = new ShiftRepository({ db, accountContext: context });
    assert((await shifts.getById(createdShiftId))?.data.type === "TEST", "Turno non persistito.");
    assert(await profiles.getById(createdProfileId) !== null, "Profilo non persistito.");
  });
  await test("DB-008 — ID duplicato preserva record originale", async () => {
    const id = `duplicate-${crypto.randomUUID()}`;
    const history = new HistoryRepository({ db, accountContext: context });
    await profiles.create({ marker: "first" }, { id });
    const eventsBeforeDuplicate = (await history.getEvents()).filter(item => item.data.entityId === id).length;
    let caught; try { await profiles.create({ marker: "second" }, { id }); } catch (error) { caught = error; }
    assert(Boolean(caught), "ID duplicato non ha prodotto errore.");
    assert((await profiles.getById(id))?.data.marker === "first", "Record originale alterato.");
    const eventsAfterDuplicate = (await history.getEvents()).filter(item => item.data.entityId === id).length;
    assert(eventsAfterDuplicate === eventsBeforeDuplicate, "Scrittura fallita ha lasciato un evento storico orfano.");
  });

  await test("DB-009A — repository migrazione e quarantena isolati per account", async () => {
    const jobs = new MigrationJobRepository({ db, accountContext: context });
    const quarantine = new QuarantineRepository({ db, accountContext: context });
    const job = await jobs.createJob({ sourceCount: 3 });
    const item = await quarantine.createItem({
      itemType: "shift", sourceIndex: 2, reason: "invalid-data"
    });
    assert(job.data.mode === "read-only" && job.data.status === "analysis", "Il job non nasce in sola lettura.");
    assert(item.data.resolutionStatus === "pending", "L'elemento non nasce in attesa di revisione.");
    context.activate({ accountId: "browser-test-account-B", identitySource: "local" });
    assert(await jobs.getJob(job.id) === null, "Account B legge un job di A.");
    assert((await jobs.getJobs()).length === 0, "Account B vede job di A.");
    assert(await quarantine.getItem(item.id) === null, "Account B legge quarantena di A.");
    assert((await quarantine.getItems()).length === 0, "Account B vede quarantena di A.");
    context.activate({ accountId: "browser-test-account-A", identitySource: "local" });
    assert((await jobs.getJob(job.id))?.id === job.id, "Account A non ritrova il proprio job.");
    assert((await quarantine.getItem(item.id))?.id === item.id, "Account A non ritrova l'elemento.");
  });

  await test("DB-009B — repository rifiutano payload grezzi e accountId contraffatto", async () => {
    const jobs = new MigrationJobRepository({ db, accountContext: context });
    const quarantine = new QuarantineRepository({ db, accountContext: context });
    let rawJob, rawItem, forgedAccount, invalidStatus;
    try { await jobs.createJob({ raw: { privateValue: "never-store" } }); } catch (error) { rawJob = error; }
    try { await quarantine.createItem({ itemType: "shift", sourceIndex: 0, reason: "invalid-data", raw: { privateValue: "never-store" } }); } catch (error) { rawItem = error; }
    try { await jobs.createJob({ accountId: "browser-test-account-B" }); } catch (error) { forgedAccount = error; }
    try { await jobs.createJob({ status: "executing" }); } catch (error) { invalidStatus = error; }
    for (const error of [rawJob, rawItem, forgedAccount, invalidStatus]) {
      assert(error?.code === DB_ERROR_CODES.VALIDATION_FAILED, "Campo o stato non consentito accettato.");
    }
  });

  await test("DB-009D — stati migrazione e quarantena seguono transizioni sicure", async () => {
    const jobs = new MigrationJobRepository({ db, accountContext: context });
    const quarantine = new QuarantineRepository({ db, accountContext: context });
    let jobInitial, itemInitial, error;
    try { await jobs.createJob({ status: "completed" }); } catch (caught) { error = caught; }
    assert(error?.code === DB_ERROR_CODES.VALIDATION_FAILED, "Un job non può nascere completed.");
    error = null;
    try { await quarantine.createItem({ itemType: "shift", sourceIndex: 0, reason: "invalid-data", resolutionStatus: "released" }); } catch (caught) { error = caught; }
    assert(error?.code === DB_ERROR_CODES.VALIDATION_FAILED, "Un elemento non può nascere released.");

    jobInitial = await jobs.createJob({ sourceCount: 1 });
    const reviewedJob = await jobs.updateJob(jobInitial.id, { status: "review-required" });
    assert(reviewedJob.data.status === "review-required" && reviewedJob.revision === 2, "Transizione analysis → review-required non riuscita.");
    error = null;
    try { await jobs.updateJob(jobInitial.id, { status: "approved" }); } catch (caught) { error = caught; }
    assert(error?.code === DB_ERROR_CODES.VALIDATION_FAILED, "Il repository ha consentito approvazione senza processo autorizzativo.");
    error = null;
    try { await jobs.updateJob(jobInitial.id, { status: "completed" }); } catch (caught) { error = caught; }
    assert(error?.code === DB_ERROR_CODES.VALIDATION_FAILED, "Il repository ha consentito completamento senza esecuzione.");

    itemInitial = await quarantine.createItem({ itemType: "shift", sourceIndex: 0, reason: "invalid-data" });
    const reviewedItem = await quarantine.updateItem(itemInitial.id, { resolutionStatus: "reviewed" });
    assert(reviewedItem.data.resolutionStatus === "reviewed" && reviewedItem.revision === 2, "Transizione pending → reviewed non riuscita.");
    error = null;
    try { await quarantine.updateItem(itemInitial.id, { resolutionStatus: "released" }); } catch (caught) { error = caught; }
    assert(error?.code === DB_ERROR_CODES.VALIDATION_FAILED, "Il repository ha consentito rilascio senza migrazione.");
    const discardedItem = await quarantine.updateItem(itemInitial.id, { resolutionStatus: "discarded" });
    assert(discardedItem.data.resolutionStatus === "discarded" && discardedItem.revision === 3, "Transizione reviewed → discarded non riuscita.");
  });

  await test("DB-009C — job e quarantena persistono dopo riapertura", async () => {
    const jobsBefore = new MigrationJobRepository({ db, accountContext: context });
    const quarantineBefore = new QuarantineRepository({ db, accountContext: context });
    const job = await jobsBefore.createJob({ sourceCount: 1 });
    const item = await quarantineBefore.createItem({
      itemType: "template", sourceIndex: 0, reason: "manual-review"
    });
    await closeDSMDatabase();
    db = await openDSMDatabase({ name: TEST_DB_NAME });
    profiles = new ProfileRepository({ db, accountContext: context });
    shifts = new ShiftRepository({ db, accountContext: context });
    const jobsAfter = new MigrationJobRepository({ db, accountContext: context });
    const quarantineAfter = new QuarantineRepository({ db, accountContext: context });
    assert((await jobsAfter.getJob(job.id))?.data.sourceCount === 1, "Job non persistito.");
    assert((await quarantineAfter.getItem(item.id))?.data.reason === "manual-review", "Quarantena non persistita.");
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

  await test("ABS-001 — assenze separate, validate e registrate nello storico", async () => {
    const repository = new AbsenceRepository({ db, accountContext: context });
    const service = new AbsenceService({ repository });
    const history = new HistoryRepository({ db, accountContext: context });
    const absence = await service.create({ kind: "ferie", startDate: "2026-12-01", endDate: "2026-12-03" });
    assert(absence.data.kind === "ferie" && absence.data.startDate === "2026-12-01", "Assenza non salvata correttamente.");
    const events = await history.getEventsForEntity("absence", absence.id);
    assert(events.length === 1 && events[0].data.action === "create", "Evento audit assenza mancante.");
    const historyService = new HistoryService({ repository: history });
    const presented = await historyService.getEventsForEntity("absence", absence.id);
    assert(presented.length === 1 && presented[0].entityLabel === "Assenza" &&
      presented[0].description === "Assenza creata", "HistoryService non presenta l'evento assenza.");
    const historyContainer = document.createElement("section");
    assert(renderHistoryEvents(historyContainer, presented) === 1 &&
      historyContainer.textContent.includes("Assenza creata"), "Renderer non accetta eventi assenza.");
    const updated = await service.update(absence.id, { endDate: "2026-12-04" }, { expectedRevision: 1 });
    assert(updated.revision === 2 && updated.data.endDate === "2026-12-04", "Aggiornamento assenza errato.");
    assert((await history.getEventsForEntity("absence", absence.id)).length === 2, "Evento audit aggiornamento assenza mancante.");
    const summary = await service.summarizeRange("2026-12-02", "2026-12-05");
    assert(summary.records === 1 && summary.kinds.ferie.records === 1 &&
      summary.kinds.ferie.uniqueCalendarDays === 3, "Riepilogo range ferie non conteggia i giorni inclusivi correttamente.");
    const overlapping = await service.create({ kind: "permesso", startDate: "2026-12-03", endDate: "2026-12-04" });
    const overlappingSummary = await service.summarizeRange("2026-12-01", "2026-12-05");
    assert(overlappingSummary.overlaps.length === 1 &&
      overlappingSummary.overlaps[0].calendarDays === 2, "Sovrapposizione assenze non segnalata.");
    assert(Object.isFrozen(overlappingSummary.overlaps[0].kinds), "Elenco categorie sovrapposizione modificabile.");
    let mutableOverlap;
    try { overlappingSummary.overlaps[0].kinds.push("malattia"); } catch { mutableOverlap = true; }
    assert(mutableOverlap || overlappingSummary.overlaps[0].kinds.length === 2, "Categorie sovrapposizione alterabili.");
    assert(overlappingSummary.kinds.permesso.uniqueCalendarDays === 2, "Giorni permesso non conteggiati.");
    const clippedSummary = await service.summarizeRange("2026-12-03", "2026-12-03");
    assert(clippedSummary.overlaps.length === 1 &&
      clippedSummary.overlaps[0].startDate === "2026-12-03" &&
      clippedSummary.overlaps[0].endDate === "2026-12-03" &&
      clippedSummary.overlaps[0].calendarDays === 1,
      "Sovrapposizione ai confini del periodo non limitata correttamente.");
    await service.delete(overlapping.id, { expectedRevision: 1 });
    const leapAbsence = await service.create({
      kind: "ferie", startDate: "2028-02-28", endDate: "2028-03-01"
    });
    const leapSummary = await service.summarizeRange("2028-02-29", "2028-02-29");
    assert(leapSummary.kinds.ferie.uniqueCalendarDays === 1 &&
      leapSummary.kinds.ferie.records === 1,
      "Il giorno bisestile non è conteggiato correttamente.");
    await service.delete(leapAbsence.id, { expectedRevision: 1 });
    const earlyYearAbsence = await service.create({
      kind: "ferie", startDate: "0096-02-29", endDate: "0096-03-01"
    });
    assert(earlyYearAbsence.data.startDate === "0096-02-29",
      "Una data ISO valida con anno inferiore a 0100 è stata rifiutata.");
    await service.delete(earlyYearAbsence.id, { expectedRevision: 1 });
    let invalidRange;
    try { await service.getInRange("2026-12-05", "2026-12-01"); } catch (error) { invalidRange = error; }
    assert(invalidRange?.code === DB_ERROR_CODES.VALIDATION_FAILED, "Intervallo inverso non rifiutato.");
    let staleRevision;
    try { await service.update(absence.id, { endDate: "2026-12-05" }, { expectedRevision: 1 }); }
    catch (error) { staleRevision = error; }
    assert(staleRevision?.code === DB_ERROR_CODES.REVISION_CONFLICT, "Aggiornamento assenza con revisione obsoleta non bloccato.");
    assert((await repository.getById(absence.id)).data.endDate === "2026-12-04", "Aggiornamento obsoleto ha alterato l'assenza.");
    let reversed, invalidKind, extraField, invalidDate;
    for (const [payload, target] of [
      [{ kind: "ferie", startDate: "2026-12-05", endDate: "2026-12-04" }, "reversed"],
      [{ kind: "unknown", startDate: "2026-12-01", endDate: "2026-12-02" }, "kind"],
      [{ kind: "permesso", startDate: "2026-12-01", endDate: "2026-12-02", note: "non consentita" }, "extra"],
      [{ kind: "malattia", startDate: "2026-02-30", endDate: "2026-03-01" }, "date"]
    ]) {
      try { await service.create(payload); } catch (error) {
        if (target === "reversed") reversed = error;
        if (target === "kind") invalidKind = error;
        if (target === "extra") extraField = error;
        if (target === "date") invalidDate = error;
      }
    }
    for (const error of [reversed, invalidKind, extraField, invalidDate])
      assert(error?.code === DB_ERROR_CODES.VALIDATION_FAILED, "Validazione assenza non ha rifiutato un input non valido.");
    assert((await repository.getAll()).length === 1, "Input non valido ha creato record.");
    context.activate({ accountId: "browser-test-account-B", identitySource: "local" });
    assert(await repository.getById(absence.id) === null, "Account B legge un'assenza di A.");
    context.activate({ accountId: "browser-test-account-A", identitySource: "local" });
    assert((await repository.getById(absence.id))?.id === absence.id, "Account A non ritrova l'assenza.");
  });

  await test("ABS-002 — assenze persistono dopo riapertura e cancellazione auditata", async () => {
    const repository = new AbsenceRepository({ db, accountContext: context });
    const service = new AbsenceService({ repository });
    const history = new HistoryRepository({ db, accountContext: context });
    const absence = await service.create({ kind: "permesso", startDate: "2026-12-10", endDate: "2026-12-10" });
    await closeDSMDatabase();
    db = await openDSMDatabase({ name: TEST_DB_NAME });
    profiles = new ProfileRepository({ db, accountContext: context });
    shifts = new ShiftRepository({ db, accountContext: context });
    const after = new AbsenceRepository({ db, accountContext: context });
    const historyAfter = new HistoryRepository({ db, accountContext: context });
    assert((await after.getById(absence.id))?.data.kind === "permesso", "Assenza non persistita dopo riapertura.");
    assert(await after.delete(absence.id, { expectedRevision: 1 }), "Cancellazione assenza non riuscita.");
    const events = await historyAfter.getEventsForEntity("absence", absence.id);
    assert(events.map(item => item.data.action).join(",") === "create,delete", "Cancellazione assenza non auditata.");
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

  await test("SVC-005A — date ISO con anni inferiori a 0100 nei servizi profilo e turno", async () => {
    const profileService = new ProfileService({ repository: profiles });
    const shiftService = new ShiftService({ repository: shifts });
    const profile = await profileService.create({
      profile: { effective_date: "0096-02-29" }
    });
    const shift = await shiftService.create({
      date: "0096-02-29", type: "turno"
    });
    assert(profile.data.profile.effective_date === "0096-02-29",
      "La decorrenza profilo valida con anno 0096 è stata rifiutata.");
    assert(shift.data.date === "0096-02-29",
      "La data turno valida con anno 0096 è stata rifiutata.");
    let invalidProfileDate, invalidShiftDate;
    try {
      await profileService.create({ profile: { effective_date: "0096-02-30" } });
    } catch (error) { invalidProfileDate = error; }
    try {
      await shiftService.create({ date: "0096-02-30", type: "turno" });
    } catch (error) { invalidShiftDate = error; }
    assert(invalidProfileDate?.code === DB_ERROR_CODES.VALIDATION_FAILED,
      "Il profilo ha accettato un giorno inesistente nell'anno 0096.");
    assert(invalidShiftDate?.code === DB_ERROR_CODES.VALIDATION_FAILED,
      "Il turno ha accettato un giorno inesistente nell'anno 0096.");
    await profileService.delete(profile.id, { expectedRevision: 1 });
    await shiftService.delete(shift.id, { expectedRevision: 1 });
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

  await test("SVC-009 — intervalli turno incompleti o di durata zero rifiutati", async () => {
    const service = new ShiftService({ repository: shifts });
    let missingEnd, missingStart, zeroLength;
    try { await service.create({ date: "2026-11-23", type: "turno", start_time: "08:00" }); } catch (error) { missingEnd = error; }
    try { await service.create({ date: "2026-11-23", type: "turno", end_time: "16:00" }); } catch (error) { missingStart = error; }
    try { await service.create({ date: "2026-11-23", type: "turno", start_time: "08:00", end_time: "08:00" }); } catch (error) { zeroLength = error; }
    for (const error of [missingEnd, missingStart, zeroLength]) {
      assert(error?.code === DB_ERROR_CODES.VALIDATION_FAILED, "Intervallo turno incompleto o nullo accettato.");
    }
  });

  await test("SVC-010 — aggiornamento non può creare intervallo nullo", async () => {
    const service = new ShiftService({ repository: shifts });
    const record = await service.create({
      date: "2026-11-23", type: "turno", start_time: "08:00", end_time: "16:00", hours: 8
    });
    let caught;
    try {
      await service.update(record.id, { end_time: "08:00" }, { expectedRevision: 1 });
    } catch (error) { caught = error; }
    assert(caught?.code === DB_ERROR_CODES.VALIDATION_FAILED, "Aggiornamento con intervallo nullo accettato.");
    const persisted = await service.getById(record.id);
    assert(persisted.revision === 1 && persisted.data.end_time === "16:00", "Il turno valido è stato alterato.");
  });

  await test("SVC-011 — turno notturno con passaggio a mezzanotte accettato", async () => {
    const service = new ShiftService({ repository: shifts });
    const record = await service.create({
      date: "2026-11-23", type: "turno", start_time: "22:00", end_time: "06:00", hours: 8, is_night: true
    });
    assert(record.data.start_time === "22:00" && record.data.end_time === "06:00", "Intervallo notturno valido rifiutato.");
    assert(record.data.hours === 8 && record.data.is_night === true, "Metadati turno notturno alterati.");
  });

  await test("SVC-012 — ore turno validate ai limiti e rifiuto di valori non numerici", async () => {
    const service = new ShiftService({ repository: shifts });
    const base = { date: "2026-11-23", type: "turno" };
    for (const hours of [0, 48]) {
      const record = await service.create({ ...base, hours });
      assert(record.data.hours === hours, `Valore limite ${hours} non conservato.`);
    }
    for (const hours of [-0.1, 48.1, NaN, Infinity, true, "8"]) {
      let caught;
      try { await service.create({ ...base, hours }); } catch (error) { caught = error; }
      assert(caught?.code === DB_ERROR_CODES.VALIDATION_FAILED,
        `Valore ore non valido accettato: ${String(hours)}.`);
    }
  });

  await test("SVC-013 — campi turno sconosciuti rifiutati senza persistenza", async () => {
    const service = new ShiftService({ repository: shifts });
    const before = (await service.getAll()).length;
    let caught;
    try {
      await service.create({ date: "2026-11-23", type: "turno", privatePayload: "not-allowed" });
    } catch (error) { caught = error; }
    assert(caught?.code === DB_ERROR_CODES.VALIDATION_FAILED, "Campo turno sconosciuto accettato.");
    assert((await service.getAll()).length === before, "Il payload rifiutato ha creato un record.");
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

  await test("LEGACY-001A — date ISO con anni inferiori a 0100 nell'adapter legacy", async () => {
    const snapshot = inspectLegacySnapshot(JSON.stringify({
      params: {},
      profile: { effective_date: "0096-02-29" },
      shifts: [{ id: "early-year", date: "0096-02-29", type: "turno", hours: 8 }]
    }));
    assert(snapshot.profile.valid, "La decorrenza legacy valida con anno 0096 è stata rifiutata.");
    assert(snapshot.shifts.ready.length === 1 && snapshot.shifts.quarantined.length === 0,
      "Il turno legacy valido con anno 0096 è stato messo in quarantena.");
    const invalid = inspectLegacySnapshot(JSON.stringify({
      params: {},
      profile: { effective_date: "0096-02-30" },
      shifts: [{ date: "0096-02-30", type: "turno", hours: 8 }]
    }));
    assert(!invalid.profile.valid, "Il profilo legacy ha accettato il giorno inesistente.");
    assert(invalid.shifts.quarantined.length === 1, "Il turno legacy con giorno inesistente non è stato isolato.");
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
    assert(!Object.hasOwn(result, "profileConflicts") && !Object.hasOwn(result, "extraConflicts") && !Object.hasOwn(result, "idConflicts"), "Il report espone strutture di conflitto dettagliate.");
    assert(!JSON.stringify(result).includes("paga_base") && !JSON.stringify(result).includes("turno-1"), "Il report espone nomi di campi o identificativi legacy.");
    assert(result.conflicts.identicalShiftGroups >= 1, "Copie identiche non riconosciute.");
    assert(result.conflicts.possibleDuplicateGroups >= 1, "Possibile duplicato con ID diversi non segnalato.");
    assert(result.conflicts.shiftIdConflicts === 0, "Creato conflitto ID inatteso.");
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
    assert(result.conflicts.shiftIdConflicts >= 1, "Conflitto sullo stesso ID non rilevato.");
    assert(result.conflicts.profileDifferences > 0, "Differenza parametro profilo non segnalata.");
    assert(result.totals.shiftsReady === 2, "I record delle due fonti non sono stati preservati nel report.");
  });

  await test("LEGACY-013 — record non validi restano conteggiati in quarantena", async () => {
    const result = inspectLegacyReconciliation([
      { source: "copia-a", rawJson: JSON.stringify({ shifts: [{ id: "ok", date: "2026-11-22", type: "turno" }, { date: "2026-02-30", type: "turno" }] }) },
      { source: "copia-b", rawJson: JSON.stringify({ shifts: [{ id: "ok", date: "2026-11-22", type: "turno" }] }) }
    ]);
    assert(result.quarantine.shifts === 1, "Turno non valido non conteggiato in quarantena.");
    assert(result.conflicts.identicalShiftGroups >= 1, "Copia valida non riconosciuta.");
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
    assert(result.conflicts.extraDifferences > 0, "Differenza quota ferie non rilevata.");
    assert(result.conflicts.extraDifferences > 0, "Differenza formazione non rilevata.");
    assert(result.conflicts.identicalShiftGroups >= 1, "Turni uguali tra export non riconosciuti.");
  });

  await test("LEGACY-023 — campi extra presenti in una sola fonte restano conflitti", async () => {
    const make = real => JSON.stringify({
      app: "Turni Gpg/sicurezza online", params: {}, profile: {}, shifts: [],
      extra: { real }
    });
    const report = inspectLegacyReconciliation([
      { source: "export-con-mese", rawJson: make({ "2026-10": 1450 }) },
      { source: "export-senza-mese", rawJson: make({ "2026-11": 1520 }) }
    ]);
    assert(report.conflicts.extraDifferences > 0, "Differenza mensile tra fonti non conteggiata.");
    assert(report.writesPerformed === false && report.automaticMergePerformed === false,
      "Il controllo ha modificato dati.");
  });

  await test("LEGACY-024 — parametri e campi profilo assenti restano conflitti", async () => {
    const make = params => JSON.stringify({
      app: "Turni Gpg/sicurezza online", params, profile: {}, shifts: []
    });
    const report = inspectLegacyReconciliation([
      { source: "export-con-parametro", rawJson: make({ paga_base: 1000 }) },
      { source: "export-senza-parametro", rawJson: make({}) }
    ]);
    assert(report.conflicts.profileDifferences > 0, "Differenza parametro tra fonti non conteggiata.");
    assert(report.writesPerformed === false && report.automaticMergePerformed === false,
      "Il controllo ha modificato dati.");
  });

  await test("LEGACY-025 — fonte e indice dei turni in quarantena preservati", async () => {
    const make = shifts => JSON.stringify({ app: "Turni Gpg/sicurezza online", params: {}, profile: {}, shifts });
    const report = inspectLegacyReconciliation([
      { source: "export-precedente", rawJson: make([
        { id: "ok", date: "2026-11-11", type: "turno", hours: 8 },
        { id: "bad", date: "2026-02-30", type: "turno", hours: 8 }
      ]) },
      { source: "export-recente", rawJson: make([]) }
    ]);
    assert(report.quarantine.shifts === 1, "Conteggio quarantena errato.");
    assert(!Object.hasOwn(report, "quarantinedShifts"), "Il report espone dettagli dei record in quarantena.");
    assert(report.writesPerformed === false && report.automaticMergePerformed === false, "La riconciliazione ha modificato dati.");
  });

  await test("LEGACY-026 — fonte senza sezione extra rilevata nel confronto", async () => {
    const make = withExtra => JSON.stringify({
      app: "Turni Gpg/sicurezza online", params: {}, profile: {}, shifts: [],
      ...(withExtra ? { extra: { quota: { ferie: 12 } } } : {})
    });
    const report = inspectLegacyReconciliation([
      { source: "export-con-extra", rawJson: make(true) },
      { source: "export-senza-extra", rawJson: make(false) }
    ]);
    assert(report.conflicts.extraDifferences > 0, "Sezione extra mancante non conteggiata come differenza.");
    assert(report.writesPerformed === false && report.automaticMergePerformed === false, "Il confronto ha modificato dati.");
  });

  await test("LEGACY-027 — rapporto migrazione riepiloga quarantena e blocca importazione automatica", async () => {
    const make = extra => JSON.stringify({
      app: "Turni Gpg/sicurezza online", params: {}, profile: {}, shifts: [], extra
    });
    const report = inspectLegacyReconciliation([
      { source: "export-dati", rawJson: make({
        tpl: [{ type: "turno", st: "99:99", en: "16:00" }],
        skills: [{}]
      }) },
      { source: "export-vuoto", rawJson: make({}) }
    ]);
    assert(report.quarantine.templates === 1 && report.quarantine.skills === 1, "Conteggi quarantena extra errati.");
    assert(!Object.hasOwn(report, "quarantinedTemplates") && !Object.hasOwn(report, "quarantinedSkills"), "Il report espone dettagli delle voci in quarantena.");
    assert(report.sources[0].extraTemplatesQuarantined === 1, "Riepilogo per fonte incompleto.");
    assert(report.migrationReadiness.reviewRequired === true && report.migrationReadiness.automaticImportAllowed === false, "Il report non blocca la migrazione automatica.");
    assert(report.migrationReadiness.status === "review-required", "Stato di revisione errato.");
    assert(report.writesPerformed === false && report.automaticMergePerformed === false, "Il report ha modificato dati.");
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

  await test("LEGACY-018 — rileva più sovrapposizioni anche con intervalli contenuti", async () => {
    const report = inspectLegacyShiftChronology([
      { id: "long", date: "2026-11-06", type: "turno", start_time: "06:00", end_time: "18:00" },
      { id: "inside", date: "2026-11-06", type: "turno", start_time: "08:00", end_time: "10:00" },
      { id: "late", date: "2026-11-06", type: "turno", start_time: "17:00", end_time: "20:00" }
    ]);
    assert(report.shiftsAnalyzed === 3, "Numero turni analizzati errato.");
    assert(report.overlaps.length === 2, "Non sono state rilevate entrambe le sovrapposizioni.");
    assert(report.overlaps[0].overlapMinutes === 120, "Durata sovrapposizione contenuta errata.");
    assert(report.overlaps[1].overlapMinutes === 60, "Durata seconda sovrapposizione errata.");
    assert(report.writesPerformed === false, "L'analisi cronologica ha eseguito scritture.");
  });

  await test("LEGACY-019 — duplicati interni alla stessa fonte segnalati", async () => {
    const make = shifts => JSON.stringify({
      app: "Turni Gpg/sicurezza online", params: {}, profile: {}, shifts
    });
    const shift = (id, start = "08:00", end = "16:00") => ({
      id, date: "2026-11-07", type: "turno", start_time: start,
      end_time: end, hours: 8, post: "Sede A"
    });
    const report = inspectLegacyReconciliation([
      { source: "export-1", rawJson: make([shift("duplicate-a"), shift("duplicate-b")]) },
      { source: "export-2", rawJson: make([shift("different", "16:00", "20:00")]) }
    ]);
    assert(report.possibleDuplicates.length === 1, "Duplicato interno alla fonte non rilevato.");
    assert(report.possibleDuplicates[0].copies.length === 2, "Riferimenti dei duplicati incompleti.");
    assert(report.possibleDuplicates[0].reason.includes("stessa fonte"), "Motivazione del duplicato errata.");
    assert(report.writesPerformed === false && report.automaticMergePerformed === false, "La riconciliazione ha modificato dati.");
  });

  await test("LEGACY-020 — possibili duplicati tra fonti senza ID legacy", async () => {
    const make = () => JSON.stringify({
      app: "Turni Gpg/sicurezza online", params: {}, profile: {},
      shifts: [{ date: "2026-11-08", type: "turno", post: "Sede A",
        start_time: "08:00", end_time: "16:00", hours: 8 }]
    });
    const report = inspectLegacyReconciliation([
      { source: "export-senza-id-A", rawJson: make() },
      { source: "export-senza-id-B", rawJson: make() }
    ]);
    assert(report.possibleDuplicates.length === 1, "Possibile duplicato senza ID non segnalato.");
    assert(report.possibleDuplicates[0].copies.length === 2, "Riferimenti alle due fonti incompleti.");
    assert(report.possibleDuplicates[0].reason.includes("senza identificativi"), "Motivazione non distingue gli ID mancanti.");
    assert(report.identicalRecords.length === 0, "Record senza ID classificati come copie certe.");
    assert(report.writesPerformed === false && report.automaticMergePerformed === false, "La riconciliazione ha modificato dati.");
  });

  await test("LEGACY-021 — stesso ID con dati discordanti resta in conflitto", async () => {
    const make = shift => JSON.stringify({
      app: "Turni Gpg/sicurezza online", params: {}, profile: {}, shifts: [shift]
    });
    const base = {
      id: "shared-legacy-id", date: "2026-11-09", type: "turno",
      start_time: "08:00", end_time: "16:00", hours: 8, post: "Sede A"
    };
    const report = inspectLegacyReconciliation([
      { source: "export-precedente", rawJson: make(base) },
      { source: "export-recente", rawJson: make({ ...base, post: "Sede B" }) }
    ]);
    assert(report.idConflicts.length === 1, "Conflitto sullo stesso ID non rilevato.");
    assert(report.idConflicts[0].variants.length === 2, "Le due varianti non sono state conservate.");
    assert(report.idConflicts[0].variants[0].data.post === "Sede A", "Prima variante alterata.");
    assert(report.idConflicts[0].variants[1].data.post === "Sede B", "Seconda variante alterata.");
    assert(report.identicalRecords.length === 0, "Conflitto classificato come copia identica.");
    assert(report.writesPerformed === false && report.automaticMergePerformed === false, "Il conflitto ha prodotto modifiche.");
  });

  await test("LEGACY-022 — stesso ID e stessi dati tra fonti classificati come copie", async () => {
    const make = () => JSON.stringify({
      app: "Turni Gpg/sicurezza online", params: {}, profile: {},
      shifts: [{ id: "shared-identical-id", date: "2026-11-10", type: "turno",
        start_time: "08:00", end_time: "16:00", hours: 8, post: "Sede A" }]
    });
    const report = inspectLegacyReconciliation([
      { source: "export-A", rawJson: make() },
      { source: "export-B", rawJson: make() }
    ]);
    assert(report.identicalRecords.length === 1, "Copia identica con stesso ID non riconosciuta.");
    assert(report.identicalRecords[0].copies.length === 2, "Riferimenti alle fonti incompleti.");
    assert(report.idConflicts.length === 0, "Copia identica classificata come conflitto.");
    assert(report.possibleDuplicates.length === 0, "Copia con stesso ID segnalata anche come possibile duplicato.");
    assert(report.writesPerformed === false && report.automaticMergePerformed === false, "La riconciliazione ha modificato dati.");
  });

  await test("DB-009 — campi riservati rifiutati", async () => {
    let caught; try { await profiles.create({ accountId: "browser-test-account-B" }); } catch (error) { caught = error; }
    assert(caught?.code === DB_ERROR_CODES.VALIDATION_FAILED, "accountId non rifiutato.");
  });

  await test("HIST-000A — impostazioni registrate automaticamente e isolate per account", async () => {
    const settings = new SettingsRepository({ db, accountContext: context });
    const history = new HistoryRepository({ db, accountContext: context });
    const setting = await settings.create({ preference: "compact", enabled: true });
    await settings.update(setting.id, { enabled: false }, { expectedRevision: 1 });
    await settings.delete(setting.id, { expectedRevision: 2 });
    const events = (await history.getEvents()).filter(item => item.data.entityId === setting.id);
    assert(events.length === 3, "Creazione, modifica e cancellazione impostazione non registrate.");
    assert(events.map(item => item.data.action).join(",") === "create,update,delete",
      "Sequenza eventi impostazione errata.");
    assert(events[1].data.previousRevision === 1 && events[1].data.newRevision === 2,
      "Revisioni modifica impostazione errate.");
    assert(events[2].data.previousRevision === 2, "Revisione cancellazione impostazione errata.");
    context.activate({ accountId: "browser-test-account-B", identitySource: "local" });
    assert((await settings.getAll()).every(item => item.id !== setting.id), "Account B legge impostazioni di A.");
    assert((await history.getEvents()).every(item => item.data.entityId !== setting.id),
      "Account B legge eventi impostazione di A.");
    context.activate({ accountId: "browser-test-account-A", identitySource: "local" });
    assert((await history.getEvents()).filter(item => item.data.entityId === setting.id).length === 3,
      "Account A non ritrova lo storico impostazione.");
  });

  await test("SET-001 — impostazioni limitate a valori primitivi e dimensioni controllate", async () => {
    const settings = new SettingsRepository({ db, accountContext: context });
    const valid = await settings.create({ preference: "compact", enabled: true, scale: 1.25, optional: null });
    assert(valid.data.preference === "compact", "Impostazione valida non salvata.");
    const invalidPayloads = [
      { privateData: { value: "nested" } },
      { entries: ["one", "two"] },
      { oversized: "x".repeat(257) },
      { "chiave non valida": true },
      { amount: Number.NaN },
      { amount: Number.POSITIVE_INFINITY }
    ];
    for (const payload of invalidPayloads) {
      let caught;
      try { await settings.create(payload); } catch (error) { caught = error; }
      assert(caught?.code === DB_ERROR_CODES.VALIDATION_FAILED, "Payload impostazione non valido accettato.");
    }
    let updateError;
    try { await settings.update(valid.id, { details: { unexpected: true } }, { expectedRevision: valid.revision }); }
    catch (error) { updateError = error; }
    assert(updateError?.code === DB_ERROR_CODES.VALIDATION_FAILED, "Aggiornamento annidato non rifiutato.");
    const updated = await settings.update(valid.id, { enabled: false }, { expectedRevision: valid.revision });
    assert(updated.data.enabled === false && updated.revision === 2, "Aggiornamento semplice valido non riuscito.");
  });

  await test("SET-002 — limiti impostazioni verificati ai valori di confine", async () => {
    const settings = new SettingsRepository({ db, accountContext: context });
    const atLimit = Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`option${index}`, index]));
    const saved = await settings.create(atLimit);
    assert(Object.keys(saved.data).length === 30, "Il limite massimo di 30 chiavi non è rispettato.");
    const longKey = "a".repeat(64);
    const longKeyRecord = await settings.create({ [longKey]: "ok" });
    assert(longKeyRecord.data[longKey] === "ok", "La chiave al limite di 64 caratteri non è stata accettata.");
    const invalidPayloads = [
      {},
      Object.fromEntries(Array.from({ length: 31 }, (_, index) => [`option${index}`, index])),
      { [`a${"b".repeat(64)}`]: true }
    ];
    for (const payload of invalidPayloads) {
      let caught;
      try { await settings.create(payload); } catch (error) { caught = error; }
      assert(caught?.code === DB_ERROR_CODES.VALIDATION_FAILED, "Payload fuori dai limiti accettato.");
    }
    let updateError;
    try {
      await settings.update(saved.id, Object.fromEntries(Array.from({ length: 31 }, (_, index) => [`option${index}`, index])));
    } catch (error) { updateError = error; }
    assert(updateError?.code === DB_ERROR_CODES.VALIDATION_FAILED, "Aggiornamento oltre 30 chiavi accettato.");
    const persisted = await settings.getById(saved.id);
    assert(persisted.revision === 1 && Object.keys(persisted.data).length === 30,
      "Un aggiornamento non valido ha alterato l'impostazione originale.");
  });

  await test("HIST-000 — modifiche profilo e turno registrate automaticamente", async () => {
    const history = new HistoryRepository({ db, accountContext: context });
    const profile = await profiles.create({ displayName: "Profilo audit test" });
    await profiles.update(profile.id, { displayName: "Profilo audit aggiornato" }, { expectedRevision: 1 });
    await profiles.delete(profile.id, { expectedRevision: 2 });
    const shiftRepository = new ShiftRepository({ db, accountContext: context });
    const shift = await shiftRepository.create({ date: "2099-02-01", type: "TEST" });
    const events = (await history.getEvents()).filter(item =>
      item.data.entityId === profile.id || item.data.entityId === shift.id
    );
    const profileEvents = events.filter(item => item.data.entityId === profile.id);
    assert(profileEvents.length === 3, "Creazione, modifica e cancellazione profilo non registrate.");
    assert(profileEvents.map(item => item.data.action).join(",") === "create,update,delete",
      "Sequenza eventi profilo errata.");
    assert(profileEvents[1].data.previousRevision === 1 && profileEvents[1].data.newRevision === 2,
      "Revisioni modifica profilo errate.");
    assert(profileEvents[2].data.previousRevision === 2, "Revisione cancellazione profilo errata.");
    const shiftEvents = events.filter(item => item.data.entityId === shift.id);
    assert(shiftEvents.length === 1 && shiftEvents[0].data.action === "create",
      "Creazione turno non registrata automaticamente.");
    assert(events.every(item => Object.keys(item.data).every(key =>
      ["entityType", "entityId", "action", "previousRevision", "newRevision"].includes(key)
    )), "Lo storico contiene campi oltre la lista consentita.");
  });

  await test("HIST-000B — consultazione cronologia filtrata e limitata", async () => {
    const history = new HistoryRepository({ db, accountContext: context });
    const profile = await profiles.create({ displayName: "Cronologia consultabile" });
    await profiles.update(profile.id, { displayName: "Cronologia aggiornata" }, { expectedRevision: 1 });
    const entityEvents = await history.getEventsForEntity("profile", profile.id);
    assert(entityEvents.length === 2, "Filtro per entità restituisce un numero errato di eventi.");
    assert(entityEvents[0].data.action === "create" && entityEvents[1].data.action === "update",
      "Gli eventi della stessa entità non sono ordinati cronologicamente.");
    const recent = await history.getRecentEvents(2);
    assert(recent.length <= 2, "Il limite della cronologia recente non è rispettato.");
    const allRecentForEntity = (await history.getRecentEvents(200))
      .filter(event => event.data.entityId === profile.id);
    assert(allRecentForEntity.length === 2 &&
      allRecentForEntity[0].data.action === "update" &&
      allRecentForEntity[1].data.action === "create",
      "La cronologia recente non ordina gli eventi della stessa entità dal più nuovo.");
    let invalidFilter, invalidLimit;
    try { await history.getEventsForEntity("unknown", profile.id); } catch (error) { invalidFilter = error; }
    try { await history.getRecentEvents(201); } catch (error) { invalidLimit = error; }
    assert(invalidFilter?.code === DB_ERROR_CODES.VALIDATION_FAILED, "Filtro non valido accettato.");
    assert(invalidLimit?.code === DB_ERROR_CODES.VALIDATION_FAILED, "Limite eccessivo accettato.");
  });

  await test("HIST-000C — servizio storico presenta eventi senza dati interni", async () => {
    const historyRepository = new HistoryRepository({ db, accountContext: context });
    const historyService = new HistoryService({ repository: historyRepository });
    const profile = await profiles.create({ displayName: "Profilo non esposto nello storico" });
    await profiles.update(profile.id, { displayName: "Nome modificato" }, { expectedRevision: 1 });
    const events = await historyService.getEventsForEntity("profile", profile.id);
    assert(events.length === 2, "Il servizio non restituisce gli eventi attesi.");
    assert(events[0].entityLabel === "Profilo" && events[0].actionLabel === "Creato",
      "Etichette evento creazione errate.");
    assert(events[1].actionLabel === "Modificato" && events[1].previousRevision === 1 &&
      events[1].newRevision === 2, "Descrizione o revisioni modifica errate.");
    assert(typeof events[0].occurredAt === "string" && events[0].description === "Profilo creato",
      "Data o descrizione leggibile mancante.");
    assert(events.every(event => !Object.hasOwn(event, "entityId") &&
      !Object.hasOwn(event, "data") && !Object.hasOwn(event, "raw") &&
      !Object.hasOwn(event, "payload")), "Il servizio espone identificativi o payload interni.");
    const recent = await historyService.getRecentEvents(10);
    assert(recent.length <= 10 && recent.some(event => event.description === "Profilo modificato"),
      "Consultazione recente del servizio non funzionante.");
    let frozen = false;
    try { events[0].description = "Alterato"; } catch { frozen = true; }
    assert(Object.isFrozen(events) && (frozen || events[0].description === "Profilo creato"),
      "Risultati del servizio non protetti da modifiche accidentali.");
  });

  await test("HIST-000D — interfaccia cronologia usa testo sicuro e stato vuoto", async () => {
    const container = document.createElement("section");
    const malicious = {
      id: "event-1", occurredAt: "2026-11-23T10:00:00.000Z",
      entityLabel: "Profilo", actionLabel: "Creato",
      description: '<img src=x onerror=alert(1)>', revision: 1, newRevision: 1
    };
    assert(renderHistoryEvents(container, [malicious]) === 1, "Numero eventi renderizzati errato.");
    assert(container.querySelector("img") === null, "Il renderer ha interpretato HTML fornito come testo.");
    assert(container.textContent.includes(malicious.description), "Il testo dell'evento non è stato mostrato in modo letterale.");
    assert(container.querySelector("time")?.getAttribute("datetime") === malicious.occurredAt,
      "Data semantica non impostata.");
    assert(renderHistoryEvents(container, []) === 0, "Stato vuoto restituisce un conteggio errato.");
    assert(container.textContent.includes("Nessuna attività registrata"), "Stato vuoto non mostrato.");
    let invalid;
    try { renderHistoryEvents(container, [{ ...malicious, entityLabel: "Altro" }]); } catch (error) { invalid = error; }
    assert(invalid instanceof TypeError, "Evento con categoria non consentita accettato.");
    for (const patch of [
      { occurredAt: "data-non-valida" },
      { revision: 0 },
      { newRevision: "2" },
      { description: "x".repeat(201) }
    ]) {
      let rejected;
      try { renderHistoryEvents(container, [{ ...malicious, ...patch }]); } catch (error) { rejected = error; }
      assert(rejected instanceof TypeError, "Metadati cronologici non validi accettati.");
    }
  });

  await test("HIST-001 — registra evento storico sanitizzato", async () => {
    const history = new HistoryRepository({ db, accountContext: context });
    const event = await history.recordEvent({
      entityType: "shift",
      entityId: "test-shift-001",
      action: "create",
      newRevision: 1
    });
    assert(event.data.entityType === "shift", "Categoria evento errata.");
    assert(event.data.entityId === "test-shift-001", "ID entità errato.");
    assert(event.data.action === "create", "Azione errata.");
    assert(event.data.newRevision === 1, "Revisione nuova errata.");
    assert(event.revision === 1, "Revisione del record storico errata.");
    assert(Object.keys(event.data).every(key =>
      ["entityType", "entityId", "action", "previousRevision", "newRevision"].includes(key)
    ), "Il record contiene campi non autorizzati.");
    assert(!Object.hasOwn(event.data, "raw") && !Object.hasOwn(event.data, "payload"),
      "Il record contiene un payload grezzo.");
  });

  await test("HIST-002 — rifiuta campi non autorizzati e revisioni incoerenti", async () => {
    const history = new HistoryRepository({ db, accountContext: context });
    let rawPayload, badRevision;
    try {
      await history.create({
        entityType: "shift", entityId: "test-shift-002",
        action: "create", newRevision: 1,
        raw: { privateValue: "never-store" }
      });
    } catch (error) { rawPayload = error; }
    try {
      await history.recordEvent({
        entityType: "shift", entityId: "test-shift-003",
        action: "update", previousRevision: 1, newRevision: 3
      });
    } catch (error) { badRevision = error; }
    assert(rawPayload?.code === DB_ERROR_CODES.VALIDATION_FAILED,
      "Payload grezzo accettato.");
    assert(badRevision?.code === DB_ERROR_CODES.VALIDATION_FAILED,
      "Revisioni incoerenti accettate.");
  });

  await test("HIST-003 — eventi isolati per account e non modificabili", async () => {
    const history = new HistoryRepository({ db, accountContext: context });
    const event = await history.recordEvent({
      entityType: "profile", entityId: "test-profile-001",
      action: "create", newRevision: 1
    });
    let updateError, deleteError;
    try { await history.update(event.id, { action: "delete" }); } catch (error) { updateError = error; }
    try { await history.delete(event.id); } catch (error) { deleteError = error; }
    assert(updateError?.code === DB_ERROR_CODES.VALIDATION_FAILED,
      "Modifica evento consentita.");
    assert(deleteError?.code === DB_ERROR_CODES.VALIDATION_FAILED,
      "Cancellazione evento consentita.");
    context.activate({ accountId: "browser-test-account-B", identitySource: "local" });
    assert(await history.getById(event.id) === null, "Account B legge l'evento di A.");
    context.activate({ accountId: "browser-test-account-A", identitySource: "local" });
    assert((await history.getById(event.id))?.id === event.id,
      "Account A non ritrova il proprio evento.");
  });

  await test("HIST-004 — eventi persistono dopo riapertura database", async () => {
    const historyBefore = new HistoryRepository({ db, accountContext: context });
    const event = await historyBefore.recordEvent({
      entityType: "setting", entityId: "test-setting-001",
      action: "update", previousRevision: 1, newRevision: 2
    });
    await closeDSMDatabase();
    db = await openDSMDatabase({ name: TEST_DB_NAME });
    const historyAfter = new HistoryRepository({ db, accountContext: context });
    const persisted = await historyAfter.getById(event.id);
    assert(persisted?.data.action === "update", "Evento non persistito.");
    assert(persisted?.data.newRevision === 2, "Revisione evento persistita errata.");
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
