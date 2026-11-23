import { BaseRepository } from "./base-repository.js";
import { DatabaseError, DB_ERROR_CODES } from "../database/database-errors.js";

const MAX_SETTINGS = 30;
const MAX_KEY_LENGTH = 64;
const MAX_STRING_LENGTH = 256;
const KEY_PATTERN = /^[a-z][a-zA-Z0-9_]*$/;

function validateSettings(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new DatabaseError(DB_ERROR_CODES.VALIDATION_FAILED, "Le impostazioni devono essere un oggetto semplice.");
  }
  const keys = Object.keys(data);
  if (keys.length === 0 || keys.length > MAX_SETTINGS) {
    throw new DatabaseError(DB_ERROR_CODES.VALIDATION_FAILED, "Numero di impostazioni non valido.");
  }
  for (const key of keys) {
    const value = data[key];
    if (key.length > MAX_KEY_LENGTH || !KEY_PATTERN.test(key)) {
      throw new DatabaseError(DB_ERROR_CODES.VALIDATION_FAILED, "Nome impostazione non valido.");
    }
    if (typeof value === "string") {
      if (value.length > MAX_STRING_LENGTH) {
        throw new DatabaseError(DB_ERROR_CODES.VALIDATION_FAILED, "Testo impostazione troppo lungo.");
      }
    } else if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        throw new DatabaseError(DB_ERROR_CODES.VALIDATION_FAILED, "Valore numerico impostazione non valido.");
      }
    } else if (typeof value !== "boolean" && value !== null) {
      throw new DatabaseError(DB_ERROR_CODES.VALIDATION_FAILED, "Sono ammessi soltanto valori semplici: testo breve, numero finito, booleano o null.");
    }
  }
}

export class SettingsRepository extends BaseRepository {
  constructor(options) {
    super({ ...options, storeName: "settings" });
  }

  async create(data, options = {}) {
    validateSettings(data);
    return super.create(data, options);
  }

  async update(id, changes, options = {}) {
    validateSettings(changes);
    return super.update(id, changes, options);
  }
}
