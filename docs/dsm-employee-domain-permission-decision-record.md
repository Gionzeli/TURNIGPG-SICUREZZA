# Employee data permissions — decision record for review

**Status:** open decision; proposal only. No new permission, schema, API, Firestore Rule, or operational behavior is approved by this document.
**Scope:** clarify decisions required before implementing protected Employee profile, compensation, shift, absence, audit, or export endpoints.
**Development boundary:** documentation on `codex/employee-shift-date-range-query`; synthetic data only.
**Related decisions:** `dsm-employee-firestore-decision.md`, `dsm-data-domain-authorization-matrix.md`, `dsm-hybrid-data-protection-plan.md`.

## 1. Current safe default

Until each relevant decision is explicitly approved:

- No new profile, compensation, absence, manager/team, audit-read, or export endpoint is implemented.
- No role or organizational scope implicitly grants access to an individual employee's records.
- Payroll and health-related absence details remain denied by default, including for account administrators.
- Existing shift self-service code remains isolated prototype code; it does not establish approval of a general manager schedule policy.
- Existing legacy LocalStorage/IndexedDB behavior is not migrated, uploaded, or treated as proof of employee ownership.
- Unknown permissions, fields, role combinations, lifecycle states, or ownership links fail closed.

This is a development safety boundary, not a claim that the existing application already enforces every control.

## 2. Decisions to make

Each decision below is independent. Approval of one does not approve the others.

### D-01 — Employee's own ordinary profile

**Question:** Which non-payroll fields may an employee read from their own canonical profile?

Possible choices:
- **A. Minimal identity:** only the minimum identity/employment fields required to identify the linked employee.
- **B. Employment profile:** minimal identity plus explicitly listed contract/profile fields such as CCNL, section, level, role and effective date.
- **C. Broader self profile:** a separately enumerated list, reviewed field by field.

Required safeguards regardless of choice:
- Resolve the employee only from the verified UID's backend-owned binding.
- Never accept a client-selected employee ID as proof of ownership.
- Return an explicit field allowlist, not the Firestore document.
- No compensation or deduction fields in this response.

**Unapproved:** exact field list and whether self-read is enabled.

### D-02 — Employee's own compensation

**Question:** May an employee read their own compensation/payroll information?

Possible choices:
- **A. Deny self-service payroll:** no employee-facing compensation read endpoint.
- **B. Limited self-service:** allow only an enumerated subset, such as current base amount and effective date.
- **C. Full self-service payroll view:** allow a separately enumerated set of pay, overtime, allowances and deduction fields.

Required safeguards regardless of choice:
- Separate payroll permission and DTO from ordinary profile.
- No inheritance from member, manager, or account-admin role.
- Explicit field-by-field list; sensitive bank/payment data and unrelated identifiers are excluded unless separately decided.
- Read access, exports and mutations are distinct actions and require separate decisions.
- No offline payroll cache.

**Unapproved:** whether self-read is allowed, exact fields, and any payroll write/export roles.

### D-03 — Manager/team employee profile visibility

**Question:** What employee information may a manager see for people within their assigned site or department?

Possible choices:
- **A. No team profile endpoint:** managers use existing operational information only.
- **B. Minimal roster:** name/display label and only the minimum staffing fields.
- **C. Employment projection:** a defined set of non-payroll employment fields, each explicitly listed.

Required safeguards regardless of choice:
- A manager permission is separate from individual ownership.
- Current canonical site/department assignment must be checked on every request.
- Site/department membership alone does not grant profile access.
- No compensation, bank details, identity documents, or health-related details in the roster.
- Query constraints and response allowlists are enforced server-side.

**Unapproved:** eligible manager roles, organizational scope, and field list.

### D-04 — Manager shift visibility and management

**Question:** May managers read or change shifts for other employees in their scope?

Possible choices:
- **A. Self-only:** no delegated manager shift access.
- **B. Team read-only:** read an approved schedule projection for assigned sites/departments.
- **C. Team management:** separately authorize read, create, update and cancel actions.

Required safeguards regardless of choice:
- Read and each mutation are distinct permissions.
- Target employee placement and manager scope are checked against canonical records for the shift date.
- Expected revision and server-generated audit are required for mutations.
- No client-provided owner, site, department, role or permission is authoritative.

**Unapproved:** manager eligibility, site versus department scope, and action permissions.

### D-05 — Absence visibility

**Question:** What may a manager see about another employee's absence?

