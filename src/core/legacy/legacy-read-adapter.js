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
  const date = new Date(Date.UTC(year, month - 1, day));
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
  const quota = {
    ferie: finiteNonNegative(quotaSource.ferie) ?? 0,
    perm: finiteNonNegative(quotaSource.perm) ?? 0
  };
  const real = {};
  if (isObject(source.real)) {
    for (const [month, value] of Object.entries(source.real)) {
      if (/^\\d{4}-\\d{2}$/.test(month) && finiteNonNegative(value) !== null) real[month] = Number(value);
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
      const time = value => value === "" || (typeof value === "string" && /^\\d{2}:\\d{2}$/.test(value));
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
      const date = value => typeof value === "string" && /^\\d{4}-\\d{2}-\\d{2}$/.test(value) ? value : "";
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
