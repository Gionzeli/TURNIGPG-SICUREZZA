# DSM Authorization Backend — Isolated Scaffold

**Not production. Emulator-only. Synthetic data only.**

Platform: Firebase Cloud Functions v2, Node.js 20, Firebase Admin SDK.

## Safety boundaries
- This directory is isolated and is not connected to the operational DSM app.
- No deployment configuration for a real Firebase project is provided.
- No secrets, real users, shifts, or operational data.
- The local emulator Firestore rules deny all client reads/writes.
- Authorization resolution intentionally fails closed until membership logic is designed and separately implemented.
- The `health` callable is a scaffold smoke check, not a security health assessment.

## Local setup
From this directory:
1. Install Node.js 20.
2. Run `npm install`.
3. Run `npm test`.
4. Emulator start is intentionally local and uses this directory's emulator configuration only: `npm run emulators`.

Do not deploy these functions. Do not connect this scaffold to an existing Firebase project.

## Next work (separate review)
Design canonical membership schema and backend authorization rules; then implement nomination/approval/bootstrap, audit, concurrency-safe transactions, and negative emulator tests in reviewed stages.
