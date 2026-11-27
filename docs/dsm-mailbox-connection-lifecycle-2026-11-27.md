# Mailbox connection lifecycle — server-side boundary

This module adds a provider-neutral lifecycle boundary for personal and shared schedule mailboxes. It is deliberately not wired to a callable, scheduled worker, real provider, Firebase project, or production secret store.

## Authorization and ownership

- A personal connection requires an active canonical member principal with an Employee binding. The provider-verified mailbox address must match that member's verified canonical email. The connection records both the owner UID and Employee ID; only that owner can revoke it.
- A shared connection requires the explicit server-resolved `manageSharedMailboxConnections` permission. Being an application administrator or being able to approve shifts does not itself grant this permission. Shared connections have no personal Employee owner.
- Both modes require an explicit sender allowlist. Sender authentication and mailbox ownership verification remain distinct checks performed by the provider adapter and ingestion pipeline.

## Credential handling

- Provider adapters (IMAP/OAuth/API) are injected server-side. The authorization payload and resulting credential material must never be accepted by a browser-facing callable or written to Firestore.
- The credential material is passed directly to an injected secret-vault adapter. Persistent connection metadata contains only an opaque `credentialSecretRef`; the returned DTO never contains it.
- If connection persistence fails after vault storage, the service attempts to revoke the newly stored secret.
- Revocation first changes status to `revocation_pending`, which is not eligible for ingestion. The vault credential is revoked before the connection becomes `revoked`. A vault outage leaves the connection fail-closed in `revocation_pending` for retry/reconciliation.
- The production adapter must use Secret Manager/KMS or an equivalent vault, with least-privilege access, rotation, audit, and deletion/revocation. No secret reference should be readable by browser clients.

## Not yet implemented

No Gmail, Microsoft Graph, generic OAuth, IMAP/IDLE, polling, or custom-provider adapter is connected. No OAuth consent screen/callback/PKCE state, IMAP credential verification, Firestore persistence adapter, Secret Manager adapter, background worker, email subscription/webhook, parser/OCR, UI, or production activation is included. Provider support must be validated per provider; IMAP may be disabled or require app passwords/OAuth. This service is exercised only with synthetic unit fixtures.

## Firestore adapter boundary

A server-only Admin-SDK adapter now persists connection metadata at
`accounts/{accountId}/mailboxConnections/{connectionId}` and immutable audit
events below `mailboxConnectionAudit`. It validates metadata, prevents changes
to the owner/provider/mailbox/sender allowlist after creation, and permits only
the monotonic lifecycle `active → revocation_pending → revoked`. The vault
reference is cleared only in the final revoked state. The existing catch-all
Firestore Rules deny client reads and writes to this canonical subtree.

The adapter is unit-tested with an in-memory Firestore-shaped fixture. It is
not instantiated by `functions/src/index.js`, and no callable or real
Firestore operation invokes it yet. It does not make provider authorization or
secret storage available; those adapters remain absent.

## Personal actor authorization adapter

A separate server-side resolver now reloads the active Firebase Auth user,
canonical account and membership, and both reciprocal UID↔Employee binding
documents in one Firestore transaction. It also verifies the Employee lifecycle
record. It rejects disabled or unverified Auth users, inactive/expired
membership, stale or mismatched reciprocal bindings, and every shared-mode
request. The callable layer must still verify the incoming Firebase ID token
with revocation checking before invoking the mailbox service; the resolver
does not accept a client-supplied Employee ID.

This resolver is not yet wired into a callable. No provider authorization
payload is accepted from the browser, and no mailbox connection is enabled.

## OAuth transaction and PKCE core (synthetic-only)

A new server-only transaction coordinator provides OAuth state binding and PKCE S256 primitives for Gmail API and Microsoft Graph provider flows. It stores the verifier server-side through an injected persistence adapter, returns only state and challenge to the caller, and consumes transactions atomically by hashed state. Transactions are bound to account, actor UID and provider, expire after ten minutes, and are single-use. Unit tests use synthetic state storage only.


This is not a provider integration: redirect URI validation, OAuth client configuration, consent screens, callback HTTP handling, provider token exchange, encrypted vault storage, and Firebase callable wiring remain to be implemented and security-reviewed. The transaction store contract requires atomic consume/delete; no real provider or Firebase service has been accessed.

