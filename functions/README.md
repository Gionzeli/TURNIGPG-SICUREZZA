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
- Proposer, approver, and proposer-cancellation require a Firebase-verified identity with `auth_time` no more than 5 minutes old and a verified `firebase.sign_in_second_factor` of `phone` or `totp`; missing, unknown, future, or stale claims fail closed.
- The Firebase ID token verifier supplies these claims only after signature and revocation checks; token refresh alone does not renew `auth_time`.
- The nomination service functions are internal server modules, not callable endpoints. Any future callable must extract the bearer token, invoke `verifyIdentity(token, getAuth().verifyIdToken)` with revocation checking, and pass that returned frozen identity to the service. Never pass `request.data.actorIdentity`, client-provided claims, or a client-selected `actorUid`; `actorUid` must equal the verified identity UID. Do not expose these operations until that trusted wrapper and endpoint-specific authorization tests exist.
- Nomination IDs are caller selectors and must be unique.
- Only the original proposing admin, while still an active canonical admin, may cancel their pending nomination.
- Cancellation requires a trimmed 1–500 character reason; do not put personal or sensitive data in the reason.
- Cancellation status and its audit event are written in one Firestore transaction; audit event IDs are caller-supplied unique selectors.
- No admin bootstrap is implemented.

## Membership revocation prototype
- Only a canonical active account admin can revoke a canonical active membership.
- Revocation and an append-only-by-service audit event are written in the same Firestore transaction.
- Audit event IDs are caller-supplied idempotency selectors; duplicates are rejected.
- The last canonical active account admin cannot be revoked. Malformed admin documents do not count.
- This is not an immutable audit ledger: privileged server code can still alter Firestore documents.
- The service is not yet exposed as a callable endpoint and is not production-ready.

## Safety boundaries
- This directory is isolated and not connected to the operational DSM app.
- No real Firebase project deployment config, secrets, users, shifts, or operational data.
- Emulator Firestore rules deny all client reads/writes.
- Canonical membership provisioning is not available except via the prototype approval flow.
- Health endpoint is a smoke check only, not a security health assessment.

## Local setup
From this directory: `npm install`, then start all isolated emulators with `npm run emulators`.
In a second terminal, set `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099`, `FIRESTORE_EMULATOR_HOST=127.0.0.1:8081`, and `DSM_FUNCTIONS_EMULATOR_HOST=127.0.0.1:5001` before running `npm test`. Without these three variables, the Auth/Callable integration test is skipped.
Do not deploy or connect this scaffold to an existing Firebase project.
