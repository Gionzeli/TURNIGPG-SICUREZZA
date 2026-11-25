const DB_NAME = "turni-gpg-ocr-learning";
const STORE = "rules";
const MAX_RULES = 120;

const TARGETS = Object.freeze({
  payroll: Object.freeze({
    paga_base: "paga base",
    scatti: "scatti",
    altre_fisse: "superminimo",
    ore_mensili: "ore mensili",
    ore_turno: "ore turno",
    straordinario_perc: "maggiorazione straordinario",
    straordinario_ora: "compenso straordinario",
    notturno_turno: "indennita notturna",
    piantonato_turno: "piantonamento",
    domenica_ora: "maggiorazione domenicale",
    riposo_non_goduto: "riposo non goduto",
    buono_pasto: "buono pasto",
    inps_rate: "aliquota inps",
    irpef_rate: "aliquota irpef",
    sindacato: "trattenuta sindacale",
    cessione: "cessione del quinto",
    altre_trattenute: "altre trattenute"
  }),
  turns: Object.freeze({
    turno: "turno",
    riposo: "riposo",
    riposo_compensativo: "riposo compensativo",
    ferie: "ferie",
    permesso: "permesso",
    malattia: "malattia"
  }),
  training: Object.freeze({
    title: "corso",
    issuer: "ente",
    date: "data",
    expiry: "scadenza",
    hours: "ore"
  })
});

