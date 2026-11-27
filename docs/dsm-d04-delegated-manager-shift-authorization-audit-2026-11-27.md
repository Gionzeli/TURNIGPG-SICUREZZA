# D-04 delegated manager shift authorization audit — 2026-11-27

**Repository:** `Gionzeli/TURNIGPG-SICUREZZA`  
**Branch:** `codex/employee-shift-date-range-query`  
**Scope:** source inspection of employee shift authorization and callable exports.  
**No real data, production Firebase, mailbox or external identity provider was accessed.**

## Finding

D-04 delegated manager/administrator shift authorization is **not implemented** and must remain denied.

Evidence at the inspected branch head:

- `functions/src/index.js` reports `employeeDelegatedShiftAuthorizationImplemented: false` in the health callable.
- `functions/src/membership/employee-shift-firestore-authorization.js` explicitly documents that delegated manager/admin shift access remains denied.
- Its authorization loader accepts only the self-service permissions:
  - `dsm:employee:shift:read:self`
  - `dsm:employee:shift:create:self`
  - `dsm:employee:shift:update:self`
  - `dsm:employee:shift:delete:self`
- The loader requires `principal.role === "member"`, reciprocal active UID↔Employee bindings, active Employee/control records and valid placement history. This is a self-employee path, not a manager path.
- `listOwnEmployeeShifts` filters by the bound `principal.employeeId` and the employee's authorized site/department scope.
- Proposal approval is constrained to the employee who owns and proposed the change. There is no manager callable to read or approve another employee's shift proposal.
- Direct create/update/delete shift callables remain fail-closed.

## Security decision

Do not broaden the self-service loader to accept administrators or managers. Do not infer delegated access from:
- a legacy administrator email or claim;
- a generic membership role;
- shift-approval capability;
- site/department membership without an explicit manager assignment and action-specific permission.

The legacy administrator identity exercised in Firestore rules tests is not canonical delegated authority.

## Contract required before implementation

A separate delegated authorization contract is required, covering:

1. Canonical manager assignment source and lifecycle, including effective dates and revocation.
2. Exact scope semantics: account, site, department, employee set, and whether nested departments are included.
3. Action-specific permissions (read, propose, approve, reject, direct mutation if ever allowed) and separation of duties.
4. Whether a manager may approve an employee's proposal, and how self-approval is prevented.
5. Placement-history behavior when employees transfer during a requested date range.
6. Minimal manager DTO allowlist, excluding payroll, health, private notes and unrelated personal data.
7. Audit event schema, actor identity, target employee, scope snapshot and revision preconditions.
8. Tests for cross-account, out-of-scope, expired/revoked assignment, transfer boundaries, manager self-action, and legacy-admin-only denial.

## Next safe sequence

- Keep `employeeDelegatedShiftAuthorizationImplemented: false`.
- Keep all delegated manager shift reads and mutations denied.
- Define and review the canonical assignment/permission contract before creating any callable or widening an authorization helper.
- Add Auth + Functions + Firestore Emulator tests for the contract before considering activation.
- Keep the operational bridge disabled and payroll/health data excluded.

This audit is a source-level finding, not approval for production activation, merge, deployment or real-data access.
