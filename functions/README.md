# DSM Authorization Backend — Isolated Scaffold

**Not production. Emulator-only. Synthetic data only.**

Platform: Firebase Cloud Functions v2, Node.js 20, Firebase Admin SDK.

## Canonical membership prototype
- Canonical membership documents are expected at `accounts/{accountId}/members/{uid}`.
- The caller's `accountId` is only a selector; UID is derived from a verified, revocation-checked Firebase ID token.
- Unit tests assert that the trusted verifier receives `checkRevoked=true` and rejects a synthetic revocation error.
- The Auth + Functions + Firestore Emulator integration test creates a synthetic Auth user, calls the callable with its ID token, verifies server-derived membership, revokes refresh tokens, and asserts the same ID token is rejected. This test runs only when all three emulator host variables are explicitly set; otherwise it is skipped.
- Emulator behavior is not a substitute for production Firebase project validation or an independent security review.
- The server derives role permissions. Client-supplied permissions are ignored.
- Allowed roles: `member`, `manager`, `admin`.
- `admin` must have account scope and no scope IDs.
- `manager` must have one or more site IDs; permissions include management of departments within assigned sites.
- `member` must have site or department scope.
- Inactive, malformed, duplicate scope, mismatched identity/account, and unsupported roles fail closed.

## Admin nomination workflow (prototype only)
- Only a canonical active account admin can nominate a membership.
- Nomination is pending and grants no privileges until approved.
- A second distinct active admin must approve.
- Approval and target membership activation occur in one Firestore transaction.
- Target active membership already present is rejected; no implicit role replacement.
- Nomination lifetime is fixed by the trusted service clock at 24 hours; callers cannot choose or extend the expiry. Approval revalidates the stored creation and expiry timestamps and rejects legacy, malformed, future-created, expired, or overlong records.
- Proposer, approver, and proposer-cancellation require a Firebase-verified identity with `auth_time` no more than 5 minutes old and a verified `firebase.sign_in_second_factor === "totp"`; phone/SMS, missing, unknown, future, or stale claims fail closed.
- The Firebase ID token verifier supplies these claims only after signature and revocation checks; token refresh alone does not renew `auth_time`.
- The nomination service functions are internal server modules, not callable endpoints. Any future callable must extract the bearer token, invoke `verifyIdentity(token, getAuth().verifyIdToken)` with revocation checking, and pass that returned frozen identity to the service. Never pass `request.data.actorIdentity`, client-provided claims, or a client-selected `actorUid`; `actorUid` must equal the verified identity UID. Do not expose these operations until that trusted wrapper and endpoint-specific authorization tests exist.
- Nomination IDs are caller selectors and must be unique.
- Only the original proposing admin, while still an active canonical admin, may cancel their pending nomination.
- Cancellation requires a trimmed 1–500 character reason; do not put personal or sensitive data in the reason.
- Cancellation status and its audit event are written in one Firestore transaction; audit event IDs are caller-supplied unique selectors and duplicates are rejected. This is not idempotent replay: retrying a completed cancellation does not return its original result.
- No admin bootstrap is implemented.

## Membership revocation prototype
- Only a canonical active account admin can revoke a canonical active membership.
- Revocation and an append-only-by-service audit event are written in the same Firestore transaction.
- Audit event IDs are caller-supplied unique selectors; duplicates are rejected. This is not idempotent replay: retrying a completed revocation does not return its original result.
- The last canonical active account admin cannot be revoked. Malformed admin documents do not count.
- This is not an immutable audit ledger: privileged server code can still alter Firestore documents.
- The service is not yet exposed as a callable endpoint and is not production-ready.

## Safety boundaries
- This directory is isolated and not connected to the operational DSM app.
- No real Firebase project deployment config, secrets, users, shifts, or operational data.
- Emulator Firestore rules deny all client reads/writes.
- Canonical membership provisioning is not available except via the prototype approval flow.
- Health endpoint is a smoke check only, not a security health assessment.

## Trusted callable boundary helper (not exposed)
- `src/membership/nomination-callable-handlers.js` defines a server-only handler factory for create/approve/cancel. It extracts a bearer token, calls the shared `verifyIdentity` verifier (which invokes the injected Firebase Admin verifier with `checkRevoked=true`), and derives both `actorUid` and `actorIdentity` from that verified result.
- The handler deliberately ignores caller-supplied `actorUid` and `actorIdentity` fields. Only operation selectors and nomination fields are read from callable data.
- This is a tested trust-boundary helper, **not a deployed callable**: it is not imported or exported by `src/index.js`. Before exposure, each callable still needs a thin `onCall` adapter, consistent Firebase `HttpsError` mapping, emulator tests for success/denial/revocation/MFA/transaction behavior, and review of rate limits and abuse controls.

## Local setup
From this directory: `npm install`, then start all isolated emulators with `npm run emulators`.
In a second terminal, set `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099`, `FIRESTORE_EMULATOR_HOST=127.0.0.1:8081`, and `DSM_FUNCTIONS_EMULATOR_HOST=127.0.0.1:5001` before running `npm test`. Without these three variables, the Auth/Callable integration test is skipped.
Do not deploy or connect this scaffold to an existing Firebase project.


