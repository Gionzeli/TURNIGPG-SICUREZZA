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

A remaining integration requirement is durable claim recovery: the injected `claimIngestionJob` implementation must distinguish a completed duplicate from an abandoned/in-progress job and atomically reclaim only jobs whose processing lease expired. It must not report every existing job as a completed duplicate. Proposal creation must be transactionally idempotent on the stable employee key, so a crash after proposal persistence but before job completion can safely resume. Concrete Firestore job and proposal adapters have since been added and are composed by the persistence helper below; provider and end-to-end integration remain outstanding.


## Firestore ingestion job claims

Added `createEmployeeScheduleIngestionJobFirestoreAdapter` for durable attachment-job claims. The job document is scoped to the account and keyed by the SHA-256 idempotency key. A live processing lease and terminal job are treated as duplicates; an expired processing lease is reclaimed transactionally with a new random lease token and incremented fencing token. Completion requires the current lease token and a still-live lease; stale workers cannot finish a reclaimed job. Terminal completion is idempotent for the same result.

The ingestion core now requires the lease token/fencing token from active claims, passes them into employee proposal persistence, and supplies the token for every terminal job transition. The proposal persistence adapter must atomically enforce uniqueness on `{jobId}_{employeeId}` and reject stale fencing tokens in the same transaction as proposal creation. That proposal adapter and production wiring are still outstanding; until they exist, this is a durable job-claim adapter plus an explicit fencing contract, not end-to-end exactly-once delivery.


### Job adapter consistency hardening

The job adapter now uses the same injected document-reference factory for both claim and completion, so custom account-scoped storage paths cannot strand a claimed job in `processing`. Initial lease expiry is checked for safe-integer overflow before any Firestore write, and existing records must have `jobId` equal to the idempotency key. Synthetic regression cases cover custom references and unsafe initial expiry. These tests have been added but were not executed here.


## Fenced Firestore proposal persistence

Added `createEmployeeScheduleProposalFirestoreAdapter`. It derives a deterministic proposal document ID from `{jobId}_{employeeId}`, and in one Firestore transaction reads the durable ingestion job, account and existing proposal before writing. It requires the exact current processing lease token and fencing token, a live lease, matching attachment/job identity, an active account, and a canonical Employee UID↔Employee authorization callback. The proposal is immutable with respect to the idempotency identity and parsed changes; a retry returns the existing proposal instead of creating another. A conflicting payload under the same idempotency key fails closed.

Synthetic tests cover creation, replay, stale fencing, expired lease, inactive Employee binding and conflicting replay. The adapter is a standalone dependency and is not yet wired to a production callable, provider, or scheduled composition. The caller must inject an authorization callback that reads canonical membership and reciprocal Employee binding through the same transaction. This closes the durable proposal persistence contract in code, but does not constitute end-to-end exactly-once processing or production readiness.

The proposal adapter also validates calendar dates, shift types, time intervals, numeric hours, boolean flags and allowlisted fields before entering the Firestore transaction. Invalid parsed rows are rejected before any proposal write.

A final validation pass aligned proposal validation with the existing employee shift service: partial updates to one side of a time interval are allowed (the other side remains unchanged), while newly created shifts require a complete start/end pair. Before snapshots must match the operation's expected revision, create operations require a null before snapshot, and duplicate shift targets or extra operation fields are rejected. This avoids rejecting ordinary one-field time corrections while preserving immutable-date and revision safeguards.

## Firestore persistence composition

Added `employee-schedule-email-ingestion-firestore-persistence.js` as a narrow composition helper for the existing ingestion core. It combines the durable job claim/finish adapter with the fenced proposal adapter and supplies employee authorization through `createEmployeeShiftFirestoreAuthorization` in the same Firestore transaction. The canonical authorization result now explicitly exposes `status: "active"` only after validating the account, membership permissions, reciprocal UID↔Employee bindings, Employee record and control record.

The helper only constructs dependencies; it performs no Firestore reads/writes at construction and does not activate the mailbox polling composition, provider adapters, scheduled handler, Firebase trigger or callable. Callers must still inject the remaining ingestion dependencies (mailbox verification, malware scan, PDF extraction, employee resolution and existing-shift loading). This is persistence wiring, not a production-ready provider integration.


### Terminal completion replay correction

A review found that terminal job completion clears the lease token, while the completion method originally checked that token before recognizing an already-terminal job. That made a repeated completion fail instead of returning the intended idempotent result. The adapter now validates account/job identity first, returns a duplicate result only when the requested terminal status matches, and still requires the live lease token for any transition from `processing`. A regression test also verifies that a different terminal result is rejected.


### Composed ingestion persistence regression coverage

The synthetic persistence test now exercises the composed Firestore boundary end to end with an in-memory transaction store: it claims an account-scoped ingestion job, validates the canonical active membership and reciprocal UID-to-Employee binding, creates a pending employee proposal, and marks the job terminal. A negative case confirms that a UID cannot create a proposal for a different Employee ID. This is a deterministic fake-store test, not a Firebase Emulator execution; production provider, parser, scheduler and callable wiring remain disabled.


### Firestore Emulator integration coverage for job/proposal persistence

