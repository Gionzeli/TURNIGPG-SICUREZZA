import { DatabaseError, DB_ERROR_CODES } from "../database/database-errors.js";

const PARAMETER_KEYS = [
  "paga_base", "scatti", "altre_fisse", "ore_mensili", "ore_turno", "straordinario_perc",
  "straordinario_ora", "notturno_turno", "piantonato_turno", "domenica_ora",
  "riposo_non_goduto", "buono_pasto", "inps_rate", "irpef_rate", "sindacato",
  "cessione", "altre_trattenute"
];
const PROFILE_KEYS = ["ccnl", "section", "level", "role", "effective_date"];
const SHIFT_TYPES = new Set(["turno", "turno_riposo", "riposo", "riposo_compensativo", "ferie", "permesso", "malattia"]);
const SHIFT_FLAGS = ["is_night", "is_sunday", "is_piantonato", "is_rest_not_enjoyed", "has_meal_voucher"];
const SHIFT_FIELDS = ["date", "type", "post", "start_time", "end_time", ...SHIFT_FLAGS, "hours", "id"];

function invalid(message) {
  throw new DatabaseError(DB_ERROR_CODES.VALIDATION_FAILED, message);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function isRealDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  // setUTCFullYear avoids Date.UTC's special handling of years 0–99.
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function validTime(value) {
  return value === "" || (typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value));
}

function validateProfileSection(value) {
  if (value !== undefined && !isObject(value)) return "La sezione profile non è un oggetto semplice.";
  const profile = value ?? {};
  for (const key of Object.keys(profile)) {
    if (!PROFILE_KEYS.includes(key)) return `Campo profilo non riconosciuto: ${key}.`;
  }
  for (const key of PROFILE_KEYS) {
    const item = profile[key] ?? "";
    if (typeof item !== "string" || item.length > 120) return `Valore profilo non valido: ${key}.`;
  }
  if (profile.effective_date && !isRealDate(profile.effective_date)) return "Data di decorrenza inesistente o non valida.";
  return null;
}

function validateParams(value) {
  if (value !== undefined && !isObject(value)) return "La sezione params non è un oggetto semplice.";
  const params = value ?? {};
  for (const [key, item] of Object.entries(params)) {
    if (!PARAMETER_KEYS.includes(key)) return `Parametro non riconosciuto: ${key}.`;
    if (typeof item !== "number" || !Number.isFinite(item) || item < 0) return `Parametro non numerico o negativo: ${key}.`;
    if (["straordinario_perc", "inps_rate", "irpef_rate"].includes(key) && item > 100) return `Percentuale fuori intervallo: ${key}.`;
  }
  return null;
}

function inspectShift(item, index, seenIds) {
  const quarantine = reason => ({ index, reason, raw: item });
  if (!isObject(item)) return quarantine("Il turno non è un oggetto semplice.");
  if (!isRealDate(item.date)) return quarantine("Data turno inesistente o non valida.");
  if (!SHIFT_TYPES.has(item.type)) return quarantine("Tipo turno non riconosciuto.");
  if (typeof (item.post ?? "") !== "string" || (item.post ?? "").length > 80) return quarantine("Sede/nota non valida o oltre 80 caratteri.");
  if (!validTime(item.start_time ?? "") || !validTime(item.end_time ?? "")) return quarantine("Orario non valido.");
  if (typeof (item.hours ?? 0) !== "number" || !Number.isFinite(item.hours ?? 0) || (item.hours ?? 0) < 0 || (item.hours ?? 0) > 48) {
    return quarantine("Ore non numeriche o fuori intervallo 0–48.");
  }
  for (const key of SHIFT_FLAGS) {
    if (item[key] !== undefined && typeof item[key] !== "boolean") return quarantine(`Indicatore ${key} non booleano; richiede verifica.`);
  }
  const unknown = Object.keys(item).filter(key => !SHIFT_FIELDS.includes(key));
  if (unknown.length) return quarantine(`Campi aggiuntivi da mappare esplicitamente: ${unknown.join(", ")}.`);
  let id = null;
  if (item.id !== undefined && item.id !== null && String(item.id)) {
    id = String(item.id).replace(/[^\w-]/g, "");
    if (!id || id.length > 200) return quarantine("Identificativo turno non valido dopo la normalizzazione legacy.");
    if (seenIds.has(id)) return quarantine("Identificativo turno duplicato dopo la normalizzazione legacy.");
    seenIds.add(id);
  }
  const normalized = {
    date: item.date,
    type: item.type,
    post: item.post ?? "",
    start_time: item.start_time ?? "",
    end_time: item.end_time ?? "",
    is_night: item.is_night ?? false,
    is_sunday: item.is_sunday ?? false,
    is_piantonato: item.is_piantonato ?? false,
    is_rest_not_enjoyed: item.is_rest_not_enjoyed ?? false,
    has_meal_voucher: item.has_meal_voucher ?? false,
    hours: item.hours ?? 0
  };
  return { index, legacyId: id, normalized, warnings: id !== null && id !== item.id ? ["L'ID verrà normalizzato come nel vecchio cleanShift."] : [] };
}

