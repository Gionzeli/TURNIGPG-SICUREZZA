# DSM canonical organizational schema — proposal for review

**Status:** proposal only; not an approved production schema and not implemented.
**Scope:** account, site, department and membership records for isolated backend design.
**Data:** synthetic examples only.
**Protected surfaces:** no changes to root `firestore.rules`, Firebase operational configuration, client composition roots, `index.html`, secrets, or production data.

## 1. Evidence in the current repository

The backend already reads membership from:

`accounts/{accountId}/members/{uid}`

The nomination and revocation services also use these existing backend paths:

- `accounts/{accountId}/adminNominations/{nominationId}`
- `accounts/{accountId}/membershipAudit/{eventId}`

The current membership validator expects these fields:

`uid`, `accountId`, `status`, `role`, `scopeType`, `scopeIds`.

It currently accepts roles `member`, `manager`, `admin`; scope types `department`, `site`, `account`; and derives permissions from role in server code. A manager is site-scoped. The repository does **not** currently validate membership effective dates or a membership expiry field.

The resource resolver deliberately has no Firestore loaders because the account/site/department document paths are not approved. Root Firestore Rules describe a separate legacy top-level model and do not establish the proposed nested organization hierarchy. This proposal does not reinterpret or modify those rules.

## 2. Recommended logical hierarchy

Use account-scoped, flat collections for sites and departments:

```text
accounts/{accountId}
accounts/{accountId}/members/{uid}
accounts/{accountId}/sites/{siteId}
accounts/{accountId}/departments/{departmentId}
accounts/{accountId}/adminNominations/{nominationId}
accounts/{accountId}/membershipAudit/{eventId}
accounts/{accountId}/organizationAudit/{eventId}
```

Only the membership, nomination and membership-audit paths above are evidenced by existing backend code. The account, site, department and organization-audit paths are **proposals**, not existing or approved production paths.

A flat department collection is recommended instead of nesting departments beneath sites. Each department has exactly one current `siteId`. Moving a department changes this one canonical relationship in a transaction; it does not require copying or moving the department document between parent collections. All IDs are immutable and unique within their account. IDs must never be reused after archival.

## 3. Proposed document shapes

The following are logical field contracts, not deployed Firestore schemas.

### Account — `accounts/{accountId}`

Required:
- `accountId`: equals document ID.
- `status`: `active` or `archived`.
- `schemaVersion`: positive integer.
- `createdAt`, `updatedAt`: server timestamps.

Optional descriptive fields such as `displayName` are non-authoritative and must never affect authorization.

### Site — `accounts/{accountId}/sites/{siteId}`

Required:
- `accountId`: equals parent account and document path.
- `siteId`: equals document ID.
- `status`: `active` or `archived`.
- `createdAt`, `updatedAt`: server timestamps.

A site belongs to exactly one account. A site cannot be used across accounts. Archiving a site with active departments or active manager assignments must be rejected until a separately authorized transfer/revocation process completes.

### Department — `accounts/{accountId}/departments/{departmentId}`

Required:
- `accountId`: equals parent account and document path.
- `departmentId`: equals document ID.
- `siteId`: exactly one current site in the same account.
- `status`: `active` or `archived`.
- `createdAt`, `updatedAt`: server timestamps.

The pair `(accountId, siteId)` is the authoritative current parent relationship. A department cannot exist without a valid active parent site. Display names, client-side parent labels and cached site lists are never authorization evidence.

### Membership — existing path and compatible shape

`accounts/{accountId}/members/{uid}`

Required, matching current validator:
- `uid`: equals document ID and verified Firebase UID.
- `accountId`: equals parent account.
- `status`: currently accepted value is `active`.
- `role`: `member`, `manager` or `admin`.
- `scopeType`: `department`, `site` or `account`.
- `scopeIds`: unique array of IDs of the scope type.

Role/scope constraints:
- `admin`: `scopeType: "account"`, empty `scopeIds`.
- `manager`: `scopeType: "site"`, one or more site IDs.
- `member`: `scopeType: "department"` or `"site"`, one or more IDs.

The current implementation derives permissions from role. Do not add a client-controlled `permissions` field as an authority source. The current policy must be extended before any effective-from/effective-until semantics are relied on; until then the only accepted status is exactly `active`.

The same Firebase UID may have separate membership documents under different account IDs. The client may submit an account ID only as a selector; the backend must verify the token, derive UID from its claims, and load that exact membership. A selector is not proof of membership.

## 4. Normative authorization semantics