## Firestore OAuth transaction storage (server-only, synthetic tests)

A concrete Admin-SDK adapter for the PKCE transaction store now uses a Firestore transaction to read and delete a state-hash document atomically. Document IDs are SHA-256 state hashes; raw OAuth state is never persisted. The adapter validates record shape, provider allowlist, verifier format, and the fixed ten-minute lifetime. Expired/malformed transactions are deleted on consumption and fail closed. This adapter is not wired to Firebase or a callable; provider callback and configuration remain absent.

## Fixed OAuth authorization URL builder

Added a pure builder for Gmail and Microsoft authorization URLs. Endpoints and scopes are fixed in code (Gmail readonly; Microsoft Mail.Read), with PKCE S256 and a constrained Microsoft tenant selector. The redirect URI must be supplied by trusted server configuration and registered exactly with the provider; this builder validates HTTPS and rejects query/fragment but is not itself an allowlist and must never receive a client-controlled redirect. It is not callable-wired or connected to provider clients.

## Server-side authorization-code token exchange (synthetic tests)

Added a provider-fixed OAuth authorization-code exchange helper using injected server HTTP transport. It posts form data to fixed Google or Microsoft endpoints, uses the stored PKCE verifier, disables redirects, validates JSON/token fields and response size, and masks transport errors. It returns sensitive token material only to trusted server code; callers must verify identity/scopes and store credentials in the vault immediately. No HTTP requests are performed by tests (mock transport only). It is not wired to callables, real provider credentials, or a vault.

## OAuth mailbox owner identity verifier (synthetic-only)

Added `functions/src/membership/mailbox-owner-identity-verifier.js` to verify provider token identity before connection metadata is persisted.

- Google: fixed OpenID UserInfo endpoint; requires stable subject, `email_verified === true`, and normalized canonical email match.
- Microsoft: fixed Graph `/me` endpoint; requires provider user ID and matching `mail` or fallback `userPrincipalName`.
- Fixed URLs only, injected server transport, redirects rejected, bounded response text, generic errors, and token-free return shape.
- Normalization lowercases only; no plus-tag or dot normalization.
- Synthetic tests use mocked responses only.

Not integrated with callback/callable, vault, or live providers. Microsoft UPN may not represent primary SMTP; production policy for canonical mailbox matching still needs review. Caller must revalidate actor/membership and store tokens in a server vault immediately.

## Credential vault adapter boundary (synthetic-only)

Added `functions/src/membership/mailbox-credential-vault.js`, a server-side adapter contract for a secure secret backend. It accepts validated Google/Microsoft OAuth token material, generates a scoped opaque secret reference, and passes secret payload only to injected `backend.putSecret`. Revocation calls injected `deleteSecret` only for a secret ref matching the account/connection prefix. Backend errors are masked. Metadata remains separate; this adapter is not a concrete Secret Manager/KMS integration.

Synthetic tests use an in-memory stub only. No live tokens, vault credentials, Firebase or cloud calls were used. Production requires a real managed vault implementation, IAM least-privilege, audit/retention controls, provider refresh/revocation policy, and a reviewed recovery path.


## OAuth refresh helper (synthetic-only)

Added `functions/src/membership/mailbox-oauth-refresh-service.js`. It refreshes access tokens through fixed Google or Microsoft endpoints, using an injected server HTTP transport and rejecting redirects. Provider and tenant are allowlisted; response size and token fields are validated, and provider error details are masked. The return shape includes an optional rotated refresh token: the trusted caller must store any replacement immediately and retain the prior refresh token if none is returned. Refresh operations must be serialized per mailbox connection to avoid rotation races. Unit fixtures are synthetic/mock only. This helper is not wired to OAuth credentials, a vault, Firebase callable, polling worker, or real provider accounts. Tests are authored but not executed in this environment.


## OAuth remote revocation helper (synthetic-only)

