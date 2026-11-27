# DSM activation-gate verification — 2026-11-27

## Scope and finding

On branch `codex/employee-shift-date-range-query`, commit `4dc10ef436bff0cb0f4b84c8ef8d5ef8a5dfa390`, inspected the operational `index.html`, `firebase-config.js`, `src/ui/legacy-migration-page.js`, and `src/ui/dsm-canonical-account-bootstrap.js`.

- `index.html` loads `src/ui/legacy-migration-page.js`, which mounts a local, read-only backup preview.
- The migration page creates the canonical account and invite roots, but leaves them informational and without controls when `window.TURNI_DSM_CANONICAL_AUTH_ENABLED !== true`.
- The Firebase canonical bootstrap is dynamically imported only inside the explicit `=== true` branch.
- `firebase-config.js` does not set `TURNI_DSM_CANONICAL_AUTH_ENABLED`.
- The migration preview fixture has a restrictive CSP with `connect-src 'none'`; the default-disabled path does not request remote resources.

## Regression test added

The Playwright runner now asserts in the default-disabled fixture that:
- the canonical flag is not enabled;
- the account bridge shows its disabled state;
- the membership invite area shows its disabled state;
- neither area exposes interactive controls;
- the page completes its local-only preview/reset flow without external requests.

## CI evidence

[DSM Core browser workflow run 46058432633](https://github.com/Gionzeli/TURNIGPG-SICUREZZA/actions/runs/46058432633) completed successfully on the exact commit above.

## Boundary

This verifies the current default-disabled UI path only. It is not approval to set the flag true, does not prove production Firebase security, and does not authorize merge, deployment, real-data migration, or synchronization.
