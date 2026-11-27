# DSM Firestore direct-access regression results — 2026-11-27

**Branch:** `codex/employee-shift-date-range-query`  
**Commit:** `949395b59034d1e46d8502a451381aa230cf1d3a`

## Emulator results

[Firebase rules emulator workflow](https://github.com/Gionzeli/TURNIGPG-SICUREZZA/actions/runs/46059189947) completed successfully.

- Total Firestore Rules Emulator tests: **40 passed, 0 failed**.
- FR-26 passed: direct reads of canonical employee records, employment profiles, compensation records, placements, reciprocal bindings, shift documents and employee control records are denied for both a verified employee and the synthetic legacy-admin test identity.
- FR-27 passed: a signed-in employee cannot enumerate the canonical employee-shifts collection.

[DSM Core browser workflow](https://github.com/Gionzeli/TURNIGPG-SICUREZZA/actions/runs/46059190008) also completed successfully.

## Important scope clarification

The synthetic admin identity in the rules test exercises the repository's existing legacy administrator rule. It is not proof of canonical manager/admin authorization, and it does not replace server-side callable authorization. The direct-denial result is narrower: neither that legacy-admin identity nor a verified employee gets direct client access to the canonical collections.

The Auth + Functions + Firestore Emulator tests for the own employment profile and own shifts previously passed at commit `44731217c39d99031b2ed0c105c8e45c940415ea`. The backend workflow at that commit still failed in four unrelated, frozen mailbox-lifecycle tests; the backend workflow was not rerun by this rules/browser-only change.

## Operational boundary

No production Firebase, real employee records, mailbox credentials, migration, synchronization, deployment or merge were used. `TURNI_DSM_CANONICAL_AUTH_ENABLED` remains disabled. Payroll remains deny-by-default.
