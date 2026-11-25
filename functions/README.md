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
- `member` must have site or department scope (department scope preferred for least privilege).
- Inactive, malformed, duplicate scope, mismatched identity/account, and unsupported roles fail closed.
- Nomination, dual approval, bootstrap, revocation workflow, and canonical membership provisioning are not implemented.

## Safety boundaries
- This directory is isolated and is not connected to the operational DSM app.
- No deployment configuration for a real Firebase project is provided.
- No secrets, real users, shifts, or operational data.
- The local emulator Firestore rules deny all client reads/writes.
- Authorization resolution requires a pre-provisioned synthetic membership in the emulator; no self-service role assignment is available.
- The `health` callable is a scaffold smoke check, not a security health assessment.

## Local setup
From this directory:
1. Install Node.js 20.
2. Run `npm install`.
3. Run `npm test`.
4. Emulator start is intentionally local and uses this directory's emulator configuration only: `npm run emulators`.

Do not deploy these functions. Do not connect this scaffold to an existing Firebase project.