Added a separate Emulator-gated integration test for the composed persistence boundary. When `FIRESTORE_EMULATOR_HOST` is configured, it seeds a synthetic active account, member, reciprocal UID↔Employee bindings, Employee control and placement; then claims a fenced ingestion job, creates a pending proposal, and completes the job using the Firebase Admin SDK against the Emulator. Test documents are cleaned up in `finally`. The test skips when the Emulator is unavailable. It does not authenticate with a real provider, access a real mailbox, or contact production Firebase/Google Cloud.


### Proposal recovery after ingestion lease reclamation

Added a regression case for the crash window where a worker has committed an employee proposal but fails before finishing the ingestion job. After the job lease is reclaimed, the stale lease token is rejected; the new fenced worker can submit the same immutable proposal payload and receives the existing proposal as an idempotent duplicate, without creating a second document. The test also confirms the proposal count remains unchanged. This is synthetic adapter coverage; execution is still pending.


### Preserve proposal decisions during ingestion recovery

The ingestion result now preserves the persisted proposal status (`pending`, `approved`, `rejected`, or `superseded`) returned by the idempotent Firestore proposal adapter. A recovered worker no longer reports an already-approved/rejected proposal as pending. The attachment job remains classified as `proposals_created` whenever at least one proposal exists, even if its decision changed while the worker was recovering. Synthetic regression coverage verifies the approved case.


### Multi-employee partial recognition and match-key validation

Added synthetic coverage for a shared-mailbox PDF containing one resolvable employee document and one unknown employee document. Only the verified employee receives a proposal; the job is marked `partially_processed` and the unknown document is reported as blocked. Employee match keys supplied by extraction are now rejected when blank or containing control characters, rather than silently treated as absent; this prevents malformed identifiers from reaching the employee resolver. No PDF omission is interpreted as a deletion. These checks do not replace a real parser's accuracy assessment or production provider integration.


### PDF shift columns versus optional information (2026-11-28)

The ingestion contract now keeps calendar changes separate from optional document notes. The parser may return a document-level `additionalInfo` array for the employee's information view (ℹ️); it is normalized to at most 8 plain-text entries, 300 characters each and 1,500 characters total, with control characters removed/rejected. This field is persisted on the employee proposal and participates in idempotency, but is never copied into shift create/update fields. Calendar diffs continue to contain only structured shift data; optional notes do not change a shift. Synthetic tests cover separation, limits and idempotency. The employee proposal DTO now exposes only bounded/sanitized `additionalInfo`, and the DSM proposal panel renders it behind an ℹ️ Informazioni button. Proposal change summaries show only date, postazione and start/end time; other shift metadata is not printed as PDF-derived detail. The real PDF parser still needs to map the source document's separate notes area into `additionalInfo`.


The ingestion normalizer now accepts date context, postazione and start/end time from each parsed shift row. The shift type is assigned the standard `turno` value rather than extracted from another PDF column. Duration is calculated from the time interval (including overnight shifts), never trusted from a PDF-supplied hours field. Parsed flags and unrelated columns are rejected. This keeps calendar proposals limited to the time/postazione columns while preserving separate document notes for the ℹ️ view.


The employee calendar table has also been simplified to show only date, postazione, start time and end time, plus the optional ℹ️ control. Type and total-hours columns are no longer displayed in the employee-facing calendar. A Firestore Emulator integration assertion now checks that bounded additional notes survive employee approval, are stored separately as `scheduleInfo`, and are returned by the employee's own calendar query; malformed note text is filtered from the DTO. The test is emulator-gated and has not been run in this work session.


## PDF schedule column mapper (2026-11-28)

Added `functions/src/membership/employee-schedule-pdf-column-mapper.js` as a strict adapter between an injected PDF table/OCR engine and the existing email-ingestion contract.

- Recognizes date/date context, postazione, either one combined time-range column or paired start/end columns, and optional info/note text.
- Ignores unrelated columns such as hours totals, task descriptions and flags; emits only date, post and start/end in each calendar shift.
- Additional info is returned separately as document-level `additionalInfo`, bounded to eight items and 300 characters per item.
- Handles Italian date strings and continuation rows using the document date context; malformed explicit dates, ambiguous column layouts, unreadable time ranges, malformed rows and excessive row counts fail closed.
- The adapter accepts an injected `extractPdfTables` engine and returns the `documents` structure expected by `createEmployeeScheduleEmailIngestion({ extractSchedule })`.

Important limitation: this does **not** implement PDF text extraction, OCR, handwriting recognition or layout detection. No PDF/OCR dependency is currently installed in the Functions package, and no real parser/provider is wired or enabled. The adapter is ready to wrap a separately selected and tested extraction engine; until then the actual PDF-reading integration remains incomplete. Synthetic unit tests have been added but were not executed in this session.


## PDF attachment integrity gate (2026-11-28)

The structured column mapper now validates the raw attachment before invoking an injected PDF/table extraction engine:

- requires the PDF file signature `%PDF-`;
- enforces the existing 10 MiB attachment ceiling;
- bounds and validates the filename and SHA-256 syntax;
- recomputes SHA-256 from the exact bytes and rejects mismatches before the engine is called;
- passes only the validated bytes, filename and verified digest to the injected extractor.

This is an integrity gate, not a PDF parser or OCR implementation. A separately selected extraction engine and its deployment/runtime wiring are still required. Synthetic tests cover signature and digest rejection; no real PDFs, external provider credentials or production services are used.
