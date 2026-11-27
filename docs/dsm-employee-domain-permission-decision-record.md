# Employee data permissions — decision record for review

**Status:** D-01 through D-06 have recorded policy approvals as detailed below; implementation remains gated on the stated role, scope, schema, workflow, and test requirements. D-07 and lifecycle/historical access remain open. No approval authorizes production activation.
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

**Approved 2026-11-27 — option B (employment profile), by explicit user confirmation in the project conversation.**

Approved self-read allowlist, expressed as semantic fields pending a schema-to-field mapping review:
- minimum identity fields needed to identify the linked Employee record;
- CCNL;
- section;
- level;
- role;
- effective date for the applicable employment-profile values.

The response must remain limited to the authenticated employee's own canonical record, resolved only through the unique active backend-owned UID↔Employee binding. No compensation, payroll, deductions, bank/payment details, health/absence details, documents, or other employees' data are included. No general Firestore document passthrough and no client-selected Employee ID as ownership proof.

**Still required before implementation:** map each approved semantic field to the actual canonical schema and confirm that no field contains mixed or sensitive data. Unknown or unmapped fields remain denied. This approval does not authorize offline caching, exports, manager access, profile mutation, or historical access after lifecycle/binding changes.

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

**Approved 2026-11-27 — option B (limited self-service compensation), by explicit user confirmation in the project conversation.**

Approved self-read scope, as a semantic allowlist pending canonical schema mapping:
- current base pay amount and its effective date;
- overtime amounts and applicable effective dates;
- premiums/majorations and applicable effective dates;
- allowances and applicable effective dates.

This is a separate compensation DTO and permission from D-01 ordinary profile self-read. Access is limited to the authenticated employee's own canonical record, resolved only through the unique active backend-owned UID↔Employee binding. Explicitly excluded: deductions/withholdings, complete payslip, bank account/IBAN, payment instruments or destination details, other employees' compensation, exports, mutations, and offline/local cache. No general Firestore document passthrough.

**Still required before implementation:** map every approved semantic item to canonical schema fields, define units/periods and whether overtime is represented as hours, amounts, or both, and verify that no field contains mixed or sensitive data. Unknown or unmapped fields remain denied. This approval does not authorize manager access, historical access after lifecycle/binding changes, payroll writes, exports, or production activation.

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

**Approved 2026-11-27 — option B (minimal roster plus operational staffing fields), by explicit user confirmation in the project conversation.**

Approved manager/team roster projection, pending canonical schema mapping:
- employee name or approved display label;
- operational role/function needed to organize staffing;
- operational qualifications/skills needed to assign suitable work;
- current canonical site/department assignment, shown only within the manager's separately authorized scope.

This is a narrowly scoped team-roster projection, not general profile access. It excludes compensation and payroll, CCNL/contract level unless separately approved, bank/payment data, identity documents, contact details not operationally required, health/absence reasons, and other sensitive personal fields. No unrestricted Employee document passthrough.

**Still required before implementation:** explicitly define eligible manager roles and whether authorization scope is site, department, or both; map each approved semantic field to canonical schema fields; validate that role/qualification fields do not contain free-text sensitive information. Current canonical placement and lifecycle must be checked server-side on every request. Until those details are approved and tested, no manager/team profile endpoint is authorized; unknown or unmapped fields remain denied. This decision does not authorize team shift management, absence visibility, compensation access, exports, or profile mutation.

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

**Approved 2026-11-27 — option B (team shift visibility plus proposed changes requiring approval), by explicit user confirmation in the project conversation.**

Approved workflow in principle:
- A manager may view the team schedule projection only within a separately authorized organizational scope.
- A manager may submit a proposed shift change; the proposal does not mutate the canonical shift.
- A distinct authorized approver must approve or reject the proposal before any canonical change is applied.
- Approval/rejection and the resulting mutation must be server-authorized and audited; mutations require expected revision and conflict handling.
- No self-approval of one's own proposal.

