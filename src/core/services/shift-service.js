import { validationError, requirePlainObject, validateDate, validateExpectedRevision } from "./service-validation.js";

const SHIFT_TYPES = new Set(["turno", "turno_riposo", "riposo", "riposo_compensativo", "ferie", "permesso", "malattia"]);
const SHIFT_KEYS = ["date", "type", "post", "start_time", "end_time", "is_night", "is_sunday", "is_piantonato", "is_rest_not_enjoyed", "has_meal_voucher", "hours"];
const FLAGS = ["is_night", "is_sunday", "is_piantonato", "is_rest_not_enjoyed", "has_meal_voucher"];

function normalizeShift(input) {
  const source = requirePlainObject(input, "Turno");
  for (const key of Object.keys(source)) if (!SHIFT_KEYS.includes(key)) validationError(`Campo turno non riconosciuto: ${key}.`);
  if (!SHIFT_TYPES.has(source.type)) validationError("Tipo di turno non valido.");
  validateDate(source.date, "Data turno");
  const post = source.post ?? "";
  if (typeof post !== "string" || post.length > 80) validationError("La sede/nota del turno deve contenere al massimo 80 caratteri.");
  const timePattern = /^(?:[01]\\d|2[0-3]):[0-5]\\d$/;
  const startTime = source.start_time ?? "";
  const endTime = source.end_time ?? "";
  if ((startTime !== "" && (typeof startTime !== "string" || !timePattern.test(startTime))) ||
      (endTime !== "" && (typeof endTime !== "string" || !timePattern.test(endTime)))) validationError("Orario turno non valido.");
  const hours = source.hours ?? 0;
  if (typeof hours !== "number" || !Number.isFinite(hours) || hours < 0 || hours > 48) validationError("Le ore del turno devono essere comprese tra 0 e 48.");
  const flags = {};
  for (const key of FLAGS) {
    const value = source[key] ?? false;
    if (typeof value !== "boolean") validationError(`Il campo ${key} deve essere booleano.`);
    flags[key] = value;
  }
  return { date: source.date, type: source.type, post, start_time: startTime, end_time: endTime, ...flags, hours };
}

export class ShiftService {
  constructor({ repository }) {
    if (!repository) throw new TypeError("ShiftService richiede un repository.");
    this.repository = repository;
  }

  async create(data, options = {}) { return this.repository.create(normalizeShift(data), options); }
  async getById(id) { return this.repository.getById(id); }
  async getAll() { return this.repository.getAll(); }

  async update(id, changes, options = {}) {
    const expectedRevision = validateExpectedRevision(options);
    const current = await this.repository.getById(id);
    if (!current) return null;
    return this.repository.update(id, normalizeShift({ ...current.data, ...requirePlainObject(changes, "Modifiche turno") }), { expectedRevision });
  }

  async delete(id, options = {}) {
    return this.repository.delete(id, { expectedRevision: validateExpectedRevision(options) });
  }
}
