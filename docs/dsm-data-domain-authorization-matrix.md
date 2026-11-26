# DSM data-domain authorization matrix — decision proposal

**Status:** proposal only; no permission or data-model decision is approved.
**Scope:** separate individual ownership, organizational scope and sensitive data domains before implementing protected DSM APIs.
**Evidence reviewed:** current `ProfileService`, `ShiftService`, `AbsenceService`, membership policy and resource authorization tests on `dsm-enterprise/core-v1`.
**Safety boundary:** documentation only. No operational endpoint, Firestore path, Rules, migration, production UI, account configuration or deployment is changed.

## 1. Why a separate data-domain policy is required

The current membership policy grants a member `dsm:read:own-scope`. The current resource authorizer interprets that permission using the member's site or department `scopeIds`: a site-scoped member can pass authorization for resources in that site, and a department-scoped member can pass for resources in that department.

The existing tests explicitly assert these behaviors. They prove organizational containment, **not** that the target record belongs to the authenticated employee. A role name or a site/department scope cannot establish individual ownership.

The current client domain services also do not establish an authoritative employee link:

- `ProfileService` accepts `params` (including compensation and deduction values) and `profile` (CCNL, section, level, role, effective date). Its accepted payload has no employee UID, employee ID, site ID, department ID or owner field.
- `ShiftService` accepts date, type, post, times, flags and hours. Its accepted payload has no employee/profile owner or canonical site/department reference.
- `AbsenceService` accepts kind (`ferie`, `permesso`, `malattia`) and inclusive start/end dates. Its accepted payload has no employee/profile owner, approval state or organizational reference.
- The IndexedDB base records have account partitioning, but client-side account partitioning is not a server-side ownership proof.

Consequently, a future API cannot safely infer who owns a profile, shift or absence from a record ID, account ID, display name, post label, local repository partition or client-supplied selector.

### Audit finding ORG-02 — lifecycle status is not enforced by the current resource resolver

A read-only review of `functions/src/membership/resource-resolver.js` and `functions/test/resource-resolver.test.js` confirms that canonical account/site/department loaders are checked for record shape, IDs and parent relationships, but the resolver does not require `status: "active"` for the account, site or department. The current synthetic fixtures omit lifecycle status, and no negative archived/inactive-state tests exist. Thus the current resolver can accept structurally matching resource records regardless of lifecycle status; this is an unresolved security gap, not an approved behavior.

ORG-02 in the organizational schema decision register already proposes that every resource and ancestor must be active and that missing, unknown or malformed status fail closed. Because the canonical schema and lifecycle vocabulary remain unapproved, this audit records the confirmed gap without changing runtime logic or introducing a speculative status contract. Before any protected data endpoint is built, ORG-02 must be approved and implemented with emulator tests for archived/inactive account, site and department, missing/unknown status, and archived parent relationships.

## 2. Keep three independent authorization dimensions

Every protected operation must evaluate all applicable dimensions on the server:

1. **Identity linkage:** the verified Firebase UID resolves through an approved backend-owned binding to the canonical employee identity. The caller must not choose an arbitrary profile/employee ID.
2. **Organizational scope:** the canonical resource's current account/site/department relationship is loaded from backend-owned records and checked against the canonical membership scope.
3. **Data-domain permission:** the requested action and fields are allowed for that role and domain (profile, compensation, shifts, absence metadata, audit, export).

Passing one dimension never implies passing another. In particular:
- membership in a department does not grant access to every employee profile in that department;
- access to a profile does not automatically grant access to its shifts or absences;
- access to shifts does not grant access to compensation;
- account-admin scope does not, by itself, settle payroll visibility;
- a browser-supplied `profileId`, `employeeId`, `ownerUid`, role, permission or scope is never authoritative.

## 3. Data-domain inventory and candidate controls

The table describes a conservative proposal for review, not current behavior or an approved product contract.

