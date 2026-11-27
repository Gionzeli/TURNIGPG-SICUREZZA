# DSM backend verification addendum — 2026-11-27

This addendum supersedes the earlier "next safe sequence" item asking for an Auth + Functions + Firestore end-to-end own-shifts test.

## Verified on commit

- Branch: `codex/employee-shift-date-range-query`
- Commit: `44731217c39d99031b2ed0c105c8e45c940415ea`
- Browser workflow: [run 46058067068](https://github.com/Gionzeli/TURNIGPG-SICUREZZA/actions/runs/46058067068) — success.
- Backend workflow: [run 46058067077](https://github.com/Gionzeli/TURNIGPG-SICUREZZA/actions/runs/46058067077) — failure, 222 passed / 4 failed / 0 skipped.

## New end-to-end test results

Both newly added end-to-end tests passed in the same Auth + Functions + Firestore Emulator job:

- Subtest 31: own employment profile — passed.
- Subtest 58: own shift date-range callable — passed.

The own-shifts test exercises a synthetic verified Firebase identity, reciprocal UID↔Employee binding, canonical department scope and historical placement, date-range filtering, allowlisted shift DTO, rejection of a client-supplied employeeId, rejection of direct create/update/delete callables, and verifies that the stored shift revision/data and audit collection remain unchanged after rejected direct mutations.

These are emulator test results only; they do not prove production readiness or authorize enabling the canonical bridge.

## Remaining backend CI failures

The four failing tests are confined to the frozen mailbox lifecycle lane and are not either of the new employee-profile/own-shifts tests:

1. `mailbox-connection-firestore-adapters.test.js` — malformed cleanup retry metadata rejected.
2. `mailbox-credential-vault.test.js` — parse-time SyntaxError in `mailbox-credential-vault.js`.
3. `mailbox-secret-cleanup-worker.test.js` — retry test expectation mismatch.
4. `mailbox-token-lifecycle-coordinator.test.js` — refresh test expectation mismatch.

The job reports 222 passing and 4 failing tests. Do not describe the backend workflow as green. Do not expand scope into OAuth/mailbox repair unless explicitly reprioritized.

## Next integration blocker

The self-service profile and own-shift backend paths now have Auth-to-callable Emulator coverage. The remaining work is not to enable the bridge immediately. First:
1. Reconcile historical readiness documents with the current implemented state.
2. Inspect the operational page composition and verify the feature flag is the only activation gate (and there are no accidental bootstrap side effects).
3. Review D-02 compensation and D-03 manager/team data schema before adding any API; payroll stays deny-by-default.
4. Define the minimum protected data domain and permission matrix for a read-only preview. Do not expose team/manager data until its delegated authorization exists.
5. Keep real-data migration, Firestore operational synchronization, production auth, and all mailbox automation disabled.

**Release decision: not ready for operational activation.** No merge, no deployment, no feature-flag activation.