const fold = value => String(value ?? "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLocaleLowerCase("it-IT")
  .replace(/\s+/g, " ")
  .trim();


const GENERIC_ALIAS_WORDS = Object.freeze({
  payroll: Object.freeze({
    paga_base: "paga base retribuzione contrattuale minimo tabellare stipendio compenso mensile lordo lorda",
    scatti: "scatto scatti anzianita maturazione maturati progressione periodici",
    altre_fisse: "superminimo indennita elemento aggiuntivo fisso fissa retributivo compenso",
    ore_mensili: "ore mensili orario contrattuale lavoro mensilita",
    ore_turno: "ore turno durata servizio giornaliere",
    straordinario_perc: "straordinario maggiorazione percentuale aliquota",
    straordinario_ora: "straordinario compenso orario paga",
    notturno_turno: "notturna notturno indennita turno",
    piantonato_turno: "piantonamento piantonato indennita turno",
    domenica_ora: "domenicale domenica festiva festivita maggiorazione",
    riposo_non_goduto: "riposo goduto non indennita",
    buono_pasto: "buono pasto ticket mensa",
    inps_rate: "inps aliquota contributi contributiva",
    irpef_rate: "irpef aliquota ritenuta fiscale",
    sindacato: "sindacale sindacato trattenuta",
    cessione: "cessione quinto prestito",
    altre_trattenute: "altre trattenute deduzioni"
  }),
  turns: Object.freeze({
    turno: "turno servizio orario",
    riposo: "riposo",
    riposo_compensativo: "riposo compensativo recupero",
    ferie: "ferie",
    permesso: "permesso permessi",
    malattia: "malattia assenza"
  }),
  training: Object.freeze({
    title: "corso corsi formazione formativo formativa attestato attestati abilitazione aggiornamento",
    issuer: "ente organizzatore azienda formatore istituto",
    date: "data giorno svolgimento",
    expiry: "scadenza validita valido rinnovo",
    hours: "ore durata formative"
  })
});
const CONNECTOR_WORDS = new Set(["di", "del", "della", "delle", "dei", "da", "per", "al", "alla", "e"]);

export function isSafeLearningAlias(kind, field, value) {
  if (!Object.prototype.hasOwnProperty.call(GENERIC_ALIAS_WORDS, kind) ||
      !Object.prototype.hasOwnProperty.call(GENERIC_ALIAS_WORDS[kind], field)) return false;
  const alias = String(value ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
  if (alias.length < 3 || alias.length > 48 ||
      !/^[\p{L}][\p{L}\s'’.-]*[\p{L}]$/u.test(alias)) return false;
  if (/\d|@|https?:|€|\b(?:iban|codice fiscale|codicefiscale|matricola|telefono|cellulare|email|e-mail|indirizzo|nome e cognome)\b/i.test(alias)) return false;
  if (alias.split(/\s+/).length > 6) return false;
  const allowed = new Set(GENERIC_ALIAS_WORDS[kind][field].split(/\s+/).concat([...CONNECTOR_WORDS]));
  const words = fold(alias).match(/[\p{L}]+/gu) || [];
  return words.length > 0 && words.every(word => allowed.has(word));
}

function sanitizeAlias(kind, field, value) {
  const alias = String(value ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
  return isSafeLearningAlias(kind, field, alias) ? alias : null;
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Operazione archivio locale non riuscita"));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () => reject(transaction.error || new Error("Transazione archivio locale non riuscita"));
  });
}

export function createLocalLearning(options = {}) {
  const databaseName = typeof options.databaseName === "string" && options.databaseName
    ? options.databaseName
    : DB_NAME;
  let database = null;
  let records = [];
  let applyEnabled = true;
  let closed = false;
  let storageGeneration = 0;
  const activeTransactions = new Set();
  let channel = null;
  let syncChannelAvailable = false;
  let cancelOpening = null;
  try {
    if (typeof globalThis.BroadcastChannel === "function") {
      channel = new BroadcastChannel("ocr-learning-sync:" + databaseName);
      channel.onmessage = event => {
        if (event?.data?.type === "refresh" && !closed) refreshFromDatabase();
      };
      syncChannelAvailable = true;
    }
  } catch {
    try { channel?.close(); } catch { /* canale non inizializzato */ }
    channel = null;
  }
  async function refreshFromDatabase() {
    if (!database || closed) return;
    const activeDatabase = database;
    const generation = storageGeneration;
    try {
      const tx = activeDatabase.transaction(STORE, "readonly");
      const done = trackTransaction(tx);
      const rows = await requestResult(tx.objectStore(STORE).getAll());
      await done;
      // Una lettura completata dopo close/versionchange non deve ripopolare la cache.
      if (closed || database !== activeDatabase || storageGeneration !== generation) return;
      records = rows.filter(isValidStoredRule).slice(0, MAX_RULES);
    } catch (error) {
      // Non invalidare una nuova generazione per un errore appartenente alla vecchia.
      if (!closed && database === activeDatabase && storageGeneration === generation) {
        invalidateStorage();
      }
    }
  }
  function trackTransaction(transaction) {
    activeTransactions.add(transaction);
    const done = transactionDone(transaction);
    done.then(
      () => activeTransactions.delete(transaction),
      () => activeTransactions.delete(transaction)
    );
    return done;
  }
  function invalidateStorage() {
    storageGeneration += 1;
    records = [];
    applyEnabled = false;
    closed = true;
    for (const transaction of activeTransactions) {
      try { transaction.abort(); } catch { /* transazione già conclusa */ }
    }
    activeTransactions.clear();
    if (database) database.close();
    database = null;
    if (cancelOpening) {
      const cancel = cancelOpening;
      cancelOpening = null;
      cancel(new Error("Archivio apprendimento chiuso durante l'inizializzazione"));
    }
    try { channel?.close(); } catch { /* canale già chiuso */ }
    channel = null;
    syncChannelAvailable = false;
  }
  async function waitForWrite(done) {
    try {
      await done;
    } catch (error) {
      // Una transazione fallita può lasciare la cache non più affidabile.
      invalidateStorage();
      throw error;
    }
  }
  function announceChange() {
    if (!channel || !syncChannelAvailable) return false;
    try {
      channel.postMessage({ type: "refresh" });
      return true;
    } catch {
      syncChannelAvailable = false;
      try { channel.close(); } catch { /* canale già chiuso */ }
      channel = null;
      return false;
    }
  }

  const ready = new Promise((resolve, reject) => {
    let settled = false;
    cancelOpening = error => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    if (!globalThis.indexedDB) {
      reject(new Error("IndexedDB non disponibile: apprendimento locale disattivato"));
      return;
    }
    // Usa la versione esistente del database: non tentare downgrade dopo un upgrade.
    const opening = indexedDB.open(databaseName);
    let upgradeError = null;
    opening.onupgradeneeded = () => {
      try {
        const db = opening.result;
        const store = db.objectStoreNames.contains(STORE)
          ? opening.transaction.objectStore(STORE)
          : db.createObjectStore(STORE, { keyPath: "id" });
        if (!store.indexNames.contains("kind")) {
          store.createIndex("kind", "kind", { unique: false });
        }
      } catch (error) {
        upgradeError = error;
        try { opening.transaction?.abort(); } catch { /* upgrade già annullato */ }
      }
    };
    opening.onsuccess = async () => {
      // onblocked non annulla la richiesta: se arriva un success tardivo, evita di
      // lasciare aperta una connessione dopo che ready è già stato rifiutato.
      if (settled || closed) {
        opening.result.close();
        if (!settled) {
          settled = true;
          reject(new Error("Archivio apprendimento chiuso durante l'inizializzazione"));
        }
        return;
      }
      database = opening.result;
      const openingDatabase = database;
      const generation = storageGeneration;
      database.onversionchange = () => invalidateStorage();
      database.onclose = () => invalidateStorage();
      try {
        const tx = openingDatabase.transaction(STORE, "readonly");
        const done = trackTransaction(tx);
        const rows = await requestResult(tx.objectStore(STORE).getAll());
        await done;
        if (closed || database !== openingDatabase || storageGeneration !== generation) {
          throw new Error("Archivio apprendimento invalidato durante l'inizializzazione");
        }
        records = rows.filter(isValidStoredRule).slice(0, MAX_RULES);
        settled = true;
        cancelOpening = null;
        resolve();
      } catch (error) {
        cancelOpening = null;
        invalidateStorage();
        settled = true;
        reject(error);
      }
    };
    opening.onerror = () => {
      if (settled) return;
      settled = true;
      cancelOpening = null;
      reject(upgradeError || opening.error || new Error("Archivio apprendimento non apribile"));
    };
    opening.onblocked = () => {
      if (settled) return;
      settled = true;
      cancelOpening = null;
      reject(new Error("Archivio apprendimento bloccato da un'altra scheda"));
    };
  });

  function isValidStoredRule(rule) {
    return !!rule &&
      typeof rule.id === "string" &&
      Object.prototype.hasOwnProperty.call(TARGETS, rule.kind) &&
      Object.prototype.hasOwnProperty.call(TARGETS[rule.kind], rule.field) &&
      typeof rule.alias === "string" &&
      sanitizeAlias(rule.kind, rule.field, rule.alias) === rule.alias;
  }

  function assertOpen() {
    if (closed || !database) throw new Error("Archivio apprendimento non disponibile");
  }

  function assertCurrentStorage(activeDatabase, generation) {
    if (closed || database !== activeDatabase || storageGeneration !== generation) {
      throw new Error("Operazione annullata: archivio apprendimento invalidato");
    }
  }

  function list(kind) {
    const selected = records.filter(rule => !kind || rule.kind === kind);
    return selected.map(rule => ({ ...rule }));
  }

  function applyAliases(text, kind) {
    const source = String(text ?? "");
    if (closed || !applyEnabled || !TARGETS[kind]) return source;
    let result = source;
    const applicable = records
      .filter(rule => rule.kind === kind)
      .sort((a, b) => b.alias.length - a.alias.length);
    for (const rule of applicable) {
      const escaped = rule.alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const matcher = new RegExp("(^|[^\\p{L}])(" + escaped + ")(?=$|[^\\p{L}])", "giu");
      result = result.replace(matcher, (_match, prefix) => prefix + TARGETS[kind][rule.field]);
    }
    return result;
  }

  async function addAlias({ kind, field, alias }) {
    await ready;
    assertOpen();
    if (!Object.prototype.hasOwnProperty.call(TARGETS, kind) ||
        !Object.prototype.hasOwnProperty.call(TARGETS[kind], field)) {
      throw new TypeError("Campo di apprendimento non consentito");
    }
    const safeAlias = sanitizeAlias(kind, field, alias);
    if (!safeAlias) throw new TypeError("Inserisci solo un'etichetta generica, senza numeri o dati personali");
    const normalizedAlias = fold(safeAlias);
    const id = kind + ":" + field + ":" + normalizedAlias;
    const rule = { id, kind, field, alias: safeAlias, normalizedAlias, createdAt: new Date().toISOString(), version: 1 };
    // Il conteggio e il controllo duplicati avvengono nella stessa transazione
    // readwrite della scrittura: più schede/chiamate non possono superare il limite.
    const activeDatabase = database;
    const generation = storageGeneration;
    const tx = activeDatabase.transaction(STORE, "readwrite");
    const done = trackTransaction(tx);
    const store = tx.objectStore(STORE);
    const read = store.getAll();
    let duplicate = null;
    let persistedRows = [];
    let limitReached = false;
    let requestFailure = null;
    read.onerror = () => {
      requestFailure = read.error || new Error("Lettura delle regole locali non riuscita");
      try { tx.abort(); } catch { /* transazione già conclusa */ }
    };
    read.onsuccess = () => {
      try {
        const persisted = read.result.filter(isValidStoredRule);
        persistedRows = persisted;
        duplicate = persisted.find(item => item.id === id) || null;
        if (duplicate) return;
        if (persisted.length >= MAX_RULES) {
          limitReached = true;
          return;
        }
        const write = store.put(rule);
        write.onerror = () => {
          requestFailure = write.error || new Error("Scrittura della regola locale non riuscita");
          // Lascia propagare l'errore alla transazione, che verrà abortita.
        };
      } catch (error) {
        requestFailure = error;
        try { tx.abort(); } catch { /* transazione già conclusa */ }
      }
    };
    try {
      await waitForWrite(done);
    } catch (error) {
      throw requestFailure || error;
    }
    assertCurrentStorage(activeDatabase, generation);
    records = persistedRows;
    if (duplicate) return { ...duplicate, duplicate: true };
    if (limitReached) throw new RangeError("Limite massimo di regole locali raggiunto");
    records = records.filter(item => item.id !== id);
    records.push(rule);
    announceChange();
    return { ...rule };
  }

  async function removeAlias(id) {
    await ready;
    assertOpen();
    const activeDatabase = database;
    const generation = storageGeneration;
    let done;
    try {
      const tx = activeDatabase.transaction(STORE, "readwrite");
      done = trackTransaction(tx);
      tx.objectStore(STORE).delete(String(id));
    } catch (error) {
      // Anche un errore sincrono nell'apertura/preparazione della transazione
      // rende non affidabile lo stato locale: chiudi in modo fail-closed.
      invalidateStorage();
      throw error;
    }
    await waitForWrite(done);
    assertCurrentStorage(activeDatabase, generation);
    records = records.filter(rule => rule.id !== id);
    announceChange();
  }

  async function clear() {
    await ready;
    assertOpen();
    const activeDatabase = database;
    const generation = storageGeneration;
    let done;
    try {
      const tx = activeDatabase.transaction(STORE, "readwrite");
      done = trackTransaction(tx);
      tx.objectStore(STORE).clear();
    } catch (error) {
      // Non lasciare attiva una cache che potrebbe divergere dal database.
      invalidateStorage();
      throw error;
    }
    await waitForWrite(done);
    assertCurrentStorage(activeDatabase, generation);
    records = [];
    announceChange();
  }

  function normalizeWrittenValue(type, value) {
    const raw = String(value ?? "").replace(/\u00a0/g, " ").trim();
    if (type === "text") return raw.replace(/[\t ]+/g, " ").replace(/\s*([,;:])\s*/g, "$1 ").trim().slice(0, 180);
    if (type === "date") {
      let match = raw.match(/^(\d{1,2})[/. -](\d{1,2})[/. -](\d{4})$/);
      if (match) {
        const day = Number(match[1]), month = Number(match[2]), year = Number(match[3]);
        const date = new Date(year, month - 1, day);
        if (date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day) {
          return year + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
        }
      }
      match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (match) {
        const date = new Date(raw + "T12:00:00");
        if (!Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === raw) return raw;
      }
      return raw;
    }
    if (type === "time") {
      const match = raw.match(/^(\d{1,2})\s*[:,.]\s*(\d{2})$/);
      if (!match) return raw;
      const hour = Number(match[1]), minute = Number(match[2]);
      return hour < 24 && minute < 60
        ? String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0")
        : raw;
    }
    if (type === "amount" || type === "hours") {
      let numberText = raw.replace(/[€\s]/g, "");
      if (numberText.includes(",")) numberText = numberText.replace(/\./g, "").replace(",", ".");
      else if ((numberText.match(/\./g) || []).length > 1) numberText = numberText.replace(/\./g, "");
      const number = Number(numberText);
      if (!Number.isFinite(number)) return raw;
      return number.toLocaleString("it-IT", {
        minimumFractionDigits: type === "amount" ? 2 : 0,
        maximumFractionDigits: 2
      });
    }
    return raw;
  }

  return {
    ready,
    list,
    addAlias,
    removeAlias,
    clear,
    applyAliases,
    normalizeWrittenValue,
    setApplyEnabled(value) { applyEnabled = value === true && !closed && !!database; },
    get syncChannelAvailable() { return syncChannelAvailable && !!channel; },
    get applyEnabled() { return applyEnabled; },
    get available() { return !!database && !closed; },
    close() {
      invalidateStorage();
    },
    async destroy() {
      // Invalida subito cache, applicazione alias e letture pendenti, anche se
      // deleteDatabase resta bloccato da connessioni aperte in altre schede.
      invalidateStorage();
      if (!globalThis.indexedDB) return;
      await new Promise((resolve, reject) => {
        const deletion = indexedDB.deleteDatabase(databaseName);
        deletion.onsuccess = () => resolve();
        deletion.onerror = () => reject(deletion.error || new Error("Archivio non cancellato"));
        deletion.onblocked = () => reject(new Error("Chiusura delle altre schede necessaria per cancellare l'archivio"));
      });
    }
  };
}
