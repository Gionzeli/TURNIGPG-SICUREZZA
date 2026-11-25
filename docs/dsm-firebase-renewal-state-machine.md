# DSM Firebase authorization renewal — state-machine design

**Status:** design proposal only; not implemented or wired into the operational application.
**Branch:** `dsm-enterprise/core-v1`
**Scope:** isolated DSM session lifecycle. No production Firebase configuration, UI, Firestore Rules, or secrets are changed by this design.

## Security invariant

A browser-held principal is a short-lived coordination hint, not an authorization boundary. Every operation that reads or writes tenant data must ultimately be authorized by a trusted server endpoint that verifies the Firebase ID token (including revocation) and resolves current membership and permissions. IndexedDB and client-side `capture()` checks cannot enforce tenant isolation against modified or same-origin code.

Until protected data APIs exist, this design does not authorize real or multi-tenant data use.

## State model

- `inactive`: no Firebase principal is installed.
- `active`: a server-resolved principal is installed and has not reached its server-issued expiry.
- `refreshing`: a single authorization refresh is in flight. New protected operations are paused; the old principal is not used to authorize new work.
- `invalidating`: the context is cleared and registered resources are being disposed.
- `blocked`: refresh or cleanup failed. No principal is installed; only a fresh authorization attempt or cleanup retry can proceed.
- `disposed`: terminal state; no future activation or refresh is accepted.

The state machine must be serialized. Each auth identity change and each refresh attempt receives a monotonically increasing epoch. A response may install a principal only if its epoch, UID, selected account, and session generation still match the request that produced it.

## Events and transitions

| Current state | Event | Required behavior |
|---|---|---|
| inactive | signed-in / explicit activation | Resolve authorization on the server; install only a complete, unexpired principal |
| active | token refresh for same UID | Enter refreshing, pause new operations, resolve current membership, then atomically replace principal |
| active | UID or selected account changes | Invalidate old context and resources before resolving the new identity |
| active | membership revocation / denied resolver | Clear principal and invalidate resources; never retain the previous authorization |
| active | principal expiry | Deny new operations immediately and enter refreshing or blocked; never extend expiry locally |
| refreshing | successful resolver, same UID/account, current epoch | Atomically install the new principal and return to active |
| refreshing | denied, expired, malformed response, or network error | Clear principal and enter invalidating/blocked; do not silently reuse the previous principal |
| refreshing | logout, account switch, dispose, or newer auth epoch | Discard the late response; the newer transition wins |
| invalidating | cleanup succeeds | Enter inactive, or continue with a separately requested new activation |
| invalidating | cleanup fails | Remain blocked with no principal; allow cleanup retry only |
| blocked | cleanup retry | Retry cleanup only; never reactivate a stored principal |
| any non-disposed state | dispose | Clear principal, detach listeners, finish cleanup, then enter disposed |

A transient network error is not evidence that the old membership is still valid. The safe policy is to deny new protected operations and clear the client authorization context. Recovery requires a fresh server confirmation.

## Token refresh and auth observer coordination

1. Observe identity/token events, but do not map every `onIdTokenChanged` callback directly to logout.
2. Coalesce concurrent refresh requests into one in-flight authorization operation.
3. Treat the forced `getIdToken(true)` call and its resulting SDK callback as part of the same refresh transaction. The callback may advance an observed token-event counter, but must not start a competing logout or invalidate the transaction merely because the token changed.
4. Compare the current Firebase user UID and selected account before and after each asynchronous boundary. Any identity/account change supersedes the refresh.
5. Call the trusted resolver after obtaining the refreshed token. The resolver must verify token signature, expiry and revocation, then read canonical current membership and permissions.
6. Install the new principal atomically only after the resolver succeeds and the request epoch is still current.
7. A refresh response for an old UID, account, epoch, or disposed session is discarded.
8. Never put ID tokens, refresh tokens, credentials, or raw membership documents into IndexedDB, logs, audit events, or BroadcastChannel messages.

The existing adapter listens to `onAuthStateChanged` and the session coordinator treats adapter events as invalidation signals. Replacing that observer with `onIdTokenChanged` without the transaction above is explicitly unsafe.

## Revocation and data operations

- A membership listener or push notification may accelerate UI invalidation, but is only a latency optimization; missed events and offline tabs must not preserve authority.
- Every server data endpoint must independently verify the caller's Firebase ID token with revocation checking and re-read canonical membership/permissions before authorizing the requested account and operation.
- The server must reject mismatched UID/account, inactive or expired membership, insufficient permission, revoked token, and stale client-supplied role/permission claims.
- The client may pause work and clear local context on a revocation signal, but cannot prove that a cached local principal remains authorized.
- If protected data APIs are not implemented, Firebase activation remains an isolated prototype path and must not be presented as production tenant authorization.

## Required tests before implementation

Use synthetic users, tokens, memberships, and data only.

1. Same-UID token refresh succeeds without an accidental logout.
2. Several simultaneous refresh requests coalesce into one resolver call.
3. A refresh-triggered SDK callback does not race or invalidate its own transaction.
4. UID change during token retrieval or resolver latency discards the old response.
5. Account selector change during refresh discards the old response.
6. Membership revoked between two resolver calls prevents principal replacement.
7. Resolver denial, malformed response, expiry, and network failure clear the previous context.
8. Cleanup failure leaves the context empty and permits cleanup retry only.
9. Logout/dispose during refresh prevents late activation.
10. Two tabs receiving duplicate/out-of-order invalidation messages remain fail-closed.
11. Expiry during a pending operation blocks new captures; server APIs independently reject stale authorization.
12. Protected data endpoints enforce token revocation and membership on every operation.

## Implementation order / release gates

1. Define canonical membership and permission semantics, including revocation and expiry.
2. Implement and emulator-test server-side protected data APIs. Do not use client IndexedDB as the multi-tenant security boundary.
3. Implement a standalone renewal coordinator with a serialized state machine and deterministic clock/test hooks.
4. Adapt Firebase observer handling to distinguish identity changes from same-UID token refreshes; keep the old context paused during refresh.
5. Integrate the coordinator into the isolated session factory, not the protected production composition root.
6. Run browser concurrency tests and backend Auth/Functions/Firestore Emulator tests on the exact commit.
7. Obtain independent security review before any production wiring or real-data access.

**Non-goals:** this document does not implement a timer, listener, renewal coordinator, protected data API, Firestore rule change, production wiring, migration, or deployment.
