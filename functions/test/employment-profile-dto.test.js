import test from "node:test";
import assert from "node:assert/strict";
import { mapApprovedEmploymentProfileFields } from "../src/membership/employment-profile-dto.js";

test("D-01 mapper returns only the five approved ordinary profile fields", () => {
  const result = mapApprovedEmploymentProfileFields({
    ccnl: "HV17",
    section: "vigilanza_armata",
    level: " 4 ",
    role: " Guardia particolare giurata ",
    effectiveDate: "2026-09-01",
    basePay: 9999,
    iban: "IT00SYNTHETIC",
    absenceReason: "synthetic-private",
    employeeId: "employee-123",
    arbitraryPayload: { secret: true }
  });

  assert.deepEqual(result, {
    ccnl: "HV17",
    section: "vigilanza_armata",
    level: "4",
    role: "Guardia particolare giurata",
    effectiveDate: "2026-09-01"
  });
  for (const forbidden of ["basePay", "iban", "absenceReason", "employeeId", "arbitraryPayload"]) {
    assert.equal(Object.hasOwn(result, forbidden), false);
  }
  assert.equal(Object.isFrozen(result), true);
});

test("D-01 mapper preserves absent optional values as null", () => {
  assert.deepEqual(mapApprovedEmploymentProfileFields({}), {
    ccnl: null,
    section: null,
    level: null,
    role: null,
    effectiveDate: null
  });
});

test("D-01 mapper rejects unknown CCNL and section values", () => {
  assert.throws(() => mapApprovedEmploymentProfileFields({ ccnl: "UNKNOWN" }), /Unsupported employment profile CCNL/);
  assert.throws(() => mapApprovedEmploymentProfileFields({ ccnl: "HV17", section: "unknown" }), /Unsupported employment profile section/);
  assert.throws(() => mapApprovedEmploymentProfileFields({ section: "vigilanza_armata" }), /Unsupported employment profile section/);
});

test("D-01 mapper rejects malformed text and invalid dates", () => {
  assert.throws(() => mapApprovedEmploymentProfileFields({ level: 4 }), /Invalid employment profile field: level/);
  assert.throws(() => mapApprovedEmploymentProfileFields({ role: "x".repeat(101) }), /Invalid employment profile field: role/);
  assert.throws(() => mapApprovedEmploymentProfileFields({ effectiveDate: "2026-02-30" }), /Invalid employment profile field: effectiveDate/);
  assert.throws(() => mapApprovedEmploymentProfileFields({ effectiveDate: "2026-02-29" }), /Invalid employment profile field: effectiveDate/);
  assert.throws(() => mapApprovedEmploymentProfileFields({ effectiveDate: "01/09/2026" }), /Invalid employment profile field: effectiveDate/);
});

test("D-01 mapper validates leap days and four-digit years without Date.UTC year coercion", () => {
  assert.equal(
    mapApprovedEmploymentProfileFields({ effectiveDate: "2024-02-29" }).effectiveDate,
    "2024-02-29"
  );
  assert.equal(
    mapApprovedEmploymentProfileFields({ effectiveDate: "0000-02-29" }).effectiveDate,
    "0000-02-29"
  );
  assert.equal(
    mapApprovedEmploymentProfileFields({ effectiveDate: "0096-02-29" }).effectiveDate,
    "0096-02-29"
  );
});

test("D-01 mapper rejects non-object source values", () => {
  for (const source of [null, undefined, [], "profile"]) {
    assert.throws(() => mapApprovedEmploymentProfileFields(source), /source must be an object/);
  }
});
