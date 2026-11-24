# DSM integration readiness — audit

## Current state
- DSM core is implemented and its browser CI passes on commit `8cbe70f80fdc7e79b55e805dfaf71e996092fd15`.
- CI run: https://github.com/Gionzeli/TURNIGPG-SICUREZZA/actions/runs/45272296307
- This branch is a draft PR. Do not merge, deploy, or change `main` as part of this audit.

## Integration audit findings
1. The operational UI in `index.html` still reads and writes legacy operational data using `LocalStorage` (including `tg_online_v1`).
2. The Firebase UI emits a session event with Firebase UID/admin/member state, but the DSM account context explicitly accepts local identity only and rejects `firebase_verified`. No authenticated Firebase-to-DSM adapter exists yet.
3. `createDSMCoreSession()` is a library/factory and is not instantiated by the operational UI. No operational view or write path is migrated to DSM.
4. The legacy application and DSM remain separate. This is currently a safe separation; do not bridge them by passing a UID as if it were proof of authorization.

## Safe next steps (synthetic-only)
- Define and implement a Firebase adapter that receives only verified SDK auth state, checks UID and membership/authorization, and handles expiry, revoke, account-switch, and sign-out.
- Test the adapter with mocked Firebase auth states: unauthenticated, unverified email, pending member, approved member, inactive/expired member, admin, token/session changes, and late async callbacks.
- Add a non-operational integration harness that opens only `DSM_ENTERPRISE_TEST_DB`, uses synthetic accounts/records, and verifies isolation and cleanup across transitions.
- Add a read-only preview integration first. Do not change operational data reads or writes until the preview tests and security review pass.
- Before any operational integration: review Firebase security rules, privacy/data classification, encryption and key lifecycle, backup/restore, retention/deletion, and XSS/CSP/dependency risk.

## Release gates
- [ ] Verified Firebase identity adapter and authorization tests
- [ ] Synthetic integration harness only (test database name)
- [ ] Read-only preview with no writes to operational LocalStorage or Firestore
- [ ] Regression tests against current operational behavior
- [ ] Security/privacy review and explicit user approval
- [ ] Separate approval for merge/deploy

**Status:** Not operationally integrated. DSM remains a prototype core; no real data migration or synchronization is enabled.


## Work log — adapter boundary investigation

- Confirmed `firebase-ui-v3-13.js` emits a UI session event with UID/admin/member/request, but the event is not a trusted auth boundary for DSM.
- Confirmed `createAccountContext()` deliberately accepts only `identitySource: "local"` and rejects other sources. This blocks wiring Firebase UIDs directly into DSM (correct fail-closed behavior).
- A safe Firebase adapter therefore must consume Firebase SDK auth state (`auth.currentUser` / `onAuthStateChanged`) directly and validate verified email plus current member authorization, but also requires a new trusted capability path in account-context/lifecycle. That capability is not yet implemented; don't circumvent the local-only check or treat event payloads as proof.
- Integration is still not connected. The next implementation should be isolated adapter + synthetic auth tests and a capability-gated core API, reviewed together before any UI integration.
