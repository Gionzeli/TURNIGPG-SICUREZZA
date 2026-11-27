const SECTIONS = new Set([
  "vigilanza_armata",
  "servizi_sicurezza",
  "servizi_fiduciari"
]);

function optionalText(value, field) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new TypeError(`Invalid employment profile field: ${field}`);
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > 100 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new TypeError(`Invalid employment profile field: ${field}`);
  }
  return normalized;
}

function optionalDate(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TypeError("Invalid employment profile field: effectiveDate");
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day) {
    throw new TypeError("Invalid employment profile field: effectiveDate");
  }
  return value;
}

/**
 * Project only the D-01 ordinary employment-profile allowlist.
 *
 * This pure mapper is not an authorization check, a Firestore loader, or a
 * storage-schema declaration. Callers must first resolve the verified UID's
 * active Employee binding and load data from an approved canonical source.
 * Unknown source properties are intentionally never copied to the DTO.
 */
export function mapApprovedEmploymentProfileFields(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new TypeError("Employment profile source must be an object.");
  }

  const ccnlValue = optionalText(source.ccnl, "ccnl");
  if (ccnlValue !== null && ccnlValue !== "HV17") {
    throw new TypeError("Unsupported employment profile CCNL.");
  }

  const sectionValue = optionalText(source.section, "section");
  if (sectionValue !== null && (!ccnlValue || !SECTIONS.has(sectionValue))) {
    throw new TypeError("Unsupported employment profile section.");
  }

  return Object.freeze({
    ccnl: ccnlValue,
    section: sectionValue,
    level: optionalText(source.level, "level"),
    role: optionalText(source.role, "role"),
    effectiveDate: optionalDate(source.effectiveDate)
  });
}