**Still required before implementation:** define eligible manager and approver roles, site/department scope, permitted change types and fields, approval quorum/independence, notification and expiry behavior, and the canonical schedule fields. The target employee's placement and scope must be checked for the shift date. No direct manager create/update/cancel endpoint is authorized by this decision; no client-provided owner, site, department, role, or permission is trusted. Unknown or unmapped fields remain denied.

### D-05 — Absence visibility

**Question:** What may a manager see about another employee's absence?

Possible choices:
- **A. No manager absence view:** absence data remains employee/self and explicitly authorized administrative access only.
- **B. Minimal operational status:** unavailable signal, relevant dates, and request workflow status (pending, approved, rejected), without absence category or reason.
- **C. Operational category:** an enumerated non-health category set, after privacy review.
- **D. Detailed absence management:** only after a separate approval workflow, legal/privacy review and strict field permissions.

**Approved 2026-11-27 — option B (minimal operational status), by explicit user confirmation in the project conversation.**

Approved visibility is limited to:
- unavailable/available signal and the dates needed for staffing;
- request workflow status: pending, approved, or rejected.

Explicitly excluded: absence category, reason, medical or health information, diagnosis, notes, attachments, and any sensitive detail. This decision grants read visibility only; it does not grant managers authority to create, edit, approve, reject, or export absence requests.

Required safeguards:
- Dedicated allowlisted manager DTO; never pass through the general Employee or absence document.
- Manager eligibility and site/department scope must be separately authorized and checked against canonical records for the relevant dates.
- Self-read, manager read, manager manage, approve and export remain separate permissions.
- Notifications, logs, audit and local caches must not disclose excluded details.
- Unknown or unmapped fields remain denied.

**Still required before implementation:** define eligible manager roles and site/department scope, map canonical absence dates and workflow status, and add negative tests proving category/reason/health fields cannot leak. No manager absence endpoint is authorized by this decision.

### D-06 — Audit access

**Question:** Who may read security/audit events, and at what granularity?

Possible choices:
- **A. Server-only:** no user-facing audit-read endpoint.
- **B. Scoped domain managers:** managers may read only the minimized events needed for delegated responsibilities, limited to their separately authorized site/department scope.
- **C. Organization-wide security audit:** designated security administrators may read a broader organization-wide audit view under a separate policy.

**Approved 2026-11-27 — option B (scoped, minimized audit visibility for managers), by explicit user confirmation in the project conversation.**

Approved in principle:
- Access is limited to events concerning resources and operations within the manager's separately authorized site/department scope.
- Only minimized metadata may be shown: event timestamp, action/event type, relevant target reference, and actor reference where operationally necessary.
- No event payloads, before/after field values, compensation, absence reasons or categories, health information, tokens, credentials, document contents, or unrelated technical/security details.
- Audit visibility is read-only and does not grant permission to perform the audited action, manage audit records, export audit data, or view organization-wide events.

Required safeguards:
- Actor, action, target and timestamp are server-generated and immutable to clients.
- Scope is enforced server-side against canonical resource placement and event time; client filters are not authorization.
- Audit-read permission is distinct from ordinary profile, schedule, absence, and account administration permissions.
- Access to the audit view itself is audited without copying sensitive event payloads.

**Still required before implementation:** define eligible manager roles and site/department scope, event taxonomy and exact metadata fields, retention, incident-response ownership, and whether actor references can be shown or must be further pseudonymized. Export remains separately denied. No audit-read endpoint is authorized until these details and negative-scope tests are complete.

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

**Approved 2026-11-27 — option B (narrow per-domain exports), by explicit user confirmation in the project conversation.**