/**
 * Analizza una stringa JSON esportata dalla chiave legacy tg_online_v1.
 * Non legge LocalStorage, non apre IndexedDB e non scrive né modifica dati.
 */
export function inspectLegacySnapshot(rawJson) {
  if (typeof rawJson !== "string" || !rawJson.trim()) invalid("Snapshot legacy vuoto o non testuale.");
  let source;
  try { source = JSON.parse(rawJson); }
  catch { invalid("Snapshot legacy non è JSON valido."); }
  if (!isObject(source)) invalid("Snapshot legacy deve contenere un oggetto JSON.");
  for (const key of Object.keys(source)) {
    if (!["params", "profile", "shifts"].includes(key)) invalid(`Sezione legacy non riconosciuta: ${key}.`);
  }
  if (source.shifts !== undefined && !Array.isArray(source.shifts)) invalid("La sezione shifts deve essere un array.");

  const paramsError = validateParams(source.params);
  const profileError = validateProfileSection(source.profile);
  const seenIds = new Set();
  const shiftResults = (source.shifts ?? []).map((item, index) => inspectShift(item, index, seenIds));
  const ready = shiftResults.filter(item => !item.reason);
  const quarantined = shiftResults.filter(item => item.reason);
  const warnings = [];
  if (source.params?.ore_turno === 7.15) warnings.push("ore_turno vale 7,15: il vecchio runtime può correggerlo automaticamente a 7,25; nessuna correzione è stata applicata.");
  if (source.params?.ore_turno === 12) warnings.push("ore_turno vale 12: il vecchio runtime può correggerlo automaticamente a 7,25; nessuna correzione è stata applicata.");
  if (paramsError) warnings.push(paramsError);
  if (profileError) warnings.push(profileError);

  return Object.freeze({
    source: "tg_online_v1",
    mode: "read-only-preview",
    importable: !paramsError && !profileError && quarantined.length === 0,
    profile: {
      valid: !paramsError && !profileError,
      params: isObject(source.params) ? { ...source.params } : {},
      profile: isObject(source.profile) ? { ...source.profile } : {},
      errors: [paramsError, profileError].filter(Boolean)
    },
    shifts: { total: shiftResults.length, ready, quarantined },
    warnings,
    writesPerformed: false
  });
}

const EXTRA_TOP_KEYS = new Set(["quota", "real", "tpl", "leavePayslip", "skills", "pin", "salt", "name", "role", "mig", "onb", "it"]);

function finiteNonNegative(value) {
  const number = Number(value);
  return value !== null && value !== undefined && Number.isFinite(number) && number >= 0 ? number : null;
}

/**
 * Analizza la chiave tg_extra_v1 senza restituire PIN hash o salt.
 * Nessun accesso a LocalStorage/IndexedDB e nessuna scrittura.
 */