| Domain | Current fields evidenced in code | Main risk | Candidate authorization boundary |
|---|---|---|---|
| Employee identity/profile | `ccnl`, `section`, `level`, `role`, `effective_date` | Identity mix-up, employment data disclosure | Employee binding plus explicit profile-read permission; organizational scope additionally required for delegated manager access |
| Compensation/payroll | Base pay, seniority increments, fixed amounts, overtime/night/Sunday rates, meal voucher, INPS/IRPEF rates, union and other deductions | High-impact financial and employment confidentiality | Separate explicit payroll permission and field allowlist; never inherit it from generic profile, site or account read |
| Shifts | Date, type, post, start/end time, flags and hours | Exposure of individual work patterns; cross-employee edits | Employee binding for own records; separately approved manager schedule permissions scoped to current site/department |
| Absences | Kind, start/end dates; kinds include sickness | Exposure of personal availability and health-related absence metadata | Employee binding for own records; delegated manager view should minimize detail and require explicit absence-management permission |
| Audit | No complete backend audit domain contract established | Tampering, excess disclosure, inability to investigate | Server-generated events; separate bounded audit-read permission; never let caller choose actor or timestamp |
| Export/report | No protected export API contract established | Bulk exfiltration across employees or domains | Explicit export permission per domain, server-side scope filters, bounded jobs, audit and rate limits |

### Field minimization proposal

- Split compensation from general profile DTOs and permissions. Do not return payroll values as a side effect of reading a profile.
- For manager planning views, consider returning only the minimum absence/availability signal needed for staffing, rather than exposing the underlying absence kind. This requires product and privacy review; it is not implemented.
- Keep health-related absence information out of generic team listings, search indexes, logs, notifications and audit payloads unless a separately approved need exists.
- Use response DTO allowlists per role and operation. Do not serialize whole Firestore documents or local repository records.
- Exports must use the same domain and scope checks as interactive reads, with stricter limits and explicit audit.

## 4. Candidate permission vocabulary

These names are proposals to make permission boundaries explicit; they are not currently granted by `membership-policy.js` and must not be treated as active permissions.

| Candidate permission | Intended boundary |
|---|---|
| `dsm:read:employee:self` | Read the caller's single verified, active employee identity and approved non-payroll profile fields |
| `dsm:read:compensation:self` | Read the caller's own approved compensation fields, if product policy allows |
| `dsm:read:shifts:self` | Read shifts linked to the caller's canonical employee identity |
| `dsm:read:absences:self` | Read the caller's own absence records |
| `dsm:read:employees:site` | Read an explicitly allowlisted employee/team projection within assigned site(s) |
| `dsm:read:shifts:site` | Read schedule projections within assigned site(s) |
| `dsm:manage:shifts:site` | Create/update/cancel shifts within assigned site(s), with target employee and current site membership revalidated |
| `dsm:read:absences:site` | Read only the approved minimum absence projection within assigned site(s) |
| `dsm:manage:absences:site` | Manage absences only after approval workflow, reason, audit and field visibility are defined |
| `dsm:read:compensation:site` | No default grant; require explicit business justification and separate approval |
| `dsm:read:compensation:account` | No default grant, including for account admins; require explicit business justification and separate approval |
| `dsm:export:<domain>:<scope>` | Domain-specific export, independently authorized and audited |

Avoid a generic `dsm:read:own-scope` permission for record ownership. If retained for organizational access, rename/redefine it so it cannot be confused with ownership of an individual employee's records. Any permission migration requires a reviewed compatibility plan and negative tests.

## 5. Proposed authorization sequence per request

1. Verify Firebase ID token server-side with revocation checking and apply the approved identity policy.
2. Resolve canonical active membership; derive role, scope and permissions server-side.
3. Resolve the employee binding from the verified UID only when an individual-owned operation is requested. Fail closed for missing, duplicate, inactive, cross-account or conflicting bindings.
4. Load the target resource and its canonical account/site/department/employee relationships from backend-owned records. Do not accept those relationships from request payloads.
5. Check current resource lifecycle state and all parent relationships.
6. Check the exact domain + action + scope permission.
7. For an own-record operation, require the target's canonical employee link to equal the verified binding. For a delegated operation, require the relevant manager permission and current organizational scope instead.
8. Apply a role- and action-specific DTO/response field allowlist. Reject unknown fields and immutable ownership/account changes.
9. Apply query constraints in the server query/transaction before data is returned; never fetch a broad set and filter it in the browser.
10. For mutations, enforce expected revision, idempotency and server-generated audit. Audit must not contain compensation values, absence details, tokens or other unnecessary sensitive payloads.

Every endpoint must repeat the complete applicable sequence. A previously resolved browser principal or five-minute authorization response is not a reusable capability.

## 6. Required tests before any protected data endpoint

Use only synthetic identities and records in Firebase Auth/Firestore/Functions emulators or injected fake loaders.