Possible choices:
- **A. No manager absence view:** absence data remains employee/self and explicitly authorized administrative access only.
- **B. Minimal availability:** only unavailable/available signal and dates, without absence category.
- **C. Operational category:** an enumerated non-health category set, after privacy review.
- **D. Detailed absence management:** only after a separate approval workflow, legal/privacy review and strict field permissions.

Required safeguards regardless of choice:
- Never include medical reason, notes, attachments, diagnosis or health details in general team DTOs.
- A generic schedule or profile permission does not grant absence access.
- Self-read, manager read, manager manage, approve and export are separate decisions.
- Notifications, logs, audit and local caches must not disclose restricted details.

**Unapproved:** whether manager view exists and whether any category is visible.

### D-06 — Audit access

**Question:** Who may read security/audit events, and at what granularity?

Possible choices:
- **A. Server-only:** no user-facing audit-read endpoint.
- **B. Restricted security administrators:** metadata-only events, with explicit scope and retention.
- **C. Domain managers:** only events needed for their delegated responsibilities, without sensitive field values.

Required safeguards regardless of choice:
- Actor, action, target and timestamp are server-generated.
- Audit records do not copy compensation values, absence reasons, tokens or document contents.
- Audit read is separate from ordinary profile or account administration.
- Retention, export and incident-response ownership must be defined.

**Unapproved:** roles, event fields, retention, and export rights.

### D-07 — Export and reporting

**Question:** Which roles may export which domains?

Possible choices:
- **A. No export endpoints:** keep export disabled.
- **B. Narrow per-domain export:** explicit role, domain, scope, field list and row/time limits.
- **C. Administrative reporting:** only after separate privacy, abuse-control and audit review.

Required safeguards regardless of choice:
- Export permission is never inherited from read permission.
- Server-side tenant/scope filters, field allowlists, pagination/job limits and rate limits.
- Audit each export request and completion without logging sensitive payloads.
- Define retention, secure delivery, deletion and incident handling before enabling.

**Unapproved:** all export/report capabilities.

## 3. Common authorization requirements

These controls are required for any future approval; they do not by themselves authorize an endpoint:

1. Verify the Firebase ID token server-side with revocation checking.
2. Derive actor UID only from the verified token.
3. Resolve canonical membership and current lifecycle server-side for every operation.
4. Resolve self ownership through a unique, active, backend-owned UID↔Employee binding.
5. Check organizational scope independently from individual ownership.
6. Check exact domain + action + field permission.
7. Enforce server-side query constraints before returning records.
8. Return purpose-specific allowlisted DTOs.
9. Reject unknown request fields and client attempts to override identity, owner, account, placement, role, permission or audit metadata.
10. Use expected revisions and server-generated audit for mutations.
11. Test allow and deny paths with synthetic identities in emulators.
12. Keep protected Firestore client access denied unless separately reviewed Rules and emulator tests are approved.

## 4. Lifecycle and historical access decisions still required

Before operational use, separately define behavior for:
- employee transfer between departments or sites;
- leave, suspension, termination and reactivation;
- account/site/department archive and restoration;
- binding revocation, reassignment and duplicate/conflicting bindings;
- access to historical shifts, absences, profiles and payroll after a transfer or termination;
- audit retention, legal holds, deletion and export.

No new status vocabulary or lifecycle transition is introduced by this record.

## 5. Approval record

Record each decision explicitly, including approver, date, exact option and field list, affected roles, and any exceptions. A general "continue" or approval of the Firestore storage choice does not approve these field-level access policies.

| Decision | Status |
|---|---|
| D-01 Own ordinary profile | Open — deny new endpoint |
| D-02 Own compensation | Open — deny |
| D-03 Manager/team profile | Open — deny new endpoint |
| D-04 Manager/team shifts | Open — no new delegated access |
| D-05 Manager absence visibility | Open — deny new endpoint; no health details |
| D-06 Audit read | Open — server-only |
| D-07 Export/report | Open — disabled |
| Lifecycle and historical access | Open — fail closed |

## 6. Explicit non-authorization

This record does not grant permissions, approve a role matrix, settle legal/privacy questions, create or migrate records, add Firestore paths, modify Security Rules, implement APIs, connect the operational app, access real collaborator data, configure a real Firebase project, merge, or deploy.

The repository's existing proposal matrix remains proposal-only. This record is a review aid and must not be interpreted as a security certification or as approval by silence.