export function inspectLegacyExtras(rawJson) {
  if (typeof rawJson !== "string" || !rawJson.trim()) invalid("Snapshot extra legacy vuoto o non testuale.");
  let source;
  try { source = JSON.parse(rawJson); }
  catch { invalid("Snapshot extra legacy non è JSON valido."); }
  if (!isObject(source)) invalid("Snapshot extra legacy deve contenere un oggetto JSON.");

  const warnings = Object.keys(source).filter(key => !EXTRA_TOP_KEYS.has(key)).map(key => `Campo extra non riconosciuto: ${key}.`);
  const quotaSource = isObject(source.quota) ? source.quota : {};
  if (source.quota !== undefined && !isObject(source.quota)) warnings.push("La sezione quota non è un oggetto.");
  const quota = {};
  for (const field of ["ferie", "perm"]) {
    const parsed = finiteNonNegative(quotaSource[field]);
    quota[field] = parsed ?? 0;
    if (quotaSource[field] !== undefined && parsed === null) warnings.push(`Quota ${field} non valida: il valore non viene considerato attendibile.`);
  }
  const real = {};
  if (isObject(source.real)) {
    for (const [month, value] of Object.entries(source.real)) {
      if (/^\d{4}-\d{2}$/.test(month) && finiteNonNegative(value) !== null) real[month] = Number(value);
      else warnings.push(`Valore mensile extra da verificare: ${month}.`);
    }
  } else if (source.real !== undefined) warnings.push("La sezione real non è un oggetto.");

  const templates = [];
  const templatesQuarantined = [];
  if (Array.isArray(source.tpl)) {
    source.tpl.slice(0, 12).forEach((item, index) => {
      if (!isObject(item) || !SHIFT_TYPES.has(item.type)) {
        templatesQuarantined.push({ index, reason: "Modello turno non valido." });
        return;
      }
      const time = value => validTime(value);
      if (!time(item.st ?? "") || !time(item.en ?? "")) {
        templatesQuarantined.push({ index, reason: "Orario modello non valido." });
        return;
      }
      templates.push({
        type: item.type, post: String(item.post ?? "").slice(0, 80),
        st: item.st ?? "", en: item.en ?? "",
        n: Boolean(item.n), sun: Boolean(item.sun), p: Boolean(item.p),
        rs: Boolean(item.rs), mv: Boolean(item.mv)
      });
    });
  } else if (source.tpl !== undefined) warnings.push("La sezione tpl non è un array.");

  const skills = [];
  const skillsQuarantined = [];
  if (Array.isArray(source.skills)) {
    source.skills.slice(0, 200).forEach((item, index) => {
      if (!isObject(item) || typeof item.title !== "string" || !item.title.trim()) {
        skillsQuarantined.push({ index, reason: "Voce formazione senza titolo valido." });
        return;
      }
      const date = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
      skills.push({
        id: String(item.id ?? `legacy-skill-${index}`).slice(0, 60),
        type: String(item.type ?? "Altro").slice(0, 30),
        title: item.title.slice(0, 100),
        issuer: String(item.issuer ?? "").slice(0, 100),
        date: date(item.date), expiry: date(item.expiry),
        hours: item.hours == null ? null : Math.max(0, Math.min(10000, Number(item.hours) || 0)),
        notes: String(item.notes ?? "").slice(0, 500),
        added: String(item.added ?? "")
      });
    });
  } else if (source.skills !== undefined) warnings.push("La sezione skills non è un array.");

  const payslip = isObject(source.leavePayslip) ? source.leavePayslip : null;
  const leavePayslip = payslip ? { importedAt: typeof payslip.importedAt === "string" ? payslip.importedAt : "", ferie: {}, permessi: {} } : null;
  if (leavePayslip) {
    for (const group of ["ferie", "permessi"]) for (const field of ["maturate", "godute", "residue"]) {
      leavePayslip[group][field] = finiteNonNegative(payslip[group]?.[field]);
    }
  }

  const credentialMaterialPresent = typeof source.pin === "string" && /^[0-9a-f]{64}$/.test(source.pin) &&
    typeof source.salt === "string" && /^[0-9a-f]{32}$/.test(source.salt);
  if (source.pin !== undefined || source.salt !== undefined) {
    warnings.push("Sono presenti dati PIN/hash/salt legacy: non vengono restituiti né importati da questo adapter.");
  }
  if (credentialMaterialPresent) warnings.push("Credenziali locali rilevate; serve un flusso di transizione autenticazione dedicato.");
  if (source.role !== undefined && !["gpg", "sicurezza", "portierato"].includes(source.role)) warnings.push("Ruolo legacy non riconosciuto.");
  if (source.name !== undefined && typeof source.name !== "string") warnings.push("Nome legacy non testuale.");

  return Object.freeze({
    source: "tg_extra_v1",
    mode: "read-only-preview",
    data: {
      quota, real, templates, skills, leavePayslip,
      role: ["gpg", "sicurezza", "portierato"].includes(source.role) ? source.role : "",
      name: typeof source.name === "string" ? source.name.slice(0, 60) : "",
      migratedFlag: source.mig === 1,
      onboardingFlag: source.onb === 1
    },
    credentials: { present: credentialMaterialPresent, valuesExposed: false, imported: false },
    templatesQuarantined, skillsQuarantined, warnings,
    writesPerformed: false
  });
}


const ARCHIVE_KEYS = new Set([
  "tg_online_v1", "tg_extra_v1",
  "tg_online_v1_pre_local_backup", "tg_extra_v1_pre_local_backup",
  "tg_change_history_v1", "tg_training_local_v1"
]);

