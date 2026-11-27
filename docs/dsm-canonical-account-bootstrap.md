# Canonical organization account bootstrap

**Decision:** the canonical DSM account ID for the organization is `turnigpg-sicurezza`, confirmed by the user on 2026-11-27.
**Implementation scope:** synthetic Firebase Emulator fixture on `codex/employee-shift-date-range-query`.
**Not authorized:** creation in a real Firebase project, use of real collaborator identities, import from legacy `members/{uid}`, migration, production activation, merge, or deployment.

## Identity model

These identifiers are separate and must never be substituted for one another:

- `accountId = turnigpg-sicurezza`: stable organization/tenant identifier.
- Firebase `uid`: authenticated account identity.
- `employeeId`: canonical Employee record identifier, linked only through the protected two-sided binding.

Legacy root-level `members/{uid}` records are not canonical DSM memberships and are not imported or promoted automatically.

## Emulator fixture

`functions/scripts/seed-canonical-account-emulator.js` creates only:

- `accounts/turnigpg-sicurezza`, with active status and schema/version fields;
- `accounts/turnigpg-sicurezza/members/dsm-bootstrap-owner-synthetic`, a synthetic account-admin membership.

The script requires `FIRESTORE_EMULATOR_HOST` and a project ID beginning with `demo-`. It refuses to run outside that boundary, never overwrites conflicting records, and is idempotent for the exact fixture. The `fixtureOnly` marker is explicit. The seed does not create a real Firebase Auth user, does not use a real UID, and does not make the web app's disabled auth bridge active.

## Collaborator association

The existing Employee provisioning service remains a separate two-person process:

1. A verified, recent TOTP account admin proposes a target Firebase UID, Employee ID and opaque out-of-band verification reference.
2. A different verified, recent TOTP account admin approves.
3. The target must already have an active canonical `member` membership under this account.
4. Employee creation, forward and reverse UID↔Employee reservations, control revision, proposal approval and audit append commit atomically.
5. Existing reservations, mismatches, expired proposals or missing canonical membership fail closed. No overwrite or automatic legacy mapping is allowed.

The current prototype does not yet include a safe end-to-end invitation/membership creation workflow for real collaborators. Therefore the synthetic owner fixture is a test bootstrap only; it is not a claim that production onboarding is complete.

## Verification boundary

Run the Functions test suite with `npm test` from `functions/`. To seed Firestore Emulator manually, start only the Firebase Auth/Functions/Firestore emulators in a project whose ID starts with `demo-`, then run:

```sh
node scripts/seed-canonical-account-emulator.js
```

No production Firebase configuration, credentials, real user records or real collaborator data are required or permitted for this fixture.
