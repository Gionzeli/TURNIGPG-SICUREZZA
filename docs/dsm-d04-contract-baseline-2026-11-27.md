# D-04 delegated manager shift authorization — contract baseline

**Repository:** `Gionzeli/TURNIGPG-SICUREZZA`  
**Branch:** `codex/employee-shift-date-range-query`  
**Inspected head:** `f018c0dd9be7afad007c897fbb8361de2c2ddab2`  
**Date:** 2026-11-27

## Purpose and status

This document records the existing canonical membership vocabulary and separates it from the decisions still required for delegated employee-shift access. It is a design baseline, not an approved authorization contract. No permissions, callables, or data access have been added. D-04 remains **not implemented and denied**.

## Existing canonical facts

### Membership policy

`functions/src/membership/membership-policy.js` currently recognizes these roles:

- `member`: non-account scope, at least one scope ID.
- `manager`: site scope only, at least one site ID.
- `admin`: account scope only, no scope IDs.

Memberships must be active, match the verified UID and account, have a valid `validFrom`, and have a null or valid future `validUntil`. The policy derives permissions server-side; a membership's client-supplied `permissions` field is not authoritative.

Current derived permissions:

| Role | Derived permissions |
|---|---|
| member | `dsm:read:own-scope`, `dsm:employee:shift:read:self`, `dsm:employee:employment-profile:read:self` |
| manager | `dsm:read:site`, `dsm:manage:site`, `dsm:manage:departments`, `dsm:transfer:departments` |
| admin | `dsm:read:account`, `dsm:manage:account`, `dsm:manage:memberships`, `dsm:manage:admin-nominations`, `dsm:transfer:departments`, `dsm:archive:site`, `dsm:archive:department` |

Neither manager nor admin inherits employee self-shift permissions. There are currently no manager-specific employee-shift read, proposal, approval, rejection, or mutation permissions.

### Existing organization operations are not shift authority

The organization mutation services demonstrate how existing manager site scope is enforced for organization structure:
- A manager may create a department only within a site in their `scopeIds`.
- A manager may transfer a department only when both source and destination sites are in their scope.
- Department and site archival are admin-only.
- These operations reload effective membership inside the transaction and write organization audit events.

These permissions govern organization structure only. They do not establish which employees a manager may view or manage, and must not be reused as implicit shift permissions.

### Existing shift authorization

`employee-shift-firestore-authorization.js` deliberately requires `principal.role === "member"`, reciprocal active UID↔Employee bindings, active employee/control records, and exactly one valid placement for the requested date. It checks the member's scope against that placement. Delegated manager/admin access remains denied.

## D-04 decisions still required

The repository does not currently define enough information to safely authorize a manager against another employee. The following are unresolved product/domain decisions, not fields that may be inferred from the current schema:

1. **Assignment source and lifecycle.** Is a manager-to-employee assignment a separate canonical record, or is site scope alone intended to define the employee set? Who may create/revoke it? What are its effective dates, status, revision and audit requirements?
2. **Scope semantics.** Does a site manager cover every employee whose placement is at that site on the requested date? Are department restrictions or explicit employee allowlists required? How are cross-site transfers handled across date ranges?
3. **Action matrix.** Decide independently whether delegated roles may read shifts, read proposals, submit changes on behalf of an employee, approve/reject proposals, or directly mutate shifts. Existing organization permissions do not answer this.
4. **Separation of duties.** Decide whether a manager may approve a proposal they created, their own employee proposal, or a proposal for an employee for whom they are the proposer. Default must be deny.
5. **DTO allowlist.** Define the minimum schedule/availability fields managers need. Payroll, compensation, IBAN/payment data, health data, absence reasons/documents, private notes and unrelated personal data remain excluded.
6. **Audit and concurrency.** Define actor, target employee, account, action, scope/assignment snapshot, effective placement, reason, previous/current revision and expected-version preconditions.
7. **Lifecycle edge cases.** Specify behavior for expired/revoked manager assignments, inactive members/employees/sites/departments, missing or overlapping placement history, transfer boundaries, account mismatch, and stale revisions.

## Required implementation/test gate

Only after the decisions above are explicitly approved:

- Add a distinct delegated authorization path; do not broaden the self-service loader or change its `role === "member"` requirement.
- Derive all authority from verified identity and server-owned, effective-dated canonical records loaded in the same trusted transaction as the protected operation.
- Add action-specific permissions; do not infer them from `manager`, `admin`, `dsm:manage:site`, `dsm:manage:departments`, or `dsm:transfer:departments`.
- Preserve employee ownership checks and prohibit manager self-approval unless a separately approved policy explicitly says otherwise.
- Add Auth + Functions + Firestore Emulator tests for positive in-scope access and denial of cross-account, out-of-scope, expired/revoked assignment, transfer-boundary, inactive resource, malformed/overlapping placement, self-action and legacy-admin-only cases.
- Verify the DTO contains only the approved allowlist and that denied calls produce no writes or audit events.

## Current safety boundary

- `employeeDelegatedShiftAuthorizationImplemented` remains `false`.
- Delegated manager/admin shift reads and mutations remain denied.
- `TURNI_DSM_CANONICAL_AUTH_ENABLED` remains unset/false.
- No production Firebase, real mailbox, or external identity provider was accessed.
- No merge, deployment, or activation is authorized by this audit.