Added `mailbox-oauth-revocation-service.js`. Google access/refresh tokens can be submitted to Google's fixed revoke endpoint with POST and redirects disabled; bounded response validation and masked errors apply. For Microsoft delegated OAuth, the helper deliberately does not claim remote token revocation: ordinary delegated clients lack a general user-token revoke endpoint. Local connection disablement and vault deletion remain required; consent/session revocation may require user or admin action. Synthetic tests only. Not callable-wired or used with live accounts.


## Token lifecycle coordinator (synthetic-only)

Added `mailbox-token-lifecycle-coordinator.js` to orchestrate an injected vault read/write adapter and OAuth refresh helper. It checks expiry with a five-minute safety window, retains the existing refresh token when rotation is omitted, persists refreshed material before returning a fresh access token, and deduplicates concurrent refresh requests in a single process. The adapter contract is `loadSecret({secretRef})` and `storeSecret({secretRef, secretMaterial})`, which is not yet implemented by the existing vault adapter. The lock is process-local, not distributed; production requires per-connection distributed lease/transaction coordination to avoid refresh rotation races. This is not integrated or executed; synthetic tests only.


## Token lifecycle vault adapter (synthetic-only)

Added `mailbox-token-lifecycle-vault-adapter.js` to implement the coordinator's `loadSecret`/`storeSecret` contract against injected `readSecret`/`replaceSecret` backend operations, with strict opaque-reference format checks, token payload validation, and masked backend errors. The backend's `replaceSecret` must guarantee atomic/versioned replacement and access control. This is a separate adapter contract and is not wired to the existing create/revoke vault adapter or a cloud Secret Manager. Synthetic tests only; not run.


## Atomic token-secret rotation contract

The lifecycle vault adapter now requires versioned reads (`{payload, version}`) and compare-and-swap writes (`replaceSecret({secretRef, payload, expectedVersion}) -> {version}`). The backend MUST implement the comparison and replacement atomically; a version mismatch must reject with `code: conflict`. The coordinator passes the loaded version to the write, and the adapter preserves conflict errors rather than treating them as generic persistence failures. This prevents a stale refresh operation from overwriting a newer secret version, but it does not by itself provide a distributed refresh lease or guarantee provider refresh-token replay safety. The existing generic credential vault is not yet wired to this contract. Synthetic tests only; not executed.

### CAS concurrency regression coverage

The token-lifecycle vault adapter test suite now includes a concurrent stale-writer case: two refresh writers start from the same secret version, exactly one compare-and-swap succeeds, and the other receives a version conflict. This is a synthetic in-memory contract test only; it does not prove a deployed Secret Manager/KMS backend implements atomic conditional replacement. Production integration still requires a provider-specific atomic version/ETag primitive and a distributed per-connection refresh lease.

## Google Secret Manager version-pointer CAS backend (not deployed)

Added `google-secret-manager-token-cas-backend.js`. It stores serialized token payloads only as immutable Google Secret Manager versions; Firestore stores only the active numeric version pointer. A writer creates a new immutable secret version, then uses a Firestore transaction to compare the pointer with `expectedVersion` and advance it. A stale writer receives `code: conflict`; its already-created Secret Manager version can remain orphaned and must be cleaned up by a separately controlled retention process. The pointer document must be provisioned server-side with the initial version, and client writes to pointer documents must be denied.

The adapter accepts injected Admin SDK clients and trusted server-only resource mapping functions; it does not add cloud SDK dependencies, create cloud resources, grant IAM, or wire callable endpoints. Tests use synthetic in-memory clients only. Production still requires IAM least privilege, Firestore rules/authorization for pointer paths, Secret Manager lifecycle/retention policy, orphan-version cleanup, distributed refresh leases, and integration tests against the selected Google Cloud project. No live credentials or Firebase project were used.

## Firestore refresh leases (synthetic tests; not production-wired)

Added `mailbox-token-firestore-lease-service.js`, a transaction-backed per-account/per-connection lease with owner identity, bounded expiry, monotonically increasing fencing token, guarded renewal, and owner/fence-scoped release. Lease documents contain coordination metadata only; they must be server-only and inaccessible to clients. Expired leases can be taken over, and stale owners cannot renew or release a successor's lease.

