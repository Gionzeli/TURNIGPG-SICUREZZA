# D-02 legacy compensation field mapping — technical audit

**Date:** 2026-11-27  
**Repository:** `Gionzeli/TURNIGPG-SICUREZZA`  
**Branch:** `codex/employee-shift-date-range-query`  
**Inspected baseline:** `e3520d6b18e7abe620fefbece18249c0398507db`  
**Scope:** source-level mapping only. No payroll schema, DTO, permission, loader, callable or migration is implemented.

## 1. Decision boundary

The D-02 decision record approves limited self-read of:
- current base pay amount and its effective date;
- overtime amounts and applicable effective dates;
- premiums/majorations and applicable effective dates;
- allowances and applicable effective dates.

It explicitly excludes deductions/withholdings, full payslips, bank/payment details, other employees' compensation, exports, mutations and offline/local payroll cache.

This audit maps legacy labels to those semantic categories where possible. A legacy label is not proof of accounting meaning, unit, period, legal treatment, provenance or effective interval. No value is promoted to canonical payroll data by this document.

## 2. Source facts

Inspected `src/core/services/profile-service.js`:
- `PARAMETER_KEYS` contains 17 numeric fields.
- `normalizeProfileData` requires each supplied value to be a finite number >= 0.
- `straordinario_perc`, `inps_rate` and `irpef_rate` are additionally capped at 100.
- Missing fields are populated from `DEFAULT_PARAMS`; most default to zero and `ore_turno` defaults to 7.25.
- The service persists a flat `params` object alongside a separate `profile` object.
- The profile's single `effective_date` is validated as a date, but the service does not associate separate effective dates with individual compensation parameters.
- There is no employee identity, account ownership, provenance, source document, currency, pay period, validity interval or verification state in this service payload.

Inspected the legacy `index.html` UI:
- The visible labels describe some values as euros, euros/hour, euros/shift or percentages.
- Personal aliases map arbitrary payslip wording to one of the legacy parameter keys. An alias is a user-maintained local mapping, not verified accounting evidence.
- The UI labels are not a canonical schema or server-side contract.

## 3. Field-by-field classification

| Legacy key | UI label/evidence | D-02 semantic candidate | Audit result / missing contract |
|---|---|---|---|
| `paga_base` | “Paga base €” | Base pay | Candidate only. Currency symbol is shown, but period (monthly/hourly/other), gross/net meaning, applicable hours/CCNL basis, source and field-specific effective interval are not encoded. |
| `scatti` | “Scatti €” | Possibly base-pay component or allowance | Unmapped. Need define whether seniority increments are included in base pay, separate allowance, recurring amount, period and effective date. |
| `altre_fisse` | “Altre voci fisse €” | Possibly allowance/premium | Unmapped aggregate. Could combine unrelated items with different tax/accounting treatment and dates; must not be exposed as a single canonical field. |
| `ore_mensili` | “Ore mensili” | Not itself a compensation amount | Exclude from D-02 DTO. It may be a calculation basis, but contractual meaning, expected monthly hours and effective dates are not defined. |
| `ore_turno` | “Ore ordinarie giornaliere” | Not itself a compensation amount | Exclude from D-02 DTO. It is a time/calculation parameter, not a pay amount. |
| `straordinario_perc` | “Straordinario %” | Overtime rate/majoration | Candidate only. The percentage base, whether it is a multiplier or uplift, interaction with `straordinario_ora`, applicable overtime types and effective interval are unknown. |
| `straordinario_ora` | “Straordinario €/h” | Overtime amount/rate | Candidate only. Need establish whether this is a full hourly amount or an incremental premium, gross/net basis, applicable hour classes, rounding and effective interval. |
| `notturno_turno` | “Notturno €/turno” | Premium/majoration | Candidate only. Need define which shift/time window qualifies, whether amount is flat per shift or computed, whether it is additive, and effective interval. |
| `piantonato_turno` | “Piantonato €/turno” | Premium/allowance | Candidate only. Need define whether it is a premium for a specific duty, whether it can combine with night/overtime premiums, and effective interval. |
| `domenica_ora` | “Domenica €/h” | Premium/majoration | Candidate only. Need define hourly base, eligible Sunday hours, stacking with overtime/night premiums and effective interval. |
| `riposo_non_goduto` | “Riposo n.g. €” | Possibly premium/allowance | Unmapped. Need define legal/payroll meaning, unit and triggering condition; do not infer from shorthand. |
| `buono_pasto` | “Buono pasto €” | Allowance/benefit | Candidate only. Need distinguish per-day/per-shift/per-month value, cash vs non-cash treatment, eligibility conditions, currency and effective interval. |
| `inps_rate` | “INPS %” | Deduction/contribution | Explicitly excluded from D-02 self-read. Do not expose or migrate in the compensation DTO. |
| `irpef_rate` | “IRPEF %” | Tax withholding | Explicitly excluded from D-02 self-read. Do not expose or migrate in the compensation DTO. |
| `sindacato` | “Sindacato €” | Deduction | Explicitly excluded from D-02 self-read. |
| `cessione` | “Cessione quinto €” | Deduction/withholding | Explicitly excluded from D-02 self-read. |
| `altre_trattenute` | “Altre trattenute €” | Aggregate deductions | Explicitly excluded from D-02 self-read. It is also an opaque aggregate and must not be copied into a future DTO. |