### Individual ownership
- Member A can read only the profile linked to A's verified UID.
- Supplying B's profile ID, employee ID, UID, account selector or forged owner field never changes the binding.
- A site/department-scoped member cannot read another employee's profile merely because both are in the same scope.
- Missing, inactive, duplicate, cross-account, stale and reassigned bindings fail closed.
- A binding change invalidates the old association; concurrent reassignment cannot produce two active owners.

### Domain separation
- Profile read never returns compensation fields without the explicit payroll permission.
- Payroll permission is not implied by member, manager or admin role.
- Access to a profile does not imply access to shifts or absences.
- Shift access does not imply absence access; absence access does not imply payroll access.
- Team absence views return only the approved minimum projection; no health-related detail leaks to unauthorized roles.
- Unknown DTO fields and attempts to change account, employee owner, site or department are rejected.

### Organizational scope and query behavior
- Manager can access only current assigned site(s), including after department transfer or site reassignment.
- A stale membership or stale employee binding cannot authorize a moved employee/resource.
- Guessed IDs, filters, cursors, nested references and export requests cannot bypass scope.
- Cross-account, archived, missing or inconsistent parent records deny without revealing existence.
- List queries are scoped before retrieval and enforce bounded pagination.

### Mutation, audit and export
- Stale revisions and duplicate idempotency keys do not create duplicate effects.
- Denied writes create no success audit event.
- Successful mutation and audit commit atomically where supported.
- Audit actor, action, target and timestamp are server-derived; sensitive values are excluded.
- Bulk export is independently permissioned, bounded, rate-limited and audited.

## 7. Decisions required before implementation

1. Approve the canonical employee identity and UID-binding model (LINK-01 through LINK-10).
2. Approve the canonical profile, shift, absence and organizational resource paths (ORG-01 and ORG-02).
3. Decide whether employees may see their own compensation and exactly which fields.
4. Decide manager visibility of absence type, especially `malattia`, versus a minimized availability indicator.
5. Approve the complete role × domain × action × field matrix, including create/update/delete/approve/export.
6. Define employee transfers, leave, termination, account archive, binding revocation and historical-record access.
7. Define audit retention, access, export limits, rate limits and incident response.
8. Implement isolated canonical loaders and one endpoint at a time; add emulator tests for both allow and deny paths.
9. Obtain independent security/privacy review before any production integration.



## Audit finding — revocation, reassignment and transaction freshness

**Read-only code review:** the canonical resolver loads account, site and department on each invocation and fails closed for missing, malformed, cross-account and cross-parent records. This reduces stale resource-context risk for callers that invoke it for every operation. However, the pure `authorizeResource` function accepts a principal object and cannot itself refresh membership; any future endpoint that reuses a cached principal or authorization result could retain permissions after membership revocation or scope changes. No protected data endpoints currently exist, so the repository does not yet demonstrate an endpoint-level freshness guarantee.

The nomination service uses Firestore transactions and reads the actor's canonical membership inside the create/approve/cancel transaction. Approval also re-reads the proposer membership and target membership in its transaction. This is a useful transactional safeguard in the isolated service, but it is not a deployed callable or a full revocation integration test; emulator tests currently exercise synthetic service-level identities, not concurrent Firebase Auth revocation against live callable requests.

**Remaining coverage gap:** existing resolver/authorization tests validate static scope and relationship cases, but do not simulate (a) membership revoked between token verification and an endpoint operation, (b) site/department reassignment while an authorization operation is in flight, or (c) repeated transaction retries/conflicts with membership or nomination changes. These scenarios should be tested once the protected endpoint and approved lifecycle/ownership models exist, using emulator fixtures only.

**Conservative implementation requirement:** each protected operation must re-verify/re-resolve canonical membership and resource relationships server-side at operation time, avoid reusing a browser principal as an authority, and use transactions/expected revisions for mutations where supported. For list operations, authorization constraints must be applied to the query before results are returned. This is a documented requirement, not current endpoint behavior or release approval.

## 9. Explicit non-authorization

This proposal does not add permissions to code, approve Firestore paths or schemas, create employee bindings, implement protected APIs, change root Firestore Rules, alter operational Firebase configuration, modify production UI/composition, migrate real data or authorize deployment. The existing member scope behavior remains unchanged by this document. The PR must remain open and Draft pending review.
