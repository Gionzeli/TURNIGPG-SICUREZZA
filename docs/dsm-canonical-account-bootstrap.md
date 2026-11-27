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

The backend now includes a canonical membership invitation workflow. It is deliberately separate from Employee provisioning:

1. A verified, recent TOTP account admin proposes an invite for an email address and an existing active site in this account.
2. Only a different verified, recent TOTP account admin can approve it. Both admins are revalidated as active account admins inside the Firestore transaction.
3. The raw email is not persisted: the proposal stores only an HMAC-SHA-256 digest of the normalized address, using the server-side `DSM_INVITE_EMAIL_HMAC_KEY` (minimum 32 characters). If the key is missing or too short, invite creation/claim fails closed. CI uses a synthetic key only. The invite expires after 24 hours.
4. The invitee must authenticate with Firebase and claim using a revocation-checked ID token whose verified email matches the digest. The account and site are revalidated at claim time.
5. Only then is an active, site-scoped canonical `member` record created, with an audit event in the same transaction. Invited/pending proposals grant no permissions.
6. The existing Employee provisioning flow remains a second, independent two-person approval: one admin proposes UID↔Employee association and a different recent-TOTP admin approves. Employee creation, both binding mirrors, control revision, proposal transition and audit append are atomic.

Callable endpoints: `proposeCanonicalMembershipInvite`, `approveCanonicalMembershipInvite`, and `claimCanonicalMembershipInvite`. The invite workflow does not send email or deliver a link: distribution of the opaque `inviteId` is an out-of-band operational step and no email provider is connected. A real deployment must provision a separate strong secret for `DSM_INVITE_EMAIL_HMAC_KEY`; never reuse the CI fixture key. No raw email is returned by the callable or stored in Firestore.

The legacy migration page now contains invitation proposal, second-admin approval and invite-claim screens, wired to the callable endpoints. They render only when the existing `TURNI_DSM_CANONICAL_AUTH_ENABLED` flag is explicitly true; the flag remains off by default. Browser tests use a synthetic Firebase identity and mock callables only. The UI does not deliver email: the invite code is distributed out-of-band. No real Firebase project or collaborator has been configured. The synthetic owner fixture remains test bootstrap only.

## Verification boundary

Run the Functions test suite with `npm test` from `functions/`. To seed Firestore Emulator manually, start only the Firebase Auth/Functions/Firestore emulators in a project whose ID starts with `demo-`, then run:

```sh
node scripts/seed-canonical-account-emulator.js
```

No production Firebase configuration, credentials, real user records or real collaborator data are required or permitted for this fixture.
