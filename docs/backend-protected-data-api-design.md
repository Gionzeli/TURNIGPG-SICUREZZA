# Design proposal — protected DSM data API (non-operational)

**Status:** proposal only; not implemented or approved for production.
**Scope:** isolated Firebase Functions backend under `functions/`. This document does not authorize changes to the operational Firebase runtime, root Firestore rules, UI, or production composition root.

## 1. Security objective

Every DSM data operation must be authorized on the server at the time it executes. A previously returned principal, browser session flag, account selector, IndexedDB record, or client-supplied role is not sufficient authority.

The browser is an untrusted caller. Treat all request data, including document IDs, scope IDs, revisions, filters, and claimed ownership, as attacker-controlled.

## 2. Trust boundary and request pipeline

For each callable operation:

1. Require a Firebase ID token in the callable request context and verify it with Firebase Admin using revocation checking.
2. Require the verified identity's email policy to match the product's explicit account policy (the current isolated scaffold requires verified email).
3. Parse a strict, versioned request schema; reject unknown fields, malformed IDs, oversized payloads, invalid revisions, and unsupported operation names.
4. Read canonical membership from the server-owned path `accounts/{accountId}/members/{verifiedUid}`. The account ID is only a selector.
5. Validate active status, role, scope type, and scope IDs using the canonical membership policy. Ignore or reject client-provided `uid`, `role`, `permissions`, `scopeType`, and `scopeIds`.
6. Derive permission and resource scope on the server, then authorize the specific action and target resource.
7. Perform the read/write with Admin SDK only after authorization. Apply account and scope predicates inside the server query/transaction, not as a post-filter on returned data.
8. For mutations, validate the full DTO, enforce optimistic revision / idempotency rules, and write the domain change and server audit event atomically where the datastore supports it.
9. Return a minimal DTO; never return membership internals, tokens, secrets, or unrestricted Firestore documents.

Authorization must be repeated for every operation. Do not treat the five-minute response expiry from `resolveAuthorization` as a reusable backend capability.

## 3. Initial operation matrix

This is a candidate minimum surface, not an implementation contract. Final field-level permissions require product-owner approval.

| Resource/action | Candidate permission | Mandatory server checks |
| --- | --- | --- |
| Read profile / shifts / absences | `dsm:read:own-scope`, `dsm:read:site`, or `dsm:read:account` | Account equality; resource site/department belongs to membership scope; member may read only explicitly assigned own-scope records |
| Create/update/delete scoped records | `dsm:manage:site` or `dsm:manage:account` | Scope containment; strict DTO allowlist; expected revision; immutable ownership/account fields |
| Manage departments | `dsm:manage:departments` | Manager scope contains target site; prevent cross-site references |
| Manage memberships | `dsm:manage:memberships` | Admin-only; target UID differs from caller unless a separately approved break-glass flow exists; no self-promotion |
| Read audit history | New explicit audit-read permission to be approved | Account and scope filtering; bounded pagination; no client-supplied audit actor |
| Write audit history | Server-generated only | Actor UID, account, action, target, timestamp and request correlation derived server-side |

Do not silently infer own-scope semantics from a role label. The current membership policy grants `dsm:read:own-scope` to members but does not yet define the authoritative mapping from a person to individual DSM records. That mapping is a prerequisite, not a client-side convention.

## 4. Data and API constraints

- Prefer a small set of domain-specific callables over a generic Firestore proxy.
- Never expose arbitrary collection paths, document paths, field projections, or query operators.
- Use explicit DTO schemas and field allowlists per resource and action.
- Enforce payload size, page size, query cost, and rate limits; use cursor pagination with server-validated cursors.
- Use transactionally checked revisions for concurrent mutations. Reject stale revisions rather than silently overwriting.
- Require idempotency keys for retryable create/command operations; bind each key to caller, account, operation and canonical request hash.
- Do not let a caller choose audit actor, timestamp, outcome, or target account.
- Avoid returning sensitive fields by default; define redaction and retention per resource.
- Use generic external errors that do not disclose membership existence or cross-account resource details. Keep structured, sanitized diagnostics server-side.

## 5. Required negative and positive tests

Use Firebase Auth, Functions and Firestore emulators with synthetic identities and records only.

1. Missing, malformed, expired, disabled and revoked tokens are rejected.
2. Unverified identity is rejected under the current policy.
3. Missing, inactive, malformed, wrong-account and wrong-UID membership are rejected.
4. A caller cannot gain authority by submitting another UID, admin role, permission list, scope IDs, or a fabricated principal.
5. Member A cannot read or mutate member B's records unless an explicitly approved shared-scope rule permits that exact operation.
6. Manager cannot cross site/department boundaries; admin access is still account-bound.
7. Guessed document IDs, query filters, pagination cursors and nested references cannot bypass scope checks.
8. Unknown DTO fields, reserved-field changes, oversized payloads and invalid revisions are rejected.
9. Concurrent updates produce one success and a stale-revision conflict; idempotent retries do not duplicate effects.
10. Audit actor and timestamp are server-derived; denied requests do not create success events; mutation and audit commit atomically.
11. Errors do not reveal whether another account's UID, membership, or resource exists.
12. Emulator tests assert no write occurs on every rejected mutation.

## 6. Rollout gates

Before implementation: approve the data model, own-scope mapping, permission matrix, audit requirements, retention, rate limits, and account deletion semantics.

Before any real data: independent review of callable authorization and query scoping; abuse/race tests; logging and alerting review; backup/restore and deletion tests; explicit approval for operational integration. Keep emulator-only configuration and synthetic fixtures separate from production configuration.

## 7. Explicit non-goals

This proposal does not implement APIs, alter Firestore rules, migrate data, encrypt IndexedDB, solve XSS, provide immutable audit, integrate the Firebase adapter into DSM sessions, or authorize deployment. A successful emulator suite would demonstrate only the tested backend behavior, not end-to-end production security.