function parseArchiveJson(raw, label) {
  if (typeof raw !== "string" || !raw.trim()) return { error: `${label}: contenuto vuoto o non testuale.` };
  try { return { value: JSON.parse(raw) }; }
  catch { return { error: `${label}: JSON non valido.` }; }
}

function summarizeSnapshot(raw, label) {
  const parsed = parseArchiveJson(raw, label);
  if (parsed.error) return { valid: false, error: parsed.error };
  const source = parsed.value;
  if (!isObject(source)) return { valid: false, error: `${label}: il contenuto non è un oggetto.` };
  const preview = inspectLegacySnapshot(JSON.stringify({ params: source.params, profile: source.profile, shifts: source.shifts }));
  return {
    valid: true, importable: preview.importable,
    shifts: { total: preview.shifts.total, ready: preview.shifts.ready.length, quarantined: preview.shifts.quarantined.length },
    profileValid: preview.profile.valid, warnings: preview.warnings
  };
}

function summarizeExtras(raw, label) {
  const parsed = parseArchiveJson(raw, label);
  if (parsed.error) return { valid: false, error: parsed.error };
  const preview = inspectLegacyExtras(raw);
  return {
    valid: true,
    counts: { templates: preview.data.templates.length, templatesQuarantined: preview.templatesQuarantined.length,
      skills: preview.data.skills.length, skillsQuarantined: preview.skillsQuarantined.length,
      monthlyValues: Object.keys(preview.data.real).length },
    credentialsPresent: preview.credentials.present, warnings: preview.warnings
  };
}

/**
 * Inventario read-only di un export manuale delle chiavi LocalStorage legacy.
 * L'oggetto in ingresso mappa i nomi delle chiavi ai rispettivi valori JSON
 * testuali. I suffissi per-utente, i contenuti dello storico e i segreti
 * non vengono restituiti. I backup cifrati sono riconosciuti ma non decifrati.
 */
