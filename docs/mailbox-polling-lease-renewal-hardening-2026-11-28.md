# Mailbox polling lease-renewal hardening — 2026-11-28

The scheduled polling worker now renews its account/connection-scoped fenced lease before provider fetching, before each message ingestion, after each message ingestion, and before the cursor checkpoint (the last renewal is the post-message renewal). The Firestore adapter delegates renewal to the established lease service using the same owner ID and fencing token.

Renewal results must retain owner and fencing token and contain a safe expiry later than the renewal timestamp. Any renewal failure or malformed/expired proof stops processing and prevents cursor advancement. The original lease is still used for best-effort release because release ownership is keyed by owner and fencing token; the renewed proof is passed to the checkpoint transaction.

This narrows stale-worker windows but is not a continuous heartbeat: a single slow provider or ingestion operation can still exceed the lease TTL. Ingestion must remain idempotent and independently fail closed, and checkpoint transaction still verifies a live lease. No real provider, credentials, or Firebase environment were used. Tests are synthetic and not executed in this environment.


## Emulator integration follow-up (2026-11-28)

The Firestore Emulator integration scenario now processes one synthetic message with one synthetic attachment instead of an empty provider batch. It asserts the ingestion callback receives the message and attachment and that the polling cursor advances only after processing. A companion worker unit test asserts four lease renewals in a single-message batch: before connection/provider work, before fetch, before ingestion, and after ingestion. The test is still emulator-gated; no emulator or CI run was performed in this change.


## Provider batch bounds (2026-11-28)

The polling worker now rejects malformed message objects and attachments arrays larger than the ingestion contract limit (10 per message) before calling ingestion. This prevents a provider adapter from handing an oversized attachment list into the processing path. Synthetic worker tests cover both malformed message objects and excessive attachments; failures do not advance the provider cursor.


## Idempotent recovery contract (2026-11-28)

The ingestion core derives an attachment identity from provider, mailbox connection, provider message ID and SHA-256 of the PDF. The resulting job ID is supplied to proposal creation, and each employee proposal receives the stable key `{jobId}_{employeeId}`. A duplicate completed job is skipped before scanning/parsing; proposal persistence must enforce uniqueness on that stable key.

A remaining integration requirement is durable claim recovery: the injected `claimIngestionJob` implementation must distinguish a completed duplicate from an abandoned/in-progress job and atomically reclaim only jobs whose processing lease expired. It must not report every existing job as a completed duplicate. Proposal creation must be transactionally idempotent on the stable employee key, so a crash after proposal persistence but before job completion can safely resume. No concrete Firestore job/proposal adapter is wired yet; this behavior is a required contract, not a claim of completed integration.


## Firestore ingestion job claims

Added `createEmployeeScheduleIngestionJobFirestoreAdapter` for durable attachment-job claims. The job document is scoped to the account and keyed by the SHA-256 idempotency key. A live processing lease and terminal job are treated as duplicates; an expired processing lease is reclaimed transactionally with a new random lease token and incremented fencing token. Completion requires the current lease token and a still-live lease; stale workers cannot finish a reclaimed job. Terminal completion is idempotent for the same result.

The ingestion core now requires the lease token/fencing token from active claims, passes them into employee proposal persistence, and supplies the token for every terminal job transition. The proposal persistence adapter must atomically enforce uniqueness on `{jobId}_{employeeId}` and reject stale fencing tokens in the same transaction as proposal creation. That proposal adapter and production wiring are still outstanding; until they exist, this is a durable job-claim adapter plus an explicit fencing contract, not end-to-end exactly-once delivery.


### Job adapter consistency hardening

The job adapter now uses the same injected document-reference factory for both claim and completion, so custom account-scoped storage paths cannot strand a claimed job in `processing`. Initial lease expiry is checked for safe-integer overflow before any Firestore write, and existing records must have `jobId` equal to the idempotency key. Synthetic regression cases cover custom references and unsafe initial expiry. These tests have been added but were not executed here.


## Fenced Firestore proposal persistence

Added `createEmployeeScheduleProposalFirestoreAdapter`. It derives a deterministic proposal document ID from `{jobId}_{employeeId}`, and in one Firestore transaction reads the durable ingestion job, account and existing proposal before writing. It requires the exact current processing lease token and fencing token, a live lease, matching attachment/job identity, an active account, and a canonical Employee UID↔Employee authorization callback. The proposal is immutable with respect to the idempotency identity and parsed changes; a retry returns the existing proposal instead of creating another. A conflicting payload under the same idempotency key fails closed.

Synthetic tests cover creation, replay, stale fencing, expired lease, inactive Employee binding and conflicting replay. The adapter is a standalone dependency and is not yet wired to a production callable, provider, or scheduled composition. The caller must inject an authorization callback that reads canonical membership and reciprocal Employee binding through the same transaction. This closes the durable proposal persistence contract in code, but does not constitute end-to-end exactly-once processing or production readiness.