Approved policy in principle:
- Export is a separate permission and is never inherited from read, manager, or account-admin access.
- Each export requires an explicit allowlist for role, domain, organizational scope, fields, purpose, row/time limits, and delivery method.
- Scope and field filtering are enforced server-side; client filters are not authorization.
- Every request, execution, completion, and failure is audited without recording sensitive payloads.
- Exports must have bounded pagination/job size, rate limits, secure delivery, defined retention and deletion.
- No automatic, scheduled, bulk, or organization-wide export is authorized by this decision.
- Compensation/payroll, absence/health details, credentials, identity documents, and audit payloads remain excluded unless separately reviewed and explicitly approved.

**Still required before implementation:** specify each permitted export independently (roles, domain, scope, exact fields, purpose, row/time limits, format, delivery, retention, deletion, and incident owner); complete privacy/security review and synthetic Emulator tests, including negative cross-scope and sensitive-field tests. No export endpoint or report is authorized until those details are approved.

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

## 4. Lifecycle and historical access decisions

### L-01 — Manager access after an employee transfer

**Question:** What access do managers at the previous site/department retain after an employee transfer?

**Approved 2026-11-27 — option B (historical operational access limited to the period of prior assignment), by explicit user confirmation in the project conversation.**

Approved policy in principle:
- After the effective transfer date, managers of the previous site/department do not receive access to the employee's current or future operational records through their former scope.
- They may retain read access only to operational historical records within domains already separately authorized, and only for the period during which the employee was canonically assigned to that site/department.
- The historical assignment interval must be derived from backend-owned canonical placement history, not client-supplied dates or current roster membership.
- This does not expand the approved field allowlists or grant access to compensation, health/absence reasons, restricted personal data, exports, or records outside the former manager's scope.
- Every historical query must enforce the assignment interval and domain-specific permission server-side; ambiguous or missing placement history fails closed.

**Still required before implementation:** define canonical transfer effective-time semantics and timezone, treatment of shifts/records spanning the transfer boundary, retention and correction of placement history, and negative tests proving the previous manager cannot read post-transfer records. This policy does not authorize historical access for other lifecycle events.

Other lifecycle decisions remain open and fail closed:
- leave, suspension, termination and reactivation;
- account/site/department archive and restoration;
- binding revocation, reassignment and duplicate/conflicting bindings;
- access to historical shifts, absences, profiles and payroll after termination or other lifecycle changes;
- audit retention, legal holds, deletion and export.

No new status vocabulary or lifecycle transition is introduced by this record.

## 5. Approval record

Record each decision explicitly, including approver, date, exact option and field list, affected roles, and any exceptions. A general "continue" or approval of the Firestore storage choice does not approve these field-level access policies.

| Decision | Status |
|---|---|
| D-01 Own ordinary profile | Approved — option B self-read; implementation gated on schema field mapping |
| D-02 Own compensation | Approved — option B limited self-read; implementation gated on schema mapping |
| D-03 Manager/team profile | Approved — option B minimal roster; implementation gated on role/scope and schema mapping |
| D-04 Manager/team shifts | Approved — option B proposed changes with separate approval; implementation gated on roles/scope/workflow |
| D-05 Manager absence visibility | Approved — option B minimal availability, dates and request status; implementation gated on roles/scope/schema |
| D-06 Audit read | Approved — option B scoped, minimized manager event visibility; implementation gated on roles/scope/event taxonomy/retention |
| D-07 Export/report | Approved — option B narrow per-domain exports in principle; no endpoint until per-export details and review are approved |
| L-01 Transfer and prior-manager historical access | Approved — option B limited to operational records within former assignment interval; implementation gated on temporal semantics and tests |\n| Other lifecycle and historical access | Open — fail closed |

## 6. Explicit non-authorization

This record does not grant permissions, approve a role matrix, settle legal/privacy questions, create or migrate records, add Firestore paths, modify Security Rules, implement APIs, connect the operational app, access real collaborator data, configure a real Firebase project, merge, or deploy.

The repository's existing proposal matrix remains proposal-only. This record is a review aid and must not be interpreted as a security certification or as approval by silence.