The token lifecycle coordinator can now accept an injected `leaseService`: it acquires a lease before reading/refreshing, renews it after the provider response and before persisting rotated credentials, and releases it in a finally path. The process-local in-flight map remains a local optimization; cross-instance coordination depends on the injected Firestore service. The provider HTTP request must remain bounded below the lease duration; if the lease expires while the provider is working, renewal fails and the returned token is not persisted. A crash can leave a lease until expiry. Synthetic tests cover lease ownership/expiry/fencing and coordinator ordering. No Firestore project, live provider, or deployed lease collection was used.


### Lease integrity and read-path refinement

The coordinator now checks token expiry before acquiring a distributed lease. It acquires a lease only when refresh is needed, then reloads the secret under the lease and rechecks expiry so a token refreshed by another process is reused rather than refreshed again. The Firestore lease service rejects malformed persisted fencing/expiry fields, non-safe clock/expiry values, and exhausted fencing counters instead of silently resetting the fencing sequence. Renewal also rejects malformed expiry values. Regression tests use synthetic Firestore-shaped fixtures only; no emulator or live project was used.


## Atomic lease fencing at secret-pointer commit

The Google Secret Manager/Firestore CAS backend accepts an optional lease proof and, when supplied, reads the lease document in the same Firestore transaction as the secret pointer. The pointer advances only if both the expected secret version and the unexpired lease owner/fencing token still match. This closes the stale-owner window between a coordinator lease renewal and persistence. A losing writer can still leave an immutable, unreferenced Secret Manager version; cleanup remains a separate retention task. Synthetic tests only; no Firebase Emulator, cloud project, or live Secret Manager was used.


The Secret Manager CAS backend now requires a lease proof by default (requireLeaseProof: true) and rejects construction without a trusted lease-reference mapper. The explicit requireLeaseProof: false compatibility mode is used only by isolated pointer-CAS contract fixtures; production wiring must retain the default.


### Coordinator-to-vault lease-proof regression

The coordinator regression test now asserts that the owner ID and fencing token returned by the renewed lease are forwarded unchanged to the vault write. This verifies the hand-off contract between the refresh coordinator and the Secret Manager/Firestore CAS backend at the unit boundary. It remains a synthetic unit test; no emulator or cloud service was exercised.


## Firestore Emulator lease-fencing integration test

Added `functions/test/google-secret-manager-token-cas-emulator.integration.test.js`. When `FIRESTORE_EMULATOR_HOST` is set, the test uses the Firebase Admin SDK against that Firestore Emulator and a synthetic in-memory Secret Manager transport. It creates isolated pointer/lease documents, commits one valid fenced update, replaces the lease owner/fencing token, and verifies that the stale owner cannot advance the pointer. Test documents are deleted in a finally path. It does not contact Google Secret Manager or any live cloud project.

Run from the `functions` directory in one terminal:

```sh
npm run emulators
```

Then, in a second terminal:

```sh
FIRESTORE_EMULATOR_HOST=127.0.0.1:8081 GCLOUD_PROJECT=demo-dsm-mailbox node --test test/google-secret-manager-token-cas-emulator.integration.test.js
```

Without `FIRESTORE_EMULATOR_HOST`, Node's test runner marks this integration test skipped; ordinary unit tests remain synthetic. The test has been added but has not been executed in this environment. It validates Firestore transaction behavior with a mocked secret-version API, not actual Secret Manager IAM, version retention, or deployed callable wiring.

The Emulator integration test also checks that a write without a lease proof is rejected with `failed-precondition`, and that a current-but-expired lease proof is rejected with `conflict`; in both cases the active Firestore pointer must remain unchanged.


## End-to-end token lifecycle Emulator test

Added `functions/test/mailbox-token-lifecycle-emulator.integration.test.js`. This composes the Firestore lease service, token lifecycle coordinator, vault adapter, and Secret Manager/Firestore CAS backend against the Firestore Emulator. Secret Manager and the OAuth refresh endpoint are synthetic in-memory implementations.

The test uses two independent coordinator instances against the same connection. It holds the first refresh in flight, verifies that the second instance cannot acquire the active lease, then allows the first refresh to rotate and persist the token pair. The second instance retries and must observe the fresh access token without invoking refresh again. It also checks the persisted refresh-token rotation, pointer version, and released lease.