## Employee canonical storage decision (2026-11-26)
- Firestore is selected for the isolated Employee backend prototype; see `docs/dsm-employee-firestore-decision.md` for the physical model and transaction invariants.
- Canonical Employee paths are tenant-scoped under `accounts/{accountId}`; binding uses mirrored UID and Employee reservation documents in a single Firestore transaction.
- `profileId` in the existing policy contract maps explicitly to canonical `employeeId`.
- This selection authorizes implementation and Emulator tests only. Do not connect this scaffold to a real Firebase project, deploy, import real data, or wire the operational UI.


## Employee Firestore loader (Emulator-only validation)
- `src/membership/employee-firestore-loaders.js` reads both canonical binding reservation documents and rejects missing/inconsistent mirrors.
- The Employee loader checks account ownership and active lifecycle; the legacy `profileId` contract maps to canonical `employeeId`.
- The Firestore Emulator integration test covers valid resolution, inconsistent reverse binding, suspended Employee, and revoked binding.
- This is a server-side loader module, not a callable endpoint. It must be invoked only after token verification and canonical membership resolution. Admin SDK bypasses Rules; the calling endpoint remains responsible for all authorization.


## Manual Employee provisioning service (internal, Emulator-tested)
- `src/membership/employee-provisioning-service.js` implements proposal and distinct-admin approval.
- Approval requires a verified recent TOTP identity, active account, active proposer and target member; Employee creation, mirrored UID/Employee reservations, proposal transition and audit are atomic.
- Duplicate Employee/UID reservations deny; no silent overwrite or rebinding.
- The service is not yet exposed as a callable. Emulator tests use synthetic verified-identity fixtures and do not establish real Firebase TOTP assurance.


## Employee provisioning callable endpoints
- `proposeEmployeeProvisioning` and `approveEmployeeProvisioning` are callable endpoints backed by revocation-checked Firebase ID token verification.
- Actor UID, verified-email state, auth time and second-factor claim are derived from the verified token; client-supplied actor fields are ignored.
- Service authorization still requires active canonical admin membership, recent TOTP claim, distinct proposer/approver and the Firestore transaction invariants.
- Unit tests exercise the callable composition boundary with synthetic verifier claims. They do not prove that a deployed Firebase Auth tenant issues/validates TOTP claims as expected. Do not deploy or treat real MFA assurance as verified until that integration is independently validated in an approved non-production Firebase project.


## Employee binding revocation
- The revoke callable requires a revocation-checked identity token, recent TOTP claim and active canonical account admin.
- It verifies Employee and both UID/Employee reservation mirrors against the serialized control revision, then revokes both mirrors, increments the binding revision and appends audit in one transaction.
- Rebinding remains a separate two-person proposal/approval flow; revoked reservations are not overwritten.
- TOTP assurance still requires validation against an approved non-production Firebase Auth configuration before deployment.

- Emulator integration test covers two-person provisioning followed by audited, mirrored binding revocation and revision increment.


## Employee placements (internal transaction service)
- Initial placement and transfer use Employee-scoped Firestore history and the serialized employeeControl placement revision.
- Intervals are half-open [validFrom, validUntil); overlap, ambiguous transfer boundary, missing lifecycle, stale/malformed control and excessive history fail closed.
- Transfers close the prior interval and create the next placement with audit in one transaction.
- Trusted organization and actor authorization loaders are injected and must read canonical records inside the same transaction. No callable is exposed until the organization document paths and actor permission contract are explicitly implemented.
- Emulator tests use synthetic loaders and do not validate real organizational authorization.


## Employee shift transaction service (internal)
- `employee-shift-service.js` writes Employee shifts only to `accounts/{accountId}/employeeShifts/{shiftId}`.
- Employee ID and placement/site/department context are derived from trusted server callbacks, never from shift payload fields.
- Create, update and delete are distinct authorization operations; update/delete require optimistic revision checks. Delete is a soft-delete preserving the historical record and audit trail.
- Shift date is immutable in this service; moving a shift date requires a separate approved workflow so historical placement context cannot be silently rewritten.
- The injected authorization callback MUST verify the revocation-checked actor, canonical membership, active Employee binding for self-service OR exact manager delegation and `shift:<operation>` permission, lifecycle and historical scope inside the supplied transaction. The placement loader must return exactly one placement valid on the shift date.
- No callable endpoint is exposed: canonical delegation document paths and a trusted authorization adapter must be implemented and tested before exposure. Emulator test uses synthetic callbacks and validates persistence/revision/audit only, not real permission enforcement.


## Employee absence availability (internal, privacy-minimized)
- Manager availability service exposes only `unavailable`, `startDate`, `endDate` for each authorized interval. It never returns absence category, reason, notes, documents or raw Firestore records.
- The injected authorization adapter must validate active account/member, explicit `absence:read:availability` permission and each placement/delegation scope overlapping the requested date range; only its returned placement IDs are visible.
- Audit records contain actor, employee, requested date range and interval count only; no absence category or medical data.
- No callable is exposed until the canonical manager/delegation authorization adapter is implemented. Emulator coverage uses synthetic authorization callbacks and does not establish real manager access control.