export function inspectLegacyArchive(entries) {
  if (!isObject(entries)) invalid("L'archivio legacy deve essere un oggetto semplice chiave/valore.");
  const inventory = {
    mode: "read-only-inventory", recognizedKeys: [], snapshots: {},
    perUser: { online: 0, extras: 0, onlineValid: 0, extrasValid: 0 },
    history: { present: false, valid: false, count: 0, kinds: [] },
    training: { present: false, valid: false, ready: [], quarantined: [] },
    encryptedBackups: [], unknownKeys: [], warnings: [], writesPerformed: false
  };

  for (const [key, raw] of Object.entries(entries)) {
    if (ARCHIVE_KEYS.has(key)) {
      inventory.recognizedKeys.push(key);
      if (key === "tg_online_v1" || key === "tg_online_v1_pre_local_backup") {
        inventory.snapshots[key] = summarizeSnapshot(raw, key);
      } else if (key === "tg_extra_v1" || key === "tg_extra_v1_pre_local_backup") {
        inventory.snapshots[key] = summarizeExtras(raw, key);
      } else if (key === "tg_change_history_v1") {
        inventory.history.present = true;
        const parsed = parseArchiveJson(raw, key);
        if (parsed.error) inventory.warnings.push(parsed.error);
        else if (Array.isArray(parsed.value)) {
          inventory.history.valid = true;
          inventory.history.count = parsed.value.length;
          inventory.history.kinds = [...new Set(parsed.value
            .filter(item => isObject(item) && typeof item.kind === "string" && item.kind.length <= 40)
            .map(item => item.kind))].sort();
          if (parsed.value.some(item => !isObject(item))) inventory.warnings.push("Lo storico contiene voci non strutturate da verificare.");
        } else inventory.warnings.push("Lo storico legacy non è un array.");
      } else if (key === "tg_training_local_v1") {
        inventory.training.present = true;
        const parsed = parseArchiveJson(raw, key);
        if (parsed.error) inventory.warnings.push(parsed.error);
        else if (Array.isArray(parsed.value)) {
          inventory.training.valid = true;
          parsed.value.slice(0, 200).forEach((item, index) => {
            if (!isObject(item) || typeof item.title !== "string" || !item.title.trim()) {
              inventory.training.quarantined.push({ index, reason: "Voce formazione senza titolo valido." });
              return;
            }
            const validDate = value => typeof value === "string" && isRealDate(value) ? value : "";
            const hours = item.hours == null ? null : finiteNonNegative(item.hours);
            inventory.training.ready.push({
              id: `legacy-training-${index}`, title: item.title.slice(0, 100),
              issuer: String(item.provider ?? "").slice(0, 100),
              date: validDate(item.date), expiry: validDate(item.expiry), hours,
              added: typeof item.added === "string" ? item.added.slice(0, 40) : ""
            });
            if (item.hours != null && hours === null) inventory.warnings.push(`Durata formazione non valida alla voce ${index}.`);
          });
          if (parsed.value.length > 200) inventory.warnings.push("Formazione oltre il limite di 200 voci: le eccedenti richiedono inventario separato.");
        } else inventory.warnings.push("La formazione legacy non è un array.");
      }
      continue;
    }

    const userMatch = key.match(/^tg_(online|extra)_v1_user_(.+)$/);
    if (userMatch) {
      const kind = userMatch[1], parsed = parseArchiveJson(raw, `chiave per-utente ${kind}`);
      if (kind === "online") {
        inventory.perUser.online++;
        if (!parsed.error && isObject(parsed.value)) {
          const summary = summarizeSnapshot(raw, "snapshot per-utente");
          if (summary.valid) inventory.perUser.onlineValid++;
          else inventory.warnings.push(summary.error);
        } else inventory.warnings.push(parsed.error ?? "Snapshot per-utente online non strutturato.");
      } else {
        inventory.perUser.extras++;
        if (!parsed.error && isObject(parsed.value)) {
          const summary = summarizeExtras(raw, "extra per-utente");
          if (summary.valid) inventory.perUser.extrasValid++;
          else inventory.warnings.push(summary.error);
        } else inventory.warnings.push(parsed.error ?? "Snapshot extra per-utente non strutturato.");
      }
      continue;
    }

    if (/^backup(?:[-_].*)?$/i.test(key)) {
      const parsed = parseArchiveJson(raw, key);
      if (parsed.error) { inventory.warnings.push(parsed.error); continue; }
      const value = parsed.value;
      if (isObject(value) && isObject(value.enc) && typeof value.data === "string" && [2, 3].includes(value.v)) {
        inventory.encryptedBackups.push({ key, version: value.v,
          algorithm: value.enc.alg === "AES-256-GCM" ? value.enc.alg : "non riconosciuto", decryptableHere: false });
      } else if (isObject(value) && Array.isArray(value.shifts)) {
        const snapshot = summarizeSnapshot(JSON.stringify({ params: value.params, profile: value.profile, shifts: value.shifts }), key);
        const extras = isObject(value.extra) ? summarizeExtras(JSON.stringify(value.extra), key + ".extra") : null;
        inventory.snapshots[key] = { ...snapshot, backup: true, extras };
      } else inventory.warnings.push(`${key}: formato backup non riconosciuto.`);
      continue;
    }

    inventory.unknownKeys.push(key.slice(0, 80));
  }

  if (inventory.perUser.online || inventory.perUser.extras) {
    inventory.warnings.push("Le chiavi per-utente sono conteggiate senza esporre i suffissi identificativi; non viene scelta automaticamente una copia da ripristinare.");
  }
  if (inventory.encryptedBackups.length) inventory.warnings.push("I backup cifrati v2/v3 sono riconosciuti solo come contenitori: senza password/codice non vengono decifrati né ispezionati.");
  if (inventory.unknownKeys.length) inventory.warnings.push("Sono presenti chiavi non mappate: richiedono analisi separata.");
  inventory.recognizedKeys.sort(); inventory.unknownKeys.sort();
  return Object.freeze(inventory);
}



/**
 * Analizza il backup JSON non cifrato generato dal pulsante legacy
 * "Senza password". Restituisce solo conteggi e stato, non i dati personali.
 */
