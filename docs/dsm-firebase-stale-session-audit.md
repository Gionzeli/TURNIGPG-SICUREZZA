# Audit stale-session, renewal, and race-condition status

Audit date: 2026-11-26
Branch: `dsm-enterprise/core-v1`
Reviewed HEAD: `add61980053585878f3e24a1a100143a9c91d386`

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

The inspected guards cover the resolver-response races in the adapter/coordinator and the stale pending-activation resume path. The following end-to-end scenarios remain unverified:
1. Auth event occurs while a transition is in progress and cleanup is delayed/fails; assert resources stay inaccessible and cleanup can be retried without resuming stale identity.
2. Account-selection revision changes during resolver and during lifecycle transition; verify stale principal never activates.
3. Membership revocation or site/department transfer between server resolution and a protected data request. No protected server data API exists to enforce the final request-time check yet.
4. Automatic renewal integration with session, cleanup failure, disposal, and tab lifecycle.
5. Simultaneous expiry and auth-change events, including delayed timer callbacks, with real session-level orchestration (synthetic tests only).

## Current test evidence

The browser renewal test file contains synthetic cases for renewal coalescing, identity change during resolve, explicit invalidation while old resolve remains pending, identity change without explicit invalidation, resolver denial, malformed/expired/mismatched response, expiry-minus-lead timer scheduling, timer-cancel cleanup failure, partial installer failure, and dispose preventing late installation.

These tests cover the standalone coordinator, not real Firebase Auth/Functions, real revocation, or the production composition root.

## Next safe step

Before any wiring: define the approved renewal/expiry UX and lifecycle semantics. Then add session-level tests for the race cases above using synthetic adapters and controllable clocks/timers. Do not connect the coordinator to operational UI, expose data APIs, or deploy until authorization ownership and backend enforcement decisions are approved.