Run with the Firestore Emulator active, from `functions`:

```sh
FIRESTORE_EMULATOR_HOST=127.0.0.1:8081 GCLOUD_PROJECT=demo-dsm-mailbox node --test test/mailbox-token-lifecycle-emulator.integration.test.js
```

This is an Emulator integration test, not evidence of a test run. It does not exercise a live OAuth provider, Google Secret Manager, production IAM, distributed deployment, or callable wiring.


## Revocation gate for in-flight token refresh

The Firestore lease service now exposes `disable({accountId, connectionId})`. It atomically marks the per-connection lease record with `revocationPending: true`; the marker is monotonic and is not cleared by lease release. Lease acquisition and renewal reject a connection carrying that marker. The Secret Manager/Firestore CAS backend checks the same marker inside the transaction that updates the active secret-version pointer, so a refresh that started earlier cannot commit a newly rotated credential after revocation has won the transaction race.

`createMailboxConnectionService` now requires an injected `disableRefresh` dependency. Revocation persists `revocation_pending`, disables refresh, and only then calls the vault deletion boundary. If disabling fails, vault deletion is not attempted and the connection remains non-active for retry/review. The caller must inject the Firestore lease service's `disable` operation for the same trusted account/connection mapping. Connection metadata and the lease gate are separate records; ingestion workers must also continue to honor the connection's non-active status.

Synthetic tests cover disable-before-delete ordering, fail-closed behavior when the gate is unavailable, acquire/renew rejection, and the Firestore Emulator CAS transaction rejecting a valid-looking lease proof once `revocationPending` is set. The Emulator test has not been run here. This does not cancel an HTTP refresh request already sent to a provider, remotely revoke every provider session, or prove production wiring.

The coordinator unit tests also verify that if lease renewal fails after the provider has returned rotated tokens, the coordinator does not call the vault store operation and still attempts lease release. This covers the application-side half of the revocation race; the backend transaction remains the final commit fence.


### Revocation error classification

Lease acquisition now preserves the explicit `failed-precondition` result when the per-connection revocation marker is present, rather than flattening it into a generic coordination outage. The existing synthetic lease-service regression asserts this exact code. This is diagnostic/API error classification only; it does not change the fail-closed behavior.


### In-flight revocation race: composed Emulator coverage

Extended `functions/test/mailbox-token-lifecycle-emulator.integration.test.js` with a second scenario. It starts a refresh through the coordinator, waits until the synthetic provider is in flight, activates the Firestore revocation gate through the lease service, and then releases the provider response. The coordinator must fail lease renewal and leave the Secret Manager version pointer on the original credential. The test also attempts a direct vault write with the formerly valid owner/fencing proof and verifies the backend transaction rejects it with a conflict after observing `revocationPending`. The original refresh token and version remain unchanged.

Run this together with the existing lifecycle Emulator scenario using:

```sh
FIRESTORE_EMULATOR_HOST=127.0.0.1:8081 GCLOUD_PROJECT=demo-dsm-mailbox node --test test/mailbox-token-lifecycle-emulator.integration.test.js
```

The test is added but has not been executed in this environment. It uses Firestore Emulator plus synthetic in-memory Secret Manager and provider transports; it is not evidence of live provider cancellation, cloud Secret Manager behavior, production IAM, or callable/worker wiring.


### Cleanup attempt for malformed vault references

Connection setup now makes a best-effort scoped vault-revocation call when secret storage returns a non-empty but invalid/oversized reference. The malformed reference is never written to connection metadata. A synthetic regression verifies cleanup is attempted and no connection record is saved. Cleanup failure is intentionally suppressed at this boundary, so operational vault review may still be required; this does not prove that an arbitrary malformed reference can be revoked by a concrete vault backend.


### Durable credential-cleanup outbox

Credential deletion now has a Firestore-backed retry record under
`accounts/{accountId}/mailboxCredentialCleanup/{connectionId}`. The server adapter
supports idempotent record creation/update, bounded listing of pending tickets,
loading an individual ticket, and monotonic completion. A conflicting secret
reference for the same connection is rejected. Connection setup failure,
malformed non-empty vault references, and ordinary connection revocation record
the ticket before calling the vault; successful deletion completes it, while
failure leaves it pending for later retry. The record contains only the opaque
vault reference and operational metadata, never token material.