export function inspectLegacyExport(rawJson) {
  if (typeof rawJson !== "string" || !rawJson.trim()) invalid("Export legacy vuoto o non testuale.");
  let source;
  try { source = JSON.parse(rawJson); }
  catch { invalid("Export legacy non è JSON valido."); }
  if (!isObject(source)) invalid("Export legacy deve contenere un oggetto JSON.");
  if (source.app !== "Turni Gpg/sicurezza online") invalid("Formato export non riconosciuto: verificare che provenga dal backup legacy senza password.");
  const allowed = new Set(["app", "params", "profile", "shifts", "extra"]);
  const unknown = Object.keys(source).filter(key => !allowed.has(key));
  const snapshot = inspectLegacySnapshot(JSON.stringify({
    params: source.params, profile: source.profile, shifts: source.shifts
  }));
  let extras = null;
  if (source.extra !== undefined) {
    if (!isObject(source.extra)) invalid("La sezione extra dell'export non è un oggetto.");
    extras = inspectLegacyExtras(JSON.stringify(source.extra));
  }
  return Object.freeze({
    source: "legacy-unencrypted-export",
    mode: "read-only-preview",
    snapshot: {
      profileValid: snapshot.profile.valid,
      shiftsTotal: snapshot.shifts.total,
      shiftsReady: snapshot.shifts.ready.length,
      shiftsQuarantined: snapshot.shifts.quarantined.length,
      importable: snapshot.importable
    },
    extras: extras ? {
      templates: extras.data.templates.length,
      templatesQuarantined: extras.templatesQuarantined.length,
      skills: extras.data.skills.length,
      skillsQuarantined: extras.skillsQuarantined.length,
      monthlyValues: Object.keys(extras.data.real).length,
      credentialsDetected: extras.credentials.present
    } : null,
    warnings: [
      ...snapshot.warnings,
      ...(extras?.warnings ?? []),
      ...unknown.map(key => `Campo export non riconosciuto: ${key}.`)
    ],
    writesPerformed: false
  });
}

function stableShiftValue(data) {
  return JSON.stringify([
    data.date, data.type, data.post, data.start_time, data.end_time,
    data.is_night, data.is_sunday, data.is_piantonato,
    data.is_rest_not_enjoyed, data.has_meal_voucher, data.hours
  ]);
}

/**
 * Confronta più snapshot esportati manualmente senza scegliere una fonte
 * vincente e senza produrre un piano di scrittura/importazione.
 * candidates: [{ source: "etichetta", rawJson: "{...}" }]
 */
