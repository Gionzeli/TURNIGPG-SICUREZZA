# DSM domain mapping audit — 2026-11-27

**Branch:** `codex/employee-shift-date-range-query`  
**Scope:** reconcile D-01 implementation status and assess whether D-02/D-03 are ready for a safe runtime API.  
**Data:** source inspection only; no real records, no migration, no production Firebase access.

## 1. D-01 status correction

The older document `docs/dsm-d01-employment-profile-field-mapping-2026-11-27.md` contains historical statements that are now stale. At the current branch head, the following are implemented:

- `functions/src/membership/employment-profile-dto.js`: strict D-01 allowlist projection.
- `functions/src/membership/employee-employment-profile-firestore-loader.js`: server-side membership, active binding, reciprocal binding, Employee lifecycle and canonical profile checks.
- `functions/src/membership/employee-employment-profile-callable-handlers.js`: callable handler and strict request validation.
- `readOwnEmployeeEmploymentProfile` is exported by Functions and wired into the isolated canonical account bridge.
- The Auth + Functions + Firestore Emulator test passed on commit `44731217c39d99031b2ed0c105c8e45c940415ea` (subtest 31).
- The browser suite verifies the isolated bridge UI with synthetic dependencies. The bridge remains disabled in the operational app by default.

Therefore, the statements in the older D-01 mapping note saying that the permission/callable are not implemented must be read as historical, not current. The current callable uses the dedicated permission `dsm:employee:employment-profile:read:self`, not generic `dsm:read:own-scope`.

## 2. D-02 compensation — mapping is not ready

The approved D-02 semantic scope is limited self-read of:
- current base pay and its effective date;
- overtime amounts and applicable effective dates;
- premiums/majorations and applicable effective dates;
- allowances and applicable effective dates.

The legacy `ProfileService` exposes a flat numeric `params` object with keys:
`paga_base`, `scatti`, `altre_fisse`, `ore_mensili`, `ore_turno`, `straordinario_perc`, `straordinario_ora`, `notturno_turno`, `piantonato_turno`, `domenica_ora`, `riposo_non_goduto`, `buono_pasto`, `inps_rate`, `irpef_rate`, `sindacato`, `cessione`, `altre_trattenute`.

These keys are local-app inputs and calculation parameters, not a canonical payroll schema. They do not establish:
- currency/period/unit semantics for every amount;
- whether overtime is stored as a rate, a multiplier, an amount, or a computed total;
- distinct effective dates for base pay, overtime, premiums and allowances;
- validity intervals or historical/current record selection;
- whether `scatti`, `altre_fisse`, `riposo_non_goduto` and `buono_pasto` are in-scope allowances or separate payroll concepts;
- canonical source, verification provenance, revision and lifecycle for these values.

`profile.effective_date` is one date for the ordinary local profile. It cannot safely be assumed to be the effective date for every compensation field.

**Decision:** do not implement D-02 loader, DTO or callable yet. Do not copy the legacy `params` object, infer units, or expose computed pay. Required next contract: field-by-field canonical schema with numeric units/periods, effective intervals, provenance and current-record selection. Deductions, withholdings, IBAN, payment destinations, complete payslips, export and offline cache remain excluded.

## 3. D-03 manager/team roster — mapping and authorization are not ready

The approved semantic projection is narrow: approved display label/name, operational role/function, operational qualifications/skills, and current canonical site/department, within separately authorized manager scope.

Current Employee identity records are intentionally minimal and do not contain a canonical name/display label. The legacy profile role is free text and is not an authorization role. The current Skills records are local legacy data and have no canonical verification/provenance model. The organizational placement has a canonical backend representation, but the manager eligibility and site/department scope contract for this endpoint is not yet complete.

**Decision:** no manager/team roster endpoint. Do not infer identity from Firebase display name/email, membership request, legacy LocalStorage or free-text role. Do not treat unverified legacy skills as verified qualifications. Define the authoritative name source, operational role vocabulary, qualification verification and exact manager scope/eligible roles before implementing a minimized DTO.

## 4. Next safe implementation sequence

1. Preserve the verified D-01 self-read path and its tests; do not broaden its DTO.
2. Resolve D-02 canonical schema/provenance/units/effective-time contract before writing code.
3. Resolve D-03 name/role/qualification sources and manager authorization scope before writing code.
4. Only then add domain-specific DTOs/loaders and Auth + Functions + Firestore Emulator tests, one domain at a time.
5. Keep payroll deny-by-default, manager/team APIs absent, operational bridge disabled, and all real-data migration/synchronization disabled.

**Release status remains not ready for operational activation.** This audit is not approval for production, merge, deploy, export or access to real data.
