# D-03 manager/team roster — canonical source and authorization audit

**Date:** 2026-11-27  
**Repository:** `Gionzeli/TURNIGPG-SICUREZZA`  
**Branch:** `codex/employee-shift-date-range-query`  
**Inspected baseline:** `68967b99c772d8f0c89b67f673876efa351735c1`  
**Scope:** source and policy audit for the approved minimal manager/team roster. No roster DTO, loader, callable, permission or UI is implemented.

## 1. Approved semantic boundary

D-03 option B is approved in principle. Its narrow roster projection may contain:
- canonical employee name or approved display label;
- operational role/function needed for staffing;
- operational qualifications/skills needed to assign suitable work;
- current canonical site/department assignment, only within a separately authorized manager scope.

Excluded: compensation/payroll, CCNL and contract level unless separately approved, bank/payment details, identity documents, unnecessary contact details, health/absence reasons, and unrestricted Employee document passthrough.

Approval of the semantic projection does not complete the source mapping or grant a callable permission. Unknown/unmapped values remain denied.

## 2. Canonical Employee identity: implemented but deliberately minimal

Inspected `functions/src/membership/employee-firestore-loaders.js` and `employee-provisioning-service.js`:
- Employee records are created with `accountId`, `employeeId`, `status`, `revision`, timestamps and actor references.
- The active UID↔Employee binding is represented by reciprocal backend-owned reservation documents.
- The loader verifies both directions and the active account/Employee lifecycle.
- The Employee record does not contain a name or display label.
- Provisioning requires a manual two-admin process and an opaque out-of-band verification ticket; that ticket is not a name source or identity attribute.

**Conclusion:** the opaque `employeeId` is suitable as a stable technical reference, but not a human-readable roster label. Do not populate a name from Firebase Auth displayName/email, an invitation, a membership request, a client selector, or legacy local storage. A separate authoritative name source, capture/verification process, correction workflow and access/retention policy are required.

## 3. Operational role/function: no canonical vocabulary found

The legacy `ProfileService` stores `profile.role` as a free-text string (max 120 characters). It is part of a locally persisted employment profile and is not a canonical staffing taxonomy.

The canonical membership policy has security roles `member`, `manager` and `admin`; these are authorization roles, not employee job functions and must never be shown or interpreted as the roster's operational role.

**Conclusion:** no safe field mapping exists from legacy `profile.role` to an approved operational role/function. A controlled vocabulary and canonical source are required, including:
- allowed codes and human-readable labels;
- whether multiple functions may be assigned;
- who may assign/change them and with what evidence;
- effective dates/history and revocation;
- validation that free text cannot be smuggled into a supposedly controlled value.

Do not reuse membership roles or expose raw legacy free text.

## 4. Qualifications/skills: no verified canonical source

The inspected repository tree and current membership services contain no canonical qualification/skill service or verified qualification DTO. Existing legacy/local skill information has no demonstrated canonical provenance, issuer, verification state, expiry or revocation contract.

A staffing skill must not be represented as a verified qualification solely because it exists in a browser-local record or free-text profile. Before exposure, define:
- controlled qualification/skill identifiers and labels;
- evidence/issuer and verification actor/process;
- achieved/valid-from/expiry dates where relevant;
- suspended, expired and revoked states;
- who can verify, correct and revoke;
- which skills are actually necessary for staffing and visible to which manager roles.

Until then, qualifications are omitted entirely from the manager DTO.

## 5. Canonical placement and manager scope: partial foundations exist

Inspected `functions/src/membership/employee-placement-service.js`:
- Placement history is stored under the canonical Employee.
- Each placement carries account, Employee, site, department, validity interval and revision.
- Creation/transfer checks active account, Employee, reciprocal binding and active canonical site/department.
- Overlapping intervals are rejected; transfers close the previous interval and create a new placement.
- A placement is therefore a candidate authoritative source for the employee's organizational assignment, not a source for name, role or qualifications.