export function inspectLegacyReconciliation(candidates) {
  if (!Array.isArray(candidates) || candidates.length < 2 || candidates.length > 100) {
    invalid("La riconciliazione richiede da 2 a 100 snapshot.");
  }
  const labels = new Set();
  const snapshots = [];
  const warnings = [];
  let quarantinedTotal = 0;

  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index];
    if (!isObject(candidate) || typeof candidate.rawJson !== "string") {
      invalid(`Snapshot candidato ${index} non valido.`);
    }
    const label = typeof candidate.source === "string" && candidate.source.trim()
      ? candidate.source.trim().slice(0, 80) : `snapshot-${index + 1}`;
    if (labels.has(label)) invalid("Le etichette delle fonti devono essere univoche.");
    labels.add(label);

    let parsedCandidate;
    try { parsedCandidate = JSON.parse(candidate.rawJson); }
    catch { invalid(`JSON non valido nello snapshot ${label}.`); }
    let preview, extrasPreview = null;
    if (isObject(parsedCandidate) && parsedCandidate.app === "Turni Gpg/sicurezza online") {
      preview = inspectLegacySnapshot(JSON.stringify({
        params: parsedCandidate.params, profile: parsedCandidate.profile, shifts: parsedCandidate.shifts
      }));
      if (parsedCandidate.extra !== undefined) {
        if (!isObject(parsedCandidate.extra)) invalid(`Sezione extra non valida nello snapshot ${label}.`);
        extrasPreview = inspectLegacyExtras(JSON.stringify(parsedCandidate.extra));
      }
    } else {
      preview = inspectLegacySnapshot(candidate.rawJson);
    }
    quarantinedTotal += preview.shifts.quarantined.length;
    if (preview.warnings.length) warnings.push(...preview.warnings.map(message => `${label}: ${message}`));
    if (extrasPreview?.warnings.length) warnings.push(...extrasPreview.warnings.map(message => `${label}: ${message}`));
    snapshots.push({ source: label, preview, extrasPreview });
  }

  const profileConflicts = [];
  for (const section of ["params", "profile"]) {
    const keys = new Set(snapshots.flatMap(item => Object.keys(item.preview.profile[section] ?? {})));
    for (const key of [...keys].sort()) {
      const values = snapshots.map(item => ({
        source: item.source,
        value: item.preview.profile[section]?.[key]
      }));
      const distinct = new Set(values.map(item => JSON.stringify(item.value)));
      if (distinct.size > 1) profileConflicts.push({ section, field: key, values });
    }
  }

  const extraConflicts = [];
  const extraSources = snapshots;
  if (extraSources.some(item => item.extrasPreview)) {
    const paths = new Set();
    const collect = (value, prefix = "") => {
      if (isObject(value)) {
        for (const [key, child] of Object.entries(value)) collect(child, prefix ? `${prefix}.${key}` : key);
      } else paths.add(prefix);
    };
    for (const item of extraSources) if (item.extrasPreview) collect(item.extrasPreview.data);
    for (const path of [...paths].sort()) {
      const read = (value, pathParts) => pathParts.reduce((current, key) => current?.[key], value);
      const parts = path.split(".");
      const values = extraSources.map(item => ({
        source: item.source,
        value: item.extrasPreview ? read(item.extrasPreview.data, parts) : undefined
      }));
      if (new Set(values.map(item => JSON.stringify(item.value))).size > 1) {
        extraConflicts.push({ field: path, values });
      }
    }
  }

  const records = [];
  for (const snapshot of snapshots) {
    for (const shift of snapshot.preview.shifts.ready) {
      records.push({
        source: snapshot.source, index: shift.index,
        legacyId: shift.legacyId, data: shift.normalized,
        signature: stableShiftValue(shift.normalized)
      });
    }
  }

  const byId = new Map();
  for (const record of records) {
    if (record.legacyId === null) continue;
    const group = byId.get(record.legacyId) ?? [];
    group.push(record);
    byId.set(record.legacyId, group);
  }

  const identicalRecords = [];
  const idConflicts = [];
  for (const [legacyId, group] of byId) {
    const sources = new Set(group.map(item => item.source));
    if (sources.size < 2) continue;
    const signatures = new Set(group.map(item => item.signature));
    const refs = group.map(({ source, index }) => ({ source, index }));
    if (signatures.size === 1) identicalRecords.push({ legacyId, copies: refs });
    else idConflicts.push({
      legacyId,
      variants: group.map(({ source, index, data }) => ({ source, index, data }))
    });
  }

  const possibleDuplicates = [];
  const bySignature = new Map();
  for (const record of records) {
    const group = bySignature.get(record.signature) ?? [];
    group.push(record);
    bySignature.set(record.signature, group);
  }
  for (const group of bySignature.values()) {
    if (group.length < 2) continue;
    const distinctIds = new Set(group.map(item => item.legacyId).filter(id => id !== null));
    const sourceCounts = new Map();
    for (const item of group) sourceCounts.set(item.source, (sourceCounts.get(item.source) ?? 0) + 1);
    const duplicateWithinSource = [...sourceCounts.values()].some(count => count > 1);
    const hasMissingId = group.some(item => item.legacyId === null);
    const duplicateAcrossSources = sourceCounts.size > 1 &&
      (distinctIds.size > 1 || hasMissingId);
    if (!duplicateWithinSource && !duplicateAcrossSources) continue;
    possibleDuplicates.push({
      reason: duplicateWithinSource
        ? "Dati turno ripetuti nella stessa fonte."
        : distinctIds.size > 1
          ? "Dati turno uguali ma identificativi legacy diversi tra fonti."
          : "Dati turno uguali tra fonti senza identificativi confrontabili.",
      copies: group.map(({ source, index, legacyId }) => ({ source, index, legacyId }))
    });
  }

  const sourceSummary = snapshots.map(({ source, preview, extrasPreview }) => ({
    source,
    shiftsTotal: preview.shifts.total,
    shiftsReady: preview.shifts.ready.length,
    shiftsQuarantined: preview.shifts.quarantined.length,
    profileValid: preview.profile.valid,
    profileErrors: preview.profile.errors.length,
    extrasPresent: Boolean(extrasPreview),
    extraSkills: extrasPreview?.data.skills.length ?? null,
    extraSkillsQuarantined: extrasPreview?.skillsQuarantined.length ?? null,
    extraTemplates: extrasPreview?.data.templates.length ?? null,
    extraTemplatesQuarantined: extrasPreview?.templatesQuarantined.length ?? null,
    extraMonthlyValues: extrasPreview ? Object.keys(extrasPreview.data.real).length : null,
    warnings: preview.warnings.length + (extrasPreview?.warnings.length ?? 0),
    importable: preview.importable && (!extrasPreview || (extrasPreview.warnings.length === 0 && extrasPreview.templatesQuarantined.length === 0 && extrasPreview.skillsQuarantined.length === 0))
  }));
  const quarantinedShifts = snapshots.flatMap(item => item.preview.shifts.quarantined.map(shift => ({
    source: item.source, index: shift.index, reason: shift.reason
  })));
  const quarantinedTemplates = snapshots.flatMap(snapshot => (snapshot.extrasPreview?.templatesQuarantined ?? []).map(entry => ({
    source: snapshot.source, index: entry.index, reason: entry.reason
  })));
  const quarantinedSkills = snapshots.flatMap(snapshot => (snapshot.extrasPreview?.skillsQuarantined ?? []).map(entry => ({
    source: snapshot.source, index: entry.index, reason: entry.reason
  })));
  const migrationReviewRequired = profileConflicts.length > 0 || extraConflicts.length > 0 ||
    idConflicts.length > 0 || possibleDuplicates.length > 0 || quarantinedShifts.length > 0 ||
    quarantinedTemplates.length > 0 || quarantinedSkills.length > 0 || warnings.length > 0 ||
    sourceSummary.some(item => !item.profileValid);

  return Object.freeze({
    mode: "read-only-reconciliation",
    writesPerformed: false,
    automaticMergePerformed: false,
    sourceCount: snapshots.length,
    sources: sourceSummary,
    profileConflicts,
    extraConflicts,
    quarantinedShifts,
    quarantinedTemplates,
    quarantinedSkills,
    identicalRecords,
    idConflicts,
    possibleDuplicates,
    quarantine: { shifts: quarantinedTotal, templates: quarantinedTemplates.length, skills: quarantinedSkills.length },
    migrationReadiness: {
      status: migrationReviewRequired ? "review-required" : "no-conflicts-detected",
      reviewRequired: migrationReviewRequired,
      automaticImportAllowed: false
    },
    totals: {
      shiftsReady: records.length,
      identicalGroups: identicalRecords.length,
      idConflictGroups: idConflicts.length,
      possibleDuplicateGroups: possibleDuplicates.length,
      profileConflictFields: profileConflicts.length,
      extraConflictFields: extraConflicts.length,
      sourcesWithWarnings: sourceSummary.filter(item => item.warnings > 0).length
    },
    warnings
  });
}


