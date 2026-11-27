# Firestore direct-access verification — 2026-11-27

## Scope

Repository: `Gionzeli/TURNIGPG-SICUREZZA`  
Branch: `codex/employee-shift-date-range-query`  
Commit tested: `de511df948ee3f5dfd99d1d8f5bfd85accb1978a`  
Workflow: [Firebase rules emulator tests](https://github.com/Gionzeli/TURNIGPG-SICUREZZA/actions/runs/46059407619)  
Job: `firestore-rules-emulator` (`140709738528`)

## Result

The GitHub Actions job completed successfully. The Firebase Emulator test output reports:

- 40 tests
- 40 passed
- 0 failed
- 0 skipped

The log explicitly reports FR-26 as test 11 and FR-27 as test 12, both passing.

## FR-26 — canonical employee data

The test seeds synthetic documents with Security Rules disabled, then verifies that both a verified employee identity and a synthetic legacy-admin identity are denied direct reads on these eight paths:

- `accounts/account-a/employees/employee-a`
- `accounts/account-a/employees/employee-a/employmentProfiles/current`
- `accounts/account-a/employees/employee-a/compensation/current`
- `accounts/account-a/employees/employee-a/placements/placement-a`
- `accounts/account-a/employeeBindingsByUid/user-a`
- `accounts/account-a/employeeBindingsByEmployee/employee-a`
- `accounts/account-a/employeeShifts/shift-a`
- `accounts/account-a/employeeControl/employee-a`

For each seeded path, the test also verifies that both identities are denied direct `setDoc` overwrite attempts, `updateDoc` attempts, and `deleteDoc` attempts.

Important precision: because the fixture document is seeded before the client write attempts, the `setDoc` assertion proves denial of a direct set/overwrite against an existing document; it is not a separate test of creating a previously absent document at each path.

## FR-27 — shift collection enumeration

The test seeds a synthetic employee shift and verifies that a signed-in verified employee cannot enumerate `accounts/account-a/employeeShifts` with `getDocs`.

## Boundaries and remaining work

- All evidence is from the Firebase Emulator with synthetic fixtures only.
- This verifies Firestore client Security Rules, not server-side callable authorization correctness or manager delegation completeness.
- The synthetic admin identity exercises the current legacy email-based admin rule; it does not establish canonical manager authorization.
- Firestore Admin SDK operations bypass client Security Rules and therefore still require correct server-side authorization in callable functions.
- The canonical account bridge remains disabled. No production Firebase, real employee data, payroll data, or mailbox access was used.
- No merge or deployment was performed.
