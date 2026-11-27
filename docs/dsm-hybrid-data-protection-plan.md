# DSM hybrid data protection plan

**Status:** implementation guardrails approved for isolated development; not a production security certification.
**Decision recorded:** hybrid DSM — Firestore is the intended canonical cloud store for approved Employee domains; the web app may use a restricted local working layer for offline continuity.
**Scope:** synthetic-only development on `codex/employee-shift-date-range-query`.
**Explicit exclusions:** production Firebase projects, real collaborator data, credentials, live synchronization, operational UI wiring, migration, merge to `main`, and deployment.

## 1. Non-negotiable protection goals

Collaborator data must remain confidential, correctly attributed, tenant-isolated, and recoverable. A feature is not ready merely because it works in a browser or emulator.

- Fail closed when identity, membership, binding, lifecycle state, scope, permission, or revision is missing, stale, malformed, or inconsistent.
- Derive actor UID only from a server-verified Firebase ID token with revocation checking. Never trust a UID, role, employee ID, owner, account, site, department, permission, or timestamp supplied by the browser as proof.
- Resolve canonical membership, employee binding, target resource, and current lifecycle state server-side for every protected operation.
- Enforce tenant, individual ownership, organizational scope, domain permission, and field-level visibility as separate checks.
- Use server-side query constraints before returning data; do not fetch broad collections and filter them in the client.
- Return explicit allowlisted DTOs, never whole Firestore documents.
- Mutations require expected revisions, bounded inputs, idempotency where appropriate, and server-generated audit events. Sensitive values must not be copied into logs or audit payloads.

## 2. Cloud and local responsibilities

### Cloud canonical store

Firestore is the intended canonical store for approved Employee records, account membership, employee bindings, placements, shifts, absences, and separately protected payroll records. Backend Functions using Admin SDK are the only permitted access path for protected Employee data in this phase.

Firestore Admin SDK bypasses Firestore Security Rules. Therefore, Rules are an additional client boundary, not a substitute for authorization in every callable. New protected paths must remain denied to direct client access until their Rules and emulator tests are explicitly reviewed.

### Local working layer

The existing web app's LocalStorage/IndexedDB data is not automatically trusted, uploaded, merged, or promoted to canonical cloud data.

- Preserve current local behavior until a separately approved migration plan exists.
- Do not silently synchronize legacy records or infer employee ownership from local account partitions, names, labels, or IDs.
- Offline access is limited to a future, explicitly approved minimum dataset.
- Do not cache payroll, bank/payment details, identity documents, health-related absence reasons, tokens, or other high-sensitivity material for offline use.
- Any future offline mutation must be queued as untrusted intent, re-authorized by the server at sync time, checked against current revisions and lifecycle, and rejected visibly on conflict. A local success indicator must not imply a cloud commit.
- Logout, account switch, binding revocation, or session expiry must abort pending work and clear account-scoped in-memory views and any approved local cache. Cache deletion must not be treated as secure erasure from device backups or browser storage.

## 3. Data classification and default visibility

| Domain | Default handling | Required boundary |
|---|---|---|
| Employee identity and ordinary profile | Cloud canonical; local display only when explicitly authorized | Verified employee binding or separately approved delegated permission; minimal DTO |
| Shifts | Cloud canonical; limited offline view only after approval | Self ownership or explicit schedule permission plus current organizational scope |
| Absences | Cloud canonical; minimize local and manager projections | Own-record permission; manager view should expose availability/date only unless a separately approved need requires more |
| Health-related absence details | Highly sensitive; no general team view or offline cache | Separate explicit permission and privacy review; default deny |
| Compensation/payroll and deductions | Separate cloud domain; no ordinary profile response | Explicit payroll permission per action and field; default deny; no offline cache |
| Audit/security events | Server-generated cloud records | Bounded audit-read permission; no secrets or sensitive payload values |
| Exports/backups | Not enabled by this plan | Separate approval, domain/scope checks, retention, encryption, access logging, and restore tests |

No role, including account administrator, inherits payroll or health-detail visibility solely from its organizational scope.

## 4. Authentication, authorization, and revocation

Every protected endpoint must:

1. Verify the Firebase ID token server-side and check revocation.
2. Load the active canonical account and membership from trusted storage.
3. Resolve the UID-to-Employee binding from backend-owned records where individual ownership is required; verify both directions and matching revisions/status.
4. Load the target Employee and current/historical placement appropriate to the record date.
5. Require active lifecycle state for the account and applicable resources; missing or unknown state denies.
6. Evaluate the exact domain/action/field permission independently of role labels and organizational scope.
7. Enforce ownership or delegated access explicitly.
8. Validate payload allowlists, expected revision, limits, and idempotency.
9. Commit mutation and required audit atomically where supported.
10. Return only the approved response DTO.

Do not reuse a cached browser principal or prior authorization decision as a capability. Revocation, suspension, expiry, reassignment, and account/site/department lifecycle changes must take effect on the next protected operation.

## 5. Storage and transport safeguards

- Use HTTPS/TLS for all network communication; never place credentials or ID tokens in URLs, logs, analytics, or persisted application records.
- Keep Firebase Admin credentials and secrets exclusively in managed server-side configuration; never ship them in the web bundle.
- Keep Firestore client direct reads/writes for protected Employee paths denied by default.
- Review Firebase project IAM with least privilege before any real environment is considered.
- Confirm provider encryption-at-rest configuration, backup encryption, retention, key ownership/rotation, and recovery procedures before production use; this document does not claim those controls have been verified.
- Apply CSP, output encoding, dependency review, and XSS protections before exposing collaborator data to browser views.
- Avoid logging profile values, compensation, absence categories/reasons, tokens, or document contents. Errors shown to clients must not reveal whether another tenant's record exists.

## 6. Required synthetic tests before any preview integration

- Cross-account reads/writes and guessed IDs deny without existence leakage.
- Employee A cannot read or mutate Employee B records, even in the same site/department.
- Missing, revoked, duplicate, conflicting, stale, suspended, expired, or reassigned bindings deny.
- Expired/revoked membership and inactive account/site/department/Employee deny.
- Profile DTOs never contain payroll fields without explicit payroll permission.
- Manager absence projections do not expose absence kind, medical reason, notes, or attachments.
- Payroll and health-related data are absent from offline caches, logs, notifications, generic search, and exports.
- Direct client Firestore access to protected paths is denied by Rules Emulator tests.
- Query filters and pagination cannot widen tenant or organizational scope.
- Revocation and account switching abort pending async reads/writes and prevent stale results from rendering.
- Offline queued writes are re-authorized at sync time and conflicts do not overwrite newer canonical data.
- Backup/restore, retention/deletion, incident response, and audit access have documented owners and tested procedures before production.

Tests must use deterministic synthetic identities and records only. A skipped emulator test is not a passing test.

## 7. Delivery sequence and release gates

1. Review and approve the identity/binding model, canonical schema, lifecycle vocabulary, and role × domain × action × field permission matrix.
2. Implement and test shared server-side authorization helpers and canonical loaders.
3. Implement one protected domain endpoint at a time, beginning with the least-sensitive profile projection; keep payroll and health details denied.
4. Add protected absence endpoints only after data minimization and visibility policy are approved.
5. Build a non-operational read-only preview using synthetic fixtures and a dedicated test database name.
6. Verify existing web app regression behavior and offline semantics without connecting legacy data.
7. Complete independent security/privacy review, IAM and Rules review, backup/restore and retention plan, and explicit user approval.
8. Only then propose a separately reviewed migration and operational integration.

No step in this plan authorizes live data access, real-data migration, production synchronization, merge, or deployment.