/**
 * Analizza la cronologia dei turni già estratti da uno snapshot legacy.
 * Rileva sovrapposizioni reali anche tra turni che attraversano la mezzanotte
 * e distingue i cambi turno consecutivi (gap zero) dai periodi di riposo.
 * Non legge storage e non esegue scritture.
 */
export function inspectLegacyShiftChronology(shifts) {
  if (!Array.isArray(shifts)) invalid("La cronologia legacy deve essere un array di turni.");
  const warnings = [];
  const intervals = [];

  shifts.forEach((item, index) => {
    if (!isObject(item) || item.type !== "turno") return;
    if (!isRealDate(item.date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.start_time ?? "") ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.end_time ?? "")) {
      warnings.push({ index, reason: "Turno escluso dalla cronologia: data o orario non valido." });
      return;
    }
    const start = new Date(`${item.date}T${item.start_time}:00Z`);
    let end = new Date(`${item.date}T${item.end_time}:00Z`);
    if (end <= start) end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
    intervals.push({ index, legacyId: item.id ?? null, date: item.date,
      startTime: item.start_time, endTime: item.end_time, start, end });
  });

  intervals.sort((a, b) => a.start - b.start || a.end - b.end);
  const overlaps = [];
  for (let left = 0; left < intervals.length; left++) {
    for (let right = left + 1; right < intervals.length; right++) {
      const a = intervals[left], b = intervals[right];
      if (b.start >= a.end) break;
      overlaps.push({
        first: { index: a.index, legacyId: a.legacyId, date: a.date, startTime: a.startTime, endTime: a.endTime },
        second: { index: b.index, legacyId: b.legacyId, date: b.date, startTime: b.startTime, endTime: b.endTime },
        overlapMinutes: Math.round((Math.min(a.end, b.end) - b.start) / 60000)
      });
    }
  }

  const transitions = [];
  for (let index = 1; index < intervals.length; index++) {
    const previous = intervals[index - 1], next = intervals[index];
    const gapMinutes = Math.round((next.start - previous.end) / 60000);
    transitions.push({
      from: { index: previous.index, date: previous.date, startTime: previous.startTime, endTime: previous.endTime },
      to: { index: next.index, date: next.date, startTime: next.startTime, endTime: next.endTime },
      gapMinutes,
      kind: gapMinutes < 0 ? "overlap" : gapMinutes === 0 ? "adjacent" : "rest"
    });
  }

  return Object.freeze({
    mode: "read-only-chronology",
    shiftsAnalyzed: intervals.length,
    overlaps,
    adjacentSegments: transitions.filter(item => item.kind === "adjacent"),
    transitions,
    warnings,
    writesPerformed: false
  });
}
