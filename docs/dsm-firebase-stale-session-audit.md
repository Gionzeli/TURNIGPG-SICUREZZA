# Audit stale-session, renewal, and race-condition status

Audit date: 2026-11-26
Branch: `dsm-enterprise/core-v1`
Reviewed HEAD: `3e9ab83f3e568200b8d9a43894f9ff9d368d6bd2`

## Scope and method

Read-only inspection of the Firebase auth adapter, standalone renewal coordinator, DSM session factory, account context/lifecycle, and browser renewal tests. Synthetic test fixtures only; no Firebase credentials or real accounts. This is a code-path audit, not a penetration test.

## Confirmed behavior

- The Firebase adapter forces an ID-token refresh and calls the injected trusted resolver. The resolver must independently verify token revocation and current membership.
- The adapter captures the auth-event generation and selected-account revision. A late response is discarded if the Firebase user/generation or selected account/revision changed while authorization was resolving.
- The session factory serializes Firebase auth-change invalidation through `authChangeTask`, increments an auth revision, and clears an active Firebase context when lifecycle is active.
- A pending Firebase activation stores the revision; resume checks the revision and calls the adapter again instead of trusting the stored principal. A stale pending activation is cleared.
- The standalone renewal coordinator coalesces concurrent calls, tracks an epoch, rechecks identity after resolver completion, rejects stale responses, schedules renewal before expiry, and clears the installed principal on resolver denial or malformed/expired response.
- Account lifecycle checks Firebase expiry and denies new local operations after expiry; client context is only a coordination gate, not server-side data authorization.

## Integration limitation: automatic renewal is not wired into the DSM session

The renewal coordinator is a standalone module. The session factory does not instantiate or connect it. Firebase principal activation and pending-transition resume perform explicit adapter resolution, but there is no automatic timer-driven renewal integrated into this session factory.

Therefore:
- A short-lived principal expires and local lifecycle checks deny operations after expiry (fail-closed).
- Automatic seamless renewal in the session is **not demonstrated/implemented through this composition**.
- The standalone coordinator's timer tests do not establish renewal behavior in the DSM session or operational UI.

## Race / stale authorization conclusions

The inspected guards cover the resolver-response races in the adapter/coordinator and the stale pending-activation resume path. The browser lifecycle suite already covers two important pieces independently: an auth event during asynchronous transition cleanup cancels activation, and an auth-revision change prevents a pending stale Firebase principal from being resumed. It also separately covers cleanup failure followed by retry. The specific combined sequence — auth event during asynchronous cleanup, first cleanup attempt fails, retry completes, and the prior identity remains unusable — is **not directly asserted by one end-to-end session test**.

The following end-to-end scenarios therefore remain unverified:
1. The combined auth-event + asynchronous cleanup failure + retry sequence described above.
2. Account-selection revision changes during resolver and during lifecycle transition; verify stale principal never activates.
3. Membership revocation or site/department transfer between server resolution and a protected data request. No protected server data API exists to enforce the final request-time check yet.
4. Automatic renewal integration with session, cleanup failure, disposal, and tab lifecycle.
5. Simultaneous expiry and auth-change events, including delayed timer callbacks, with real session-level orchestration (synthetic tests only).

## Current test evidence

The browser renewal test file contains synthetic cases for renewal coalescing, identity change during resolve, explicit invalidation while old resolve remains pending, identity change without explicit invalidation, resolver denial, malformed/expired/mismatched response, expiry-minus-lead timer scheduling, timer-cancel cleanup failure, partial installer failure, and dispose preventing late installation.

These tests cover the standalone coordinator, not real Firebase Auth/Functions, real revocation, or the production composition root.

## CI evidence on reviewed HEAD

The exact reviewed HEAD `3e9ab83f3e568200b8d9a43894f9ff9d368d6bd2` passed both GitHub Actions workflows:

- Browser / Playwright [run 45811655238](https://github.com/Gionzeli/TURNIGPG-SICUREZZA/actions/runs/45811655238): success; browser test log reports 97 passing tests and 0 failures.
- Firestore Rules Emulator [run 45811655333](https://github.com/Gionzeli/TURNIGPG-SICUREZZA/actions/runs/45811655333): success; 38 passing tests, 0 failures, 0 skipped, executed against the local emulator.

These are synthetic/browser-local and emulator tests. They do not establish real Firebase Auth/Functions integration, production revocation behavior, or protected DSM data API enforcement.

## Next safe step

Before any wiring: define the approved renewal/expiry UX and lifecycle semantics. Then add session-level tests for the race cases above using synthetic adapters and controllable clocks/timers. Do not connect the coordinator to operational UI, expose data APIs, or deploy until authorization ownership and backend enforcement decisions are approved.
