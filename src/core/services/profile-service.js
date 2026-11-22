import { validationError, requirePlainObject, validateDate, validateExpectedRevision } from "./service-validation.js";

const PARAMETER_KEYS = [
  "paga_base", "scatti", "altre_fisse", "ore_mensili", "ore_turno", "straordinario_perc",
  "straordinario_ora", "notturno_turno", "piantonato_turno", "domenica_ora",
  "riposo_non_goduto", "buono_pasto", "inps_rate", "irpef_rate", "sindacato",
  "cessione", "altre_trattenute"
];
const PROFILE_KEYS = ["ccnl", "section", "level", "role", "effective_date"];
const DEFAULT_PARAMS = Object.freeze({
  paga_base: 0, scatti: 0, altre_fisse: 0, ore_mensili: 0, ore_turno: 7.25,
  straordinario_perc: 0, straordinario_ora: 0, notturno_turno: 0, piantonato_turno: 0,
  domenica_ora: 0, riposo_non_goduto: 0, buono_pasto: 0, inps_rate: 0, irpef_rate: 0,
  sindacato: 0, cessione: 0, altre_trattenute: 0
});
const DEFAULT_PROFILE = Object.freeze({ ccnl: "", section: "", level: "", role: "", effective_date: "" });

function normalizeSection(input, keys, defaults, label) {
  const source = requirePlainObject(input ?? {}, label);
  for (const key of Object.keys(source)) if (!keys.includes(key)) validationError(`Campo ${label} non riconosciuto: ${key}.`);
  const result = { ...defaults, ...source };
  for (const key of keys) {
    const value = result[key];
    if (typeof value !== "string" || value.length > 120) {
      if (label === "params" && typeof value === "number" && Number.isFinite(value) && value >= 0) continue;
      validationError(`Valore non valido per ${label}.`);
    }
  }
  return result;
}

function normalizeProfileData(input) {
  const source = requirePlainObject(input, "Profilo");
  for (const key of Object.keys(source)) if (!["params", "profile"].includes(key)) validationError(`Sezione profilo non riconosciuta: ${key}.`);
  const paramsInput = requirePlainObject(source.params ?? {}, "params");
  for (const [key, value] of Object.entries(paramsInput)) {
    if (!PARAMETER_KEYS.includes(key) || typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      validationError(`Parametro retributivo non valido: ${key}.`);
    }
    if (["straordinario_perc", "inps_rate", "irpef_rate"].includes(key) && value > 100) validationError(`Percentuale fuori intervallo: ${key}.`);
  }
  const profile = normalizeSection(source.profile, PROFILE_KEYS, DEFAULT_PROFILE, "profile");
  if (profile.effective_date) validateDate(profile.effective_date, "Data di decorrenza");
  return { params: { ...DEFAULT_PARAMS, ...paramsInput }, profile };
}

export class ProfileService {
  constructor({ repository }) {
    if (!repository) throw new TypeError("ProfileService richiede un repository.");
    this.repository = repository;
  }

  async create(data = {}, options = {}) {
    return this.repository.create(normalizeProfileData(data), options);
  }

  async getById(id) { return this.repository.getById(id); }
  async getAll() { return this.repository.getAll(); }

  async update(id, changes, options = {}) {
    const expectedRevision = validateExpectedRevision(options);
    const patch = requirePlainObject(changes, "Modifiche profilo");
    for (const key of Object.keys(patch)) {
      if (!["params", "profile"].includes(key)) validationError(`Sezione profilo non riconosciuta: ${key}.`);
    }
    const paramsPatch = requirePlainObject(patch.params ?? {}, "params");
    const profilePatch = requirePlainObject(patch.profile ?? {}, "profile");
    const current = await this.repository.getById(id);
    if (!current) return null;
    const merged = {
      params: { ...current.data.params, ...paramsPatch },
      profile: { ...current.data.profile, ...profilePatch }
    };
    return this.repository.update(id, normalizeProfileData(merged), { expectedRevision });
  }

  async delete(id, options = {}) {
    return this.repository.delete(id, { expectedRevision: validateExpectedRevision(options) });
  }
}
