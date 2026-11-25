# DSM Authorization Backend — Isolated Scaffold

**Not production. Emulator-only. Synthetic data only.**

Platform: Firebase Cloud Functions v2, Node.js 20, Firebase Admin SDK.

## Canonical membership prototype
- Canonical membership documents are expected at `accounts/{accountId}/members/{uid}`.
- The caller's `accountId` is only a selector; UID is derived from a verified, revocation-checked Firebase ID token.
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
- Nomination IDs are caller selectors and must be unique.
- No admin bootstrap or nomination cancellation is implemented.

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
From this directory: `npm install`, `npm test`, then emulator via `npm run emulators`.
Do not deploy or connect this scaffold to an existing Firebase project.