### 3.1 Interpretation limits

- The euro symbol does not establish a period or whether a figure is gross, net, full amount or incremental premium.
- A percentage does not establish its calculation base or whether it is a surcharge or multiplier.
- A per-hour/per-shift label does not establish eligibility, stacking rules, rounding or whether the amount is a rate or total.
- `scatti`, `altre_fisse` and `riposo_non_goduto` must not be assigned to an approved semantic category without an explicit business definition.
- Defaults of zero are UI/service defaults, not verified facts that the employee's contractual value is zero.
- The single legacy `profile.effective_date` cannot be reused as the effective date for every payroll component.
- A personal alias can help identify a payslip label but cannot establish provenance or verify the mapped amount.

## 4. Proposed canonical mapping contract — not approved

For each approved compensation component, the schema owner must decide and document at least:

1. **Canonical concept and code:** one unambiguous semantic definition; no catch-all aggregate.
2. **Value representation:** decimal precision, rounding, currency (where monetary), and whether the value is a rate, percentage, amount or formula input.
3. **Unit and period:** per hour, shift, day, month, year, event or other explicitly defined basis.
4. **Gross/net and tax basis:** only where applicable and approved for the self-read DTO.
5. **Calculation semantics:** base amount, uplift vs full rate, eligibility, stacking/order, cap and rounding.
6. **Effective time:** `validFrom`, `validUntil`, timezone/calendar policy if relevant, and selection of the current valid component.
7. **Provenance:** authoritative source, who entered/verified it, verification timestamp and supporting reference; no client-supplied claim of verification.
8. **Revision/lifecycle:** immutable revision history, correction policy, active/superseded state and concurrency behavior.
9. **Ownership:** canonical Employee reference resolved by backend from the verified UID's unique active binding; no client-selected employee ID.
10. **DTO allowlist:** explicit projection of only approved current values and their effective dates; never return a raw payroll document.

Do not store or expose calculation parameters merely because they exist in the legacy object. A derived amount must not be computed until its formula and authoritative inputs are approved.

## 5. Questions that block implementation

The following are specific schema-owner/product decisions:

- Is `paga_base` a gross monthly amount, hourly amount, or another basis?
- Is `straordinario_ora` a full overtime hourly rate or only the additional premium? What is the relation to `straordinario_perc`?
- Which overtime categories exist, and may their rates differ by time/day/type?
- Are night, Sunday and piantonato values flat amounts or calculated rates? Which conditions make each applicable?
- Is `buono_pasto` a cash allowance or a non-cash benefit, and what is its unit/eligibility?
- Are `scatti`, `altre_fisse` and `riposo_non_goduto` in the approved D-02 scope at all? If yes, what exact concept and unit does each represent?
- Does the canonical model represent separate components with separate effective intervals, rather than a single profile-wide date?
- Which authoritative source and verification process establishes current values?

Until each item is resolved, its field remains unmapped and denied.

## 6. Safe next implementation gate

No D-02 runtime code should be added until the semantic decisions and canonical mapping above are approved. After approval, implement in this order:

1. schema and field-level provenance/effective-time contract;
2. synthetic fixtures and strict schema validator;
3. pure D-02 DTO with only approved fields;
4. dedicated self-read permission, separate from D-01;
5. server loader resolving the caller's own Employee through the active reciprocal binding;
6. callable with strict request shape and no client employee selector;
7. Auth + Functions + Firestore Emulator allow/deny tests, including cross-employee, missing/duplicate/revoked binding, inactive Employee, invalid effective intervals, unknown fields and excluded payroll/withholding leakage.

Do not add payroll writes, manager payroll access, exports, offline cache, historical reads or production activation as part of this gate.

## 7. Current safety status

- D-02 limited self-read is approved in principle, but the canonical field mapping is incomplete.
- No D-02 schema, DTO, permission, loader or callable has been added by this audit.
- Deductions and withholdings remain excluded.
- Payroll remains deny-by-default in runtime.
- The canonical bridge remains disabled.
- No production Firebase, real employee records, real payslips, migration, merge or deployment was used or authorized.

**Verification:** source inspection only. No tests were run; this document does not change executable code.