Inspected `membership-policy.js` and `resource-authorization.js`:
- Current manager membership has `scopeType: "site"` and one or more site IDs.
- The existing canonical manager permission list is limited to organizational operations (site read/manage, department management/transfer).
- No manager/team roster permission exists.
- Resource authorization can constrain a trusted resource context to the manager's site scope, but it does not itself grant a roster permission or load a placement.

**Conclusion:** placement plus resource-scope primitives are reusable foundations, but a future roster loader must resolve each target's current placement from trusted server data and independently require a dedicated roster permission. It must not infer roster access from `dsm:read:site`, `dsm:manage:site` or `dsm:manage:departments`.

## 6. Decisions still required

| ID | Required decision | Current status |
|---|---|---|
| D03-SRC-01 | Authoritative name/display-label source and verification/correction process | Unresolved |
| D03-ROLE-01 | Controlled operational role/function vocabulary and lifecycle | Unresolved |
| D03-SKILL-01 | Controlled skill/qualification catalogue and evidence verification | Unresolved |
| D03-SCOPE-01 | Exact eligible manager roles and whether site scope alone is sufficient | Unresolved |
| D03-SCOPE-02 | Whether department-level restriction is needed in addition to the current site-scoped manager membership | Unresolved |
| D03-PERM-01 | Dedicated permission identifier and assignment policy | Not granted |
| D03-DATE-01 | Current placement selection at request time and behavior for missing/ambiguous placement | Fail closed; full query contract pending |
| D03-DTO-01 | Exact response fields, null/omission policy, ordering and bounded pagination | Unresolved |
| D03-AUDIT-01 | Whether roster reads are audited, retention and minimization | Unresolved |

## 7. Candidate safe DTO boundary — illustrative only

A future response may be shaped as a closed projection, not a document passthrough:

```js
{
  employeeId: "opaque-canonical-id",
  displayLabel: "approved canonical label",
  operationalRole: "approved-role-code",
  qualifications: ["verified-skill-code"],
  placement: {
    siteId: "canonical-site-id",
    departmentId: "canonical-department-id"
  }
}
```

This example is synthetic and does not approve any of the unresolved fields or values. Until each source is approved, the corresponding property must not be emitted. In particular, do not emit an empty or inferred name, raw legacy role, unverified skill list, payroll fields, or raw placement document.

## 8. Implementation gate and negative tests

No D-03 runtime implementation should begin until source, vocabulary, manager eligibility/scope, permission and DTO decisions are approved.

After approval, implement in this order:
1. canonical name/display-label source with verification and correction controls;
2. controlled operational role and qualification records with provenance/lifecycle;
3. dedicated manager roster permission and explicit eligible-role/scope policy;
4. trusted loader that resolves active Employee and current canonical placement on every request;
5. strict allowlist DTO and bounded query contract;
6. Auth + Functions + Firestore Emulator tests for same-site allowed target, cross-site denial, inactive/missing Employee, missing/ambiguous/expired placement, missing permission, manager/admin role edge cases, unverified/expired/revoked qualifications, malformed values, and payroll/health/contact field leakage;
7. browser UI only after backend contract and tests pass.

The query must not accept client-supplied role, site, department, Employee owner or permission as authorization evidence.

## 9. Current safety status

- D-03 semantic projection: approved in principle.
- Canonical Employee identity/binding and placement foundations: implemented for their existing narrow purposes.
- Canonical name/display label: absent.
- Canonical operational role/function vocabulary: absent.
- Verified qualifications/skills source: absent.
- Dedicated manager roster permission/callable/DTO: absent.
- Manager roster access: denied by default.
- Payroll and health/absence details: excluded.
- Canonical integration bridge: remains disabled.
- No production Firebase, real employee records, migration, merge or deployment was used or authorized.

**Verification:** source inspection only. No tests were run; this document does not change executable code.
