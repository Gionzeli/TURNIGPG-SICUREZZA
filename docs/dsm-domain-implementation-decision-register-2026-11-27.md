# DSM domain implementation and decision register

**Date:** 2026-11-27  
**Repository:** `Gionzeli/TURNIGPG-SICUREZZA`  
**Branch:** `codex/employee-shift-date-range-query`  
**Baseline HEAD inspected:** `5b1a494d8d11e9c3cd006643807c4855cadf46e1`

## Purpose

This is the current status index for domain work D-01 through D-04. It distinguishes implemented and tested code from domain contracts still awaiting decisions. It does not approve new permissions, production activation, merge or deployment.

## Decision status

| Domain | Current status | Runtime boundary | Required next gate |
|---|---|---|---|
| D-01 — employee employment profile | Implemented as a narrow self-read path; Emulator test passed on commit `debeaa5951e45870159af4efbc0ee2e7f598d826` (subtest 31). | Only the employee's own verified reciprocal UID↔Employee binding; allowlisted employment fields. No payroll or delegated manager access. | Preserve DTO and authorization boundary; rerun backend workflow on code changes. |
| D-02 — compensation self-read | Not ready; mapping audit identifies ambiguous legacy numeric inputs and missing units, periods, provenance and field-specific effective dates. | No compensation loader, DTO or callable. Payroll and deductions remain deny-by-default. | Approve a field-by-field canonical schema and effective-time/provenance rules before implementation. |
| D-03 — manager/team roster | Not ready; canonical display identity, operational role vocabulary and verified qualifications are not established. | No manager/team roster endpoint. Free-text role, Firebase display name/email and unverified legacy skills are not authority. | Approve authoritative identity source, role vocabulary, qualification verification and exact eligible manager scope. |
| D-04 — delegated manager shift access | Not implemented; delegated reads and mutations explicitly denied. Contract baseline recorded in `dsm-d04-contract-baseline-2026-11-27.md`. | Existing manager organization permissions do not authorize employee shift reads, proposals, decisions or mutations. | Approve manager-to-employee assignment lifecycle, scope semantics, action matrix, separation of duties, minimal DTO and audit contract. |

## Important separation: organizational schema vs domain permissions

The organizational schema decision register records ORG-01–ORG-10 as approved for isolated implementation and Emulator testing. Those decisions cover canonical organization structure, lifecycle, membership, scope, transfers, identifiers, audit and protected API architecture.

They do **not** by themselves grant:
- compensation or payroll access;
- access to another employee's profile or schedule;
- team-roster or qualification visibility;
- manager shift approval/rejection or direct shift mutation;
- absence reason or health-data visibility;
- export rights.

The document `dsm-data-domain-authorization-matrix.md` is a proposal, not an approved permission matrix. Its candidate permission strings must not be treated as granted permissions.

## Verified implementation and test evidence

- D-01 own employment profile: Auth + Functions + Firestore Emulator test passed on `debeaa5951e45870159af4efbc0ee2e7f598d826`, subtest 31.
- Own employee shifts: Auth + Functions + Firestore Emulator test passed on `44731217c39d99031b2ed0c105c8e45c940415ea`, subtest 58.
- Firestore direct-access regression: FR-26 and FR-27 passed in Rules Emulator workflow run [46059407619](https://github.com/Gionzeli/TURNIGPG-SICUREZZA/actions/runs/46059407619) on commit `de511df948ee3f5dfd99d1d8f5bfd85accb1978a`; 40 passed, 0 failed, 0 skipped.
- Default-disabled browser gate: workflow run [46060992583](https://github.com/Gionzeli/TURNIGPG-SICUREZZA/actions/runs/46060992583) passed on commit `5ae26b0bb4f09987f1bbfec42e084215ffdc14db`.
- Backend workflow evidence remains non-green on the historical own-shift test commit: 222 passed and 4 failed, all in the frozen mailbox lifecycle lane. The four failures are documented in `dsm-backend-verification-addendum-2026-11-27.md`. These are not evidence of D-01 or own-shift test failure, but the backend pipeline cannot be called green.
- The above workflow results belong to their stated commits, not to this document's baseline HEAD. No test is claimed for this documentation-only register.

## Cross-domain safety invariants

1. Verified identity, reciprocal employee binding, organizational scope and domain/action permission are independent checks.
2. Client-supplied employee IDs, owner IDs, roles, permissions, scopes or display names never establish authority.
3. No role, including manager or admin, inherits payroll access.
4. No manager organization-management permission implies employee roster or shift permission.
5. Health details, absence reasons/documents, payroll, deductions, IBAN/payment destinations and private notes remain excluded from general employee/team DTOs.
6. All protected operations must authorize server-side against current canonical records; browser state and IndexedDB partitioning are not proof of ownership.
7. Denied operations must not write business records or audit events.
8. Keep the canonical integration feature flag disabled; no real data, real mailbox or production Firebase use.

## Ordered next work

1. Keep D-01 and own-shift self-service paths narrow; do not broaden them to unblock manager workflows.
2. Resolve D-02 field semantics and canonical provenance/effective-time model before any payroll code.
3. Resolve D-03 authoritative identity, role and qualification sources before any roster code.
4. Resolve D-04 assignment lifecycle and action matrix before any delegated shift authorization code.
5. For each approved domain contract, add only the corresponding isolated loader/DTO/callable and synthetic Auth + Functions + Firestore Emulator denial/allow tests.
6. Keep mailbox OAuth/lifecycle work frozen and separate from these domain priorities.
7. Do not merge, deploy, enable the integration flag or change `main` without separate explicit approval.

## Release posture

**Not ready for operational activation.** The isolated bridge remains disabled. No merge, deployment, production Firebase access, real-data migration, mailbox connection or synchronization is authorized by this register.