Synthetic tests cover persistence, idempotency, conflicting references,
account-scoped pending listing, and a vault outage leaving a pending ticket.
This is an outbox primitive, **not yet a scheduled cleanup worker**: production
must wire a server-only worker that lists pending tickets, retries idempotent
vault deletion with bounded backoff, completes tickets only after confirmed
deletion/not-found, and alerts on exhausted retries. Firestore Rules/IAM must
keep this collection inaccessible to clients. No worker, callable, live Firebase,
or production vault was wired or exercised here.


Cleanup-ticket completion is idempotent as well. This covers the crash window where vault deletion succeeded but saving the final `revoked` connection state failed: a retried revocation can safely repeat the vault delete and completion call before finalizing connection metadata.


### Cleanup retry worker implementation (not scheduled)

Added `functions/src/membership/mailbox-secret-cleanup-worker.js`, a server-only injected worker contract that processes bounded batches of pending tickets, skips tickets whose `nextAttemptAt` is in the future, retries idempotent vault deletion, completes tickets on confirmed success, persists sanitized failure codes and exponential retry timestamps, and alerts after 12 attempts. Backoff is capped at six hours and each batch is limited to 100. No secret reference or raw provider error is sent to alerts.

Firestore adapter now persists `nextAttemptAt` and `lastErrorCode` on new tickets and provides `recordSecretCleanupFailure`, which transactionally rejects stale attempt numbers and conflicting ticket state. Unit tests cover worker success, future-dated deferral, retry schedule, exhaustion/alert, malformed tickets, and retry metadata persistence.

Still outstanding: a scheduled Cloud Tasks/Functions worker and wiring of trusted Firestore/vault adapters, alert provider, IAM/Rules review, and actual Emulator/CI execution. The worker module alone does not run autonomously.


#### Exhausted-ticket handling

Tickets at the retry ceiling (12 attempts) are retained for operator visibility but are no longer eligible for the pending worker query. The adapter marks them `exhausted`, and the worker skips further vault-delete attempts and repeat alerts. A synthetic adapter regression verifies that exhausted tickets remain inspectable but leave the pending queue.


The pending-ticket query now also validates retry metadata before returning work
to the worker: `nextAttemptAt` must be null or a positive safe integer, and
`lastErrorCode` must be null or a bounded machine-code string. Malformed
tickets are excluded from execution rather than treated as due. A synthetic
adapter regression covers invalid scheduling and error-code fields.


#### Cleanup worker adapter composition and account isolation

The cleanup worker now receives the existing Firestore cleanup adapter and
credential-vault adapter directly, rather than independent callback functions.
Each invocation requires an explicit validated `accountId`; the pending query
is scoped to that account, and a ticket whose embedded account does not match
the invocation is skipped before vault access. The worker validates retry
metadata again at its own boundary.

Re-recording an existing cleanup request is now idempotent and does not
increment retry attempts. Only a recorded worker failure advances the counter,
so repeated revocation/setup recovery calls cannot consume the retry budget.
Synthetic tests cover scoped adapter calls, cross-account ticket rejection,
and idempotent ticket re-recording.

This is still a callable worker primitive, not an activated schedule: a trusted
scheduler must enumerate authorized account scopes and invoke bounded runs.
No global account enumeration, scheduled trigger, Cloud Tasks queue, alert
provider, or production adapter wiring is enabled.


#### Pending cleanup queue fairness and exhausted state

The pending cleanup query now orders by `nextAttemptAt` ascending rather than
creation time. New tickets (null retry time) and the earliest due retries are
therefore selected before future-dated retries, preventing a batch of deferred
older tickets from starving newly created cleanup work. When the retry ceiling
is reached, the adapter changes the ticket status to `exhausted`; it remains
available through the single-ticket inspection path but no longer occupies the
pending worker query. Retry updates must advance the attempt counter strictly.
The Firestore query now orders by `status` and `nextAttemptAt`; production
deployment must provision and verify the corresponding composite index. The
new regressions are synthetic tests and have not been executed against the
Emulator.