1. An account admin is scoped to the account and may access its current active sites and departments, subject to the requested permission.
2. A manager assigned to a site may access all active departments whose current canonical `siteId` equals that assigned site. This includes departments created later.
3. A department transfer immediately changes the authoritative relationship. The previous site's managers lose inherited access; the new site's managers gain it only if their membership remains active and their scope includes the destination site.
4. A department-scoped member can access only the department IDs in the active membership scope.
5. A site-scoped member can access only departments whose current site is in the active membership scope, subject to the role's permissions.
6. No role grants cross-account access. Every resolved record must match the verified membership's account.
7. Missing, archived, malformed, duplicate, contradictory or inaccessible records deny access.
8. Client selectors may contain resource IDs only. Never accept role, scope, permissions, ownership, account hierarchy or parent relationship from the request as authoritative.
9. Every protected read and write must authenticate and authorize on the server at operation time. The authorization-resolve response and browser principal are not substitutes.
10. Admin SDK bypasses Firestore Security Rules. Every callable/HTTP service using Admin SDK must enforce its own authentication, membership, permission and resource checks.

## 5. Department transfer transaction

A transfer is a privileged organizational mutation, not a normal department update.

The server transaction should:
1. Authenticate the actor with a revocation-checked token and load current canonical membership.
2. Require an explicit permission to transfer departments within the account.
3. Load the department, source site and destination site from canonical records.
4. Verify all records are active, belong to the same account, and the department currently points to the source site.
5. Reject no-op, cross-account, missing-parent and stale-version requests.
6. Update only the department's `siteId`, `updatedAt` and monotonic `version` (if versioning is adopted).
7. Append an immutable organization-audit event in the same transaction, including actor UID, department ID, old/new site IDs, server timestamp and event ID.
8. Ensure concurrent transfers cannot both succeed from the same old relationship; use transaction preconditions/version checks.
9. Re-resolve the current department→site relationship for every subsequent protected operation. Do not use cached expanded lists of departments.

If the transaction or audit append fails, neither change may commit. Do not rely on asynchronous cleanup or a client notification to enforce the transfer boundary.

## 6. Required indexes and query shape

With flat department records, listing active departments in a site uses equality filters on `accountId`, `siteId` (if denormalized in a collection-group design), and `status`. Under the proposed account subcollection, account ID is already in the path; the query normally needs `siteId == X` and `status == "active"`. The exact composite index must be derived from the final query implementation and emulator/deployment configuration, not guessed here.

For authorization of a single department, fetch its canonical document by ID and verify `accountId`, `departmentId`, `siteId` and active parent site. Never authorize from a query result supplied by the browser.

## 7. Required synthetic emulator tests

- Account, site and department document IDs match their embedded IDs and parent account.
- Missing, archived, malformed or cross-account parent records are denied.
- Manager access includes a department created after the manager assignment.
- Manager access is denied after a department is transferred away from the assigned site.
- Manager access is allowed after transfer only for an active manager assigned to the destination site.
- A department cannot be assigned to an archived or cross-account site.
- Concurrent transfers from the same source cannot both commit.
- Failed transfer/audit transaction leaves both department and audit unchanged.
- Department-scoped member cannot read a sibling department.
- Site-scoped member cannot read a department outside the assigned site.
- Account admin still requires an allowlisted permission.
- Revoked membership is denied on the next protected operation, regardless of a cached browser principal.
- UID with memberships in two accounts cannot use one account's membership to access the other.
- Caller-supplied role, permissions, siteId, ownership and account claims cannot override canonical records.
- Admin SDK service tests prove every protected operation checks token revocation and current membership.
- Query and write paths use canonical resource resolution, not client-provided records.

## 8. Decisions still required before implementation

This proposal intentionally does not decide:
- Whether accounts/sites/departments may be renamed, archived or permanently deleted, and the retention policy for audit.
- Whether managers may be assigned to multiple sites (current `scopeIds` shape permits it, but product policy must confirm).
- Whether members may be assigned to multiple departments/sites (current shape permits arrays, but product policy must confirm).
- The complete permission matrix and who may create, archive or transfer sites/departments.
- Whether membership has `validFrom`/`validUntil`, suspension metadata and what clock/lease semantics apply.
- Whether account/site/department IDs are generated server-side and how they are allocated.
- The exact Firestore indexes and rules for a future, isolated deployment.
- Migration and compatibility strategy for any pre-existing real organization data. No migration is authorized by this proposal.

## 9. Explicit non-authorization

This file is a review proposal only. It does not approve Firestore paths, indexes, security rules, data migration, production credentials, Firebase project changes, deployment, or real-data access. Do not create Firestore loaders until the schema owner approves the path and field contract. Do not wire protected data APIs until their server-side authorization tests pass.
