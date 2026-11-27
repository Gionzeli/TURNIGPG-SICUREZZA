# DSM integration checkpoint — 2026-11-27

## Branch and safety boundary

- Working branch: `codex/employee-shift-date-range-query`.
- Checkpoint commit before this note: `debeaa5951e45870159af4efbc0ee2e7f598d826`.
- No changes to `main`, no merge, no deploy, no production Firebase access, no real mailbox/provider access.
- PR #1 on `dsm-enterprise/core-v1` remains separate and untouched.
- `TURNI_DSM_CANONICAL_AUTH_ENABLED` remains disabled. The canonical bridge is not activated in the operational app.

## What is now implemented and verified

1. **Canonical identity and membership**: Firebase ID token verification, revocation checks, canonical account and membership resolution, and account selection are server checked.
2. **Employee binding**: protected employee paths resolve the Employee from the backend-owned UID binding and require the reciprocal Employee-to-UID binding to agree.
3. **Own employment profile (D-01)**: the callable `readOwnEmployeeEmploymentProfile` loads only the approved D-01 fields (CCNL, section, level, role, effective date) and returns an explicit DTO. It rejects client-selected Employee IDs and excludes payroll, bank/payment, health, and private-note fields.
4. **Own shifts**: date-range query, placement/scope validation, allowlisted DTO, proposal submission, and employee-only proposal approval/rejection exist. Direct shift mutations remain fail-closed.
5. **UI bridge code**: the isolated canonical account bridge contains views for own employment profile, own shifts, and personal proposals. Its bootstrap is behind the disabled canonical-auth feature flag; this is not an operationally enabled integration.
6. **Synthetic browser coverage**: the browser/Playwright workflow completed successfully on this commit (run 46057721879).
7. **New Auth + Functions + Firestore end-to-end coverage**: the new test `functions/test/employee-employment-profile.auth-emulator.integration.test.js` passed on the Functions Emulator run. It verifies unverified-email denial, verified-email access, client Employee selector rejection, DTO allowlisting, and revoked reciprocal binding denial. The related Firestore loader tests also passed.

## CI result on checkpoint commit

- Browser workflow: [run 46057721879](https://github.com/Gionzeli/TURNIGPG-SICUREZZA/actions/runs/46057721879) — success.
- Backend workflow: [run 46057721805](https://github.com/Gionzeli/TURNIGPG-SICUREZZA/actions/runs/46057721805) — failure, **221 passed / 4 failed / 0 skipped**.
- The new own-employment-profile Auth/Functions/Firestore test passed (subtest 31); the Firestore loader test and input-validation test passed as well.
- All four failures are in the separate mailbox lifecycle lane, not in the new profile/shift integration path:
  - `mailbox-connection-firestore-adapters.test.js`: cleanup retry metadata expectation does not match the adapter validation error.
  - `mailbox-credential-vault.test.js`: parse-time SyntaxError in `mailbox-credential-vault.js` (malformed string literal).
  - `mailbox-secret-cleanup-worker.test.js`: retry test expects one deferred ticket but implementation returns two.
  - `mailbox-token-lifecycle-coordinator.test.js`: test stub drops `expectedVersion` before asserting it.
- Mailbox OAuth/lifecycle remains frozen by project priority. These failures are recorded as a separate CI blocker, not silently counted as passed and not used as a reason to expand the current integration scope.

## What is still not complete

- The canonical bridge remains disabled in the operational application. Do not enable the feature flag as part of this checkpoint.
- No complete protected-data API layer exists for all employee domains; the Functions health endpoint correctly reports `protectedEmployeeDataApisImplemented: false`.
- No manager/team shift endpoint is authorized or implemented. Delegated manager shift authorization remains false.
- D-02 compensation and D-03 manager roster require schema-to-field mapping and dedicated DTO/permissions before implementation. Payroll remains deny-by-default.
- Absence manager visibility is restricted to minimal availability projections; no absence reason, category, health details, or document endpoint is authorized.
- Email ingestion is a proposal-generation core only: no production provider connection, worker, PDF parser/OCR, or mailbox automation.
- No real-data migration, Firestore operational synchronization, or general Firestore data adapter is enabled.

## Next safe sequence

1. Keep the operational bridge flag disabled.
2. Add/verify an Auth + Functions + Firestore Emulator test for the own-shifts date-range callable and its fail-closed mutation endpoints (the existing shift coverage includes Firestore Emulator handler tests, but not yet the same full Auth-to-callable route as D-01).
3. Reconcile this readiness checkpoint with the older historical status notes so old statements do not imply that current own-profile/own-shift APIs are absent.
4. Complete D-02/D-03 schema-to-field mapping only after reviewing the canonical employee schema; do not expose compensation or manager roster data until separately tested.
5. Treat the mailbox CI failures as a distinct frozen-lane issue; do not wire mailbox OAuth, providers, workers, or secrets into the operational app.

## Release status

**Not ready for operational activation.** The current progress is an isolated, synthetic, server-authorized self-service path with a disabled UI bridge. Passing the new profile test does not constitute a security certification or approval to enable, merge, or deploy.
