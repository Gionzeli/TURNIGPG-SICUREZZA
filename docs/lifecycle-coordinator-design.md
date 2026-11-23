# DSM Lifecycle Coordinator — design proposal

## Goal
Make account changes/logout a UI and operation lifecycle boundary. This is a proposal, not an active security control; no UI or repository is wired to it yet.

## Required invariants
1. Every activation/clear/switch increments a monotonically increasing context generation.
2. Transition start publishes a non-active state and synchronously asks subscribers to clear rendered data and caches.
3. Repository operations may capture `{accountId, generation}`; results are renderable only if the generation is still current and the context is active.
4. New operations are denied while a transition is in progress.
5. Old connections/repositories are retired after views have cleared; fresh instances are constructed after the new context is active.
6. Cross-tab coordination is a separate requirement and cannot be implied by a per-tab coordinator.

## Proposed API (not implemented)
- `beginTransition(reason)`: moves to `switching`, increments generation, notifies listeners; returns opaque transition handle.
- `activateLocal(handle, accountId)`: validates transition handle, activates only local/demo identity, publishes active state.
- `clear(handle)`: clears account context, publishes cleared state, and completes transition.
- `capture()`: returns immutable accountId + generation only in active state.
- `isCurrent(capture)`: false if cleared, switching, account differs, or generation differs.
- `subscribe(listener)`: returns unsubscribe; listeners must clear UI state on transition start and dispose stale caches.
- `registerDisposable(disposable)`: connection/repository/view cleanup registry; disposal errors are isolated and surfaced to diagnostics, never data-bearing logs.

## Ordering for account switch
1. Start transition and increment generation (old async results become stale immediately).
2. Notify UI listeners synchronously; clear visible records, selections, search results, and cached DTOs.
3. Best-effort abort registered cancellable transactions; do not promise IndexedDB rollback after completion.
4. Close old DB connection and dispose registered resources.
5. Activate new local context, create fresh repositories, load data.
6. Render async results only after checking `isCurrent(capture)`.

## Error and failure policy
- If cleanup fails, remain non-active and require explicit recovery; do not activate another account while old resources are uncertain.
- A stale result is silently discarded by presentation layer (optional generic diagnostics only).
- Listener failures must not prevent other listeners from clearing. Collect generic failure indicators without logging record content or account IDs.
- Clear/logout must never be represented as secure deletion of IndexedDB.

## Test matrix (synthetic fixtures only)
- Generation invalidates stale read: capture A, switch to B, `isCurrent(A)` false.
- Logout invalidates: capture, clear, stale result blocked.
- UI listener immediately clears cached view model on transition.
- Subscriber throws: remaining subscribers still receive transition notification; coordinator remains blocked until recovery.
- Dispose callbacks run and are idempotent; failure blocks activation.
- Old repository connection is not reused after lifecycle transition.
- Read begun under A resolves after B activation: result must be discarded before render.
- Cross-tab note: confirm no security claim without explicit coordination and tests.

## Implementation sequence
A. Implement coordinator as an isolated module with unit/browser tests.
B. Add repository operation capture/check hooks (without pretending they cancel IndexedDB).
C. Wire UI views to transition subscriptions and clear caches.
D. Add integration tests for late results and account switch.
E. Review multi-tab behavior separately.

## Security note
This coordinator only protects application lifecycle correctness. Client-side account contexts are not authentication, and generation tokens do not protect against same-origin malicious scripts. IndexedDB is currently unencrypted; do not use operational or sensitive data.
