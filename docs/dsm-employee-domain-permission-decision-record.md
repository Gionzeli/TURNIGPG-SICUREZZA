# Employee data permissions — decision record for review

**Status:** D-01 through D-07 and L-01 through L-21 have recorded policy approvals as detailed below; implementation remains gated on the stated role, scope, schema, workflow, lifecycle, and test requirements. No approval authorizes production activation.
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

### L-02 — Access during employee suspension

**Question:** Which access remains available while an employee is suspended?

**Approved 2026-11-27 — option B (revoke operational access and privileges; retain only narrowly necessary personal access where separately authorized), by explicit user confirmation in the project conversation.**

Approved policy in principle:
- On suspension becoming effective, revoke operational access and delegated privileges, including manager, approver, administrative, shift-management and other work-related capabilities.
- A minimal personal self-service view may remain available only where separately authorized, necessary, and safe; it does not include operational tools, other employees' data, or privileged actions.
- Every request must re-check canonical lifecycle status server-side; client state, cached sessions, and previously issued permissions do not override suspension.
- Existing sessions and credentials must be invalidated or denied according to the backend's revocation checks; failure to establish current status fails closed.
- Suspension does not itself authorize deletion or alteration of historical records.

**Still required before implementation:** define the canonical suspension state and effective timestamp, which exact personal self-service domains (if any) remain available, session/token revocation behavior, treatment of pending proposals/approvals, and tests for immediate denial of operational actions. No suspended-user exception is implied for compensation, exports, or sensitive data.

### L-03 — Access after employment termination

**Question:** What access remains for an employee after the employment relationship ends?

**Approved 2026-11-27 — option B (revoke operational access; allow temporary, limited personal access only to separately authorized documents), by explicit user confirmation in the project conversation.**

Approved policy in principle:
- On termination becoming effective, revoke operational access and delegated privileges, including schedule, manager, approver, administrative, and other work-related capabilities.
- A personal self-service channel may remain temporarily available only for a separately approved, explicitly allowlisted set of the employee's own documents.
- Access must be read-only unless a distinct policy explicitly authorizes another action; it must not expose other employees' data or general historical records.
- Every request must re-check canonical lifecycle status and the termination-access grant server-side; cached sessions and client state do not establish eligibility.
- When the authorized period expires or the grant is revoked, personal access is denied. Termination does not authorize deletion or alteration of records subject to retention requirements.

**Still required before implementation:** define the maximum access duration, exact document types and fields, delivery/viewing method, identity re-verification, revocation and expiry behavior, retention/legal-hold handling, and synthetic negative tests. No post-termination self-service endpoint or document access is authorized until these details are approved.

### L-04 — Reactivation after suspension or termination

**Question:** What authorization process applies when an employee is reactivated?

**Approved 2026-11-27 — option B (re-verify identity, employment relationship, placement and permissions; restore only newly approved permissions), by explicit user confirmation in the project conversation.**

Approved policy in principle:
- Reactivation does not automatically restore prior sessions, credentials, roles, delegated privileges, approvals, or access grants.
- Before access is restored, the backend must re-verify the employee's identity binding, current employment relationship/lifecycle state, canonical account membership, and current site/department placement.
- Each role, domain permission, organizational scope, and exceptional self-service grant must be explicitly re-authorized under the current policy; historical permissions are not authoritative.
- Previously revoked credentials/sessions remain revoked. Reauthentication and fresh authorization are required.
- Conflicting, duplicate, missing, or ambiguous bindings and lifecycle records fail closed; reactivation must not create a second Employee record merely to bypass prior history.
- Historical records remain governed by their own retention and access rules; reactivation does not broaden historical access.

**Still required before implementation:** define authorized actors and any dual-approval requirement, canonical reactivation state transition and effective timestamp, identity re-verification strength, binding conflict resolution, permission re-approval workflow, and synthetic tests for stale sessions and privilege non-restoration. No automatic permission restoration or reactivation endpoint is authorized until these details are approved.

### L-05 — Archived site or department

**Question:** What happens to employee access and records when a site or department is archived?

**Approved 2026-11-27 — option B (block operations in the archived organizational unit, preserve history, and require explicit reassignment before granting new access), by explicit user confirmation in the project conversation.**

Approved policy in principle:
- Once archival becomes effective, new operational actions and ordinary current-scope access through that site/department are blocked.
- Historical records and canonical placement history are retained according to their applicable retention rules; archival is not deletion and does not rewrite prior assignments.
- Employees are not automatically moved to a primary or replacement site/department.
- A new assignment must be explicitly created and approved through the canonical assignment workflow before new organizational access is granted.
- Access to historical records remains separately permissioned and time/scope constrained; archiving does not grant broad archive-reading privileges.
- Every request must check the current lifecycle state of the account, site and department server-side; missing, archived, or ambiguous states fail closed.

**Still required before implementation:** define archival authority and approval, effective timestamp/timezone, handling of open shifts and pending proposals, whether an archived unit can be restored, how employees are reassigned when no active destination exists, and synthetic tests for blocked operations and preserved historical access. No automatic transfer, deletion, or new archive endpoint is authorized by this decision.

### L-06 — UID-to-employee binding revocation and reassignment

**Question:** What happens when an account's UID-to-employee binding is revoked or needs to be reassigned?

**Approved 2026-11-27 — option B (revoke the binding immediately, preserve historical records, and allow a new binding only after verification and two-person approval), by explicit user confirmation in the project conversation.**

Approved policy in principle:
- Revocation immediately ends the revoked UID's authority to access the employee record through that binding. Requests relying on a revoked, missing, duplicate, or ambiguous binding fail closed.
- Historical employee records, prior assignments, and audit history are preserved under their applicable retention rules. Revocation is not deletion and does not rewrite historical actor or ownership references.
- A replacement binding is never inferred from email address, display name, client state, or other mutable identifiers; no automatic relinking is permitted.
- A new binding requires identity re-verification, confirmation of the canonical employee record and current employment/lifecycle state, and approval by two distinct authorized administrators.
- The binding must be unique and atomically established by the backend. Conflicting or duplicate bindings block the operation pending controlled resolution; creating a second employee profile to bypass the conflict is prohibited.
- All authorization checks use the current backend-owned binding state on each request; stale sessions or cached client state cannot preserve access after revocation.

**Still required before implementation:** define authorized revocation initiators and approval roles, identity re-verification strength, treatment of pending shift/absence proposals and delegated privileges, conflict-resolution and recovery workflow, effective timestamp, session/token invalidation guarantees, audit event fields and retention, and synthetic Emulator tests for immediate denial, duplicate/conflicting bindings, atomic reassignment, and stale sessions. This decision does not authorize a production binding endpoint or automatic data migration.

### L-07 — Role and privilege changes

**Question:** How should previously granted privileges be handled when an administrator changes a user's role or organizational scope?

**Approved 2026-11-27 — option B (immediately revoke privileges no longer authorized and check the current role and scope server-side on every request), by explicit user confirmation in the project conversation.**

Approved policy in principle:
- A role or scope change takes effect at its canonical backend effective time; privileges not present in the newly approved permission set are denied immediately for subsequent requests.
- Every request must resolve the current backend-owned account lifecycle, role grants, domain/action permissions, and organizational scope. Client claims, cached roles, UI visibility, and stale session state are never authorization evidence.
- Newly granted privileges are available only after the change has passed the required authorization/approval workflow and the backend has committed the canonical grant.
- In-flight and pending operations must be re-authorized at commit/execution time; a proposal created under an earlier role cannot be executed using obsolete privileges.
- Audit records must capture the actor, target, approved role/scope change, effective time, and outcome without copying sensitive payloads.
- If the current role, scope, grant revision, or effective state is missing, stale, conflicting, or ambiguous, access fails closed.

**Still required before implementation:** define role taxonomy and permission mapping, authorized change initiators and approval requirements (including separation of duties), effective-time/timezone semantics, handling of active sessions and in-flight operations, cache/token invalidation strategy, pending proposals, audit retention, and synthetic Emulator tests proving immediate denial of removed privileges and correct activation of approved new grants. This decision does not authorize a production role-management endpoint or automatic privilege restoration.

### L-08 — Temporary delegation

**Question:** How should a temporary delegation (for example, a manager assigning selected responsibilities to a substitute) be represented and enforced?

**Approved 2026-11-27 — option B (explicit delegation limited to authorized functions and scope, with automatic expiry and early revocation), by explicit user confirmation in the project conversation.**

Approved policy in principle:
- A delegation must be an explicit, backend-owned grant naming the delegator, delegate, permitted functions/actions, organizational scope, start time, expiry time, and approval/audit references.
- A delegate receives only the enumerated delegated capabilities, never the delegator's entire role or general privilege set. The delegation cannot exceed the delegator's own currently authorized permissions and scope.
- Delegations are time-bounded and expire automatically at the recorded end time. They may also be revoked earlier; after expiry or revocation, subsequent requests using the delegation are denied.
- Each request must verify the current lifecycle and authorization state of both delegator and delegate, the delegation status and time window, and the target resource's canonical scope. Missing, expired, revoked, stale, or ambiguous delegation state fails closed.
- Delegated actions are attributed to the actual delegate and audited with the delegation reference; the delegator is recorded as the source of authority where needed. A delegate cannot impersonate the delegator.
- No sub-delegation or transfer of a delegation is allowed unless a separate policy explicitly approves it.
- Changes or revocation of the delegator's underlying role, scope, account status, or relevant permission must not leave a broader or stale delegated grant in force.

**Still required before implementation:** define who may create, approve, revoke, and receive delegations; whether independent approval/two-person control is required for particular actions; exact delegable action list and prohibited actions; scope constraints; start/end time and timezone semantics; handling of pending/in-flight work; notification and audit requirements; and synthetic Emulator tests for expiry, early revocation, role/scope changes, and attempts to exceed the delegator's authority. This decision does not authorize a production delegation endpoint or automatic role inheritance.

### L-09 — Emergency break-glass access

**Question:** May an authorized person obtain exceptional access during a serious incident when the normal administrator or approval path is unavailable?

**Approved 2026-11-27 — option B (temporary, justified, narrowly scoped and audited emergency access, with notification and independent retrospective review), by explicit user confirmation in the project conversation.**

Approved policy in principle:
- Break-glass is an exceptional incident capability, not a standing role or a shortcut around ordinary approvals.
- Each activation must record the requesting actor, incident/ticket reference, specific emergency purpose, target domain/resources, exact actions and scope, start time, and automatic expiry.
- Access is least-privilege and time-bounded. It cannot exceed the explicitly approved emergency action set and must be revoked automatically at expiry or earlier when the incident need ends.
- The system must notify designated security/oversight recipients promptly and create tamper-resistant audit evidence of activation, use, denied attempts, revocation and expiry.
- An independent authorized reviewer, who was not the activating actor, must review the access and its actions after the incident within a defined review window. Unreviewed or anomalous use is escalated.
- Emergency access does not grant access to health/absence reasons, credentials, authentication secrets, private keys, payment instruments, or other expressly excluded sensitive data. It does not permit disabling audit, changing audit history, creating persistent accounts, or silently broadening privileges.
- Every request must verify the emergency grant's current status, scope, action, incident validity and expiry server-side; missing, expired, revoked, or ambiguous state fails closed.
- Where technically possible, break-glass access must be separated from the ability to approve one's own actions or alter the controls that record and review the emergency session.

**Still required before implementation:** define severity/incident criteria, eligible actors and activation authentication, whether one-person activation is ever permitted or dual control is required, exact domain/action allowlist, excluded data, maximum duration and renewal rules, notification recipients and delivery guarantees, independent reviewer and review deadline, escalation and sanctions, audit retention, and synthetic Emulator tests for expiry, revocation, notification, scope enforcement and independent review. This decision does not authorize a production break-glass endpoint or any emergency bypass of authentication, audit, or server-side authorization.

### L-10 — Sensitive data corrections

**Question:** How may an employee request correction of sensitive personal or employment data held in the canonical system?

Possible choices:
- **A. Direct self-edit:** the employee directly changes sensitive fields on their own profile.
- **B. Tracked correction request:** the employee submits a correction request; an authorized operator verifies it, an authorized approver approves it, and the resulting change is applied and recorded with history.
- **C. Administrator direct edit:** any administrator may directly change sensitive employee data.

**Approved 2026-11-27 — option B (tracked correction request with verification, approval and recorded change history), by explicit user confirmation in the project conversation.**

Approved policy in principle:
- Employees may submit a correction request for their own data, but the request itself does not change the canonical record or grant direct write access.
- Each request must identify the target employee record through the authenticated user's unique, active backend-owned UID↔Employee binding; a client-supplied employee ID is not proof of ownership.
- An authorized operator must verify the request against an appropriate authoritative source and record the verification outcome. An authorized approver must approve or reject the proposed correction before any canonical change is applied.
- The person who requested or prepared a correction must not approve their own request. Verification, approval and application must be server-authorized, with separation of duties appropriate to the field's sensitivity.
- Only the explicitly approved fields may be changed. The backend applies the approved correction atomically, with concurrency/revision checks; no client-side direct update or general document replacement is permitted.
- The system must retain an auditable correction history, including request reference, target record reference, field identifiers, requester, verifier, approver, timestamps, decision, application outcome and revision references. Sensitive old/new values must not be copied into broadly readable logs; any retained value history must be access-restricted and governed by retention policy.
- Rejected, withdrawn, expired, conflicting or incomplete requests do not alter canonical data. Duplicate or ambiguous identity bindings, insufficient evidence, stale revisions, or uncertain authority fail closed.
- This workflow does not authorize bulk correction, arbitrary administrator edits, correction of another employee's data without a separately authorized process, or changes to permissions, roles, bindings, audit records or lifecycle state.

**Still required before implementation:** define the sensitive field catalogue and correction eligibility per field; acceptable evidence and verification standards; authorized operator and approver roles and separation-of-duties rules; request states, deadlines, withdrawal and dispute handling; atomic application and conflict resolution; notifications; restricted history access and retention; and synthetic Emulator tests for unauthorized edits, self-approval, forged ownership, stale revisions, rejected requests and audit completeness. No correction endpoint or direct sensitive-field mutation is authorized until these details are approved and tested.

### L-11 — Data deletion and retention

**Question:** How should the system handle an employee's request to delete personal data when some records may be subject to legal, contractual, accounting, security or other retention requirements?

Possible choices:
- **A. Immediate deletion:** delete the employee's data immediately upon request.
- **B. Tracked request and retention review:** verify the request and applicable retention obligations; delete or anonymize only data that no longer needs to be retained; record the decision and outcome.
- **C. Administrator-only discretion:** no deletion is performed on request; an administrator decides without a defined review workflow.

**Approved 2026-11-27 — option B (tracked request, retention review, deletion or anonymization where permitted, and recorded outcome), by explicit user confirmation in the project conversation.**

Approved policy in principle:
- A request must be authenticated, attributable to the requester, scoped to the requester's own data through the canonical identity/binding process, and tracked to a documented outcome.
- Before deletion, an authorized reviewer must identify the relevant data categories and assess applicable retention duties, legal holds, active disputes, security/audit requirements and other documented reasons for continued retention. A request does not itself authorize immediate deletion.
- Data that is no longer necessary and is not subject to a valid retention requirement must be deleted or, where deletion is not appropriate or feasible, irreversibly anonymized using an approved process.
- Data that must be retained remains restricted to its approved purpose, access scope and retention period. The requester must receive an appropriate explanation of any refusal, partial fulfillment or deferred deletion, without disclosing protected information.
- Deletion/anonymization must cover defined copies and derivatives under system control, including applicable indexes, caches, exports, attachments and backups according to documented lifecycle and backup-expiry procedures. No claim of complete erasure may be made where retained backups or legal holds remain.
- Referential integrity and legally required records must be handled through an explicit, reviewed retention/anonymization design; deletion must not silently rewrite audit history or falsify historical events.
- The system must retain a minimized record of the request, review basis, decision, categories affected, actions performed or deferred, responsible actors, timestamps and outcome. This evidence must not unnecessarily reproduce the personal data being deleted.
- The workflow must distinguish deletion from account deactivation, access revocation, correction, archival and anonymization. These operations are not interchangeable.
- No administrator may bypass the review, retention controls, approval requirements or audit trail through direct database edits or broad deletion operations.

**Still required before implementation:** define data categories and canonical locations, applicable retention schedules and legal-hold rules with qualified review, authorized request/review/approval roles and separation of duties, identity verification, response deadlines and appeal handling, deletion/anonymization standards, treatment of backups and third-party processors, propagation to exports and derived data, minimized audit evidence, and synthetic Emulator tests for partial fulfillment, retention holds, unauthorized deletion, scope errors and verifiable completion. No deletion endpoint, bulk purge or automatic account/data erasure is authorized until these details are approved and tested.

### L-12 — Employee access during a dispute

**Question:** What information may an employee access when disputing a record or decision concerning them?

Possible choices:
- **A. Full immediate access:** provide all related data and logs without filtering.
- **B. Tracked, relevant access:** provide only information relevant to the dispute, with appropriate redaction of third-party and restricted content.
- **C. Administrator-mediated access only:** the employee cannot directly consult dispute-related information.

**Approved 2026-11-27 — option B (tracked access to dispute-relevant information, with redaction of third-party and restricted content), by explicit user confirmation in the project conversation.**

Approved policy in principle:
- A dispute-related access request must be authenticated, attributable to the employee, linked to a defined dispute or review reference, and limited to records concerning that employee and the issue raised.
- Access is limited to information reasonably relevant to understanding and challenging the disputed record or decision. It does not create general access to the employee's entire profile, payroll, absence history, audit trail, or unrelated records.
- Information concerning other employees or third parties, confidential security controls, credentials, secrets, privileged material, and unrelated sensitive content must be excluded or appropriately redacted.
- Where an explanation or meaningful extract can satisfy the request, raw internal logs, unrestricted database documents and full audit payloads must not be disclosed.
- The response must preserve context sufficient to make the information understandable, including relevant dates, status, decision basis and correction/review path where disclosure is authorized.
- Each request, review, disclosure, redaction and refusal must be recorded with minimized metadata. Access to the disclosure workflow is itself authorized and audited.
- The person reviewing or approving disclosure must have an explicitly authorized role and must not use the process to alter the disputed source record. Corrections follow L-10; deletion/retention requests follow L-11.
- Dispute access does not suspend ordinary retention rules or authorize alteration/deletion of evidence. Where preservation is required, a separately authorized hold must be applied without expanding who may read the held data.
- Missing dispute scope, uncertain identity, mixed records that cannot be safely separated, or unclear disclosure authority fails closed pending review.

**Still required before implementation:** define dispute categories and eligible records, request and response workflow/deadlines, reviewer and approval roles, criteria for relevance and redaction, treatment of third-party/confidential/security information, evidence preservation and legal holds, disclosure format and secure delivery, appeal/escalation, minimized audit fields, and synthetic Emulator tests for cross-employee leakage, overbroad log disclosure, redaction failures and unauthorized record mutation. No dispute-access endpoint or unrestricted audit/log view is authorized until these details are approved and tested.

### L-13 — Security notifications to affected employees

**Question:** Which security-relevant operations concerning an employee should trigger a notification to that employee?

Possible choices:
- **A. Internal audit only:** no employee-facing notifications.
- **B. Minimized notifications for defined relevant events:** notify the affected employee about material events, without disclosing details that could compromise security or an investigation.
- **C. Notify on every access:** notify for every human, technical, and automated access.

**Approved 2026-11-27 — option B (minimized notifications for defined relevant events), by explicit user confirmation in the project conversation.**

Approved policy in principle:
- Maintain an explicit, reviewed event catalogue identifying which material events concerning an employee trigger a notification. Candidate events include sensitive-data changes, access grants or revocations, exceptional/break-glass access where disclosure is safe, and exports of the employee's data where the applicable export policy requires notice.
- Notifications must be minimized and sent through an approved, verified channel. They should identify the event category, relevant time, and a safe way to obtain further information or raise a concern, without exposing sensitive values, credentials, security-control details, or another person's information.
- Do not notify for every routine technical read, background process, or automated access. Such activity remains subject to appropriate internal audit and monitoring.
- A notification may be delayed or withheld only under a documented, authorized exception where immediate disclosure would create a concrete security, legal, or investigation risk. The exception, authorizing role, reason category, review and eventual notification decision must be recorded.
- Notification delivery failure must not silently erase the underlying audit event or be treated as successful delivery. Retry, escalation and channel-failure handling must be defined.
- Notification preferences or channel configuration must not disable mandatory security notices; changes to contact channels require appropriate verification.
- Notification content and delivery metadata must themselves be access-controlled, minimized and retained under a defined policy. Notifications do not grant access to the underlying records or logs.

**Still required before implementation:** define the event catalogue and materiality thresholds; eligible recipients and verified channels; delivery timing, retries and failure escalation; authorized withholding/delay criteria and independent review; message templates and privacy-safe content; retention and audit fields; and synthetic Emulator tests for correct triggering, suppression, delivery failure, recipient isolation and prevention of sensitive-content leakage. No notification endpoint or production delivery integration is authorized until these details are approved and tested.

### L-14 — Evidence preservation and scoped legal holds

**Question:** How should the system preserve records relevant to a dispute, investigation, or other authorized review?

Possible choices:
- **A. No special hold:** ordinary modification and deletion rules continue unchanged.
- **B. Scoped preservation hold:** preserve only relevant records, with restricted access, documented purpose, defined duration and periodic review.
- **C. Broad employee-wide hold:** automatically freeze all of an employee's data until the dispute is finally closed.

**Approved 2026-11-27 — option B (scoped evidence preservation hold with restricted access, documented purpose, defined duration and periodic review), by explicit user confirmation in the project conversation.**

Approved policy in principle:
- A preservation hold must identify the specific matter/reference, purpose, authorized requester and approver, affected data categories/resources, scope, start time, review date and release conditions.
- Preserve only records reasonably relevant to the matter. A hold must not automatically freeze all records belonging to an employee, unrelated business operations, or unrelated individuals.
- A hold preserves evidence; it does not grant general read access, authorize new processing purposes, or expand the roles permitted to view the held records.
- Held records remain subject to least-privilege access, access logging, confidentiality controls and appropriate separation of duties. Access to the hold and any disclosure of held content are separately authorized and audited.
- Ordinary correction, deletion, retention and dispute-access workflows must recognize an active applicable hold and prevent destructive changes to held evidence. Any permitted correction must preserve the original evidentiary record and record the correction separately; no silent overwrite or alteration of audit history is permitted.
- Each hold must have a defined review schedule and end condition. Extensions require documented justification and authorized approval. Once the hold is released and no other retention duty applies, the normal retention/deletion policy resumes.
- Holds must be scoped and enforced server-side against canonical record references and data categories. Client-supplied flags or references cannot create, broaden, extend or release a hold.
- Missing authority, ambiguous scope, expired approval, or conflicting hold state fails closed for destructive operations on potentially affected evidence, while avoiding an unjustified blanket access freeze.

**Still required before implementation:** define eligible matter types and legal/privacy review; authorized initiators and independent approvers; canonical hold identifiers and resource/category mapping; conflict handling with correction/deletion/retention workflows; review intervals, extensions and release authority; access and disclosure roles; audit and retention requirements; and synthetic Emulator tests for scope isolation, unauthorized hold creation/release, expiry, extension, correction while held, and prevention of evidence alteration. No hold endpoint, automatic employee-wide freeze, or production legal-hold integration is authorized until these details are approved and tested.

### L-15 — Administrator access to employee data

**Question:** What principle governs administrative access to employee personal and employment data?

Possible choices:
- **A. Universal administrator access:** every administrator may read and modify all employee data.
- **B. Least-privilege administrative access:** administrators receive only the domains and actions necessary for their assigned duties, with separate permissions, audit and independent controls for sensitive operations.
- **C. Unrestricted primary administrator:** one primary administrator may access everything without additional approval.

**Approved 2026-11-27 — option B (least-privilege, duty-specific administrative access with separate permissions, audit and independent controls), by explicit user confirmation in the project conversation.**

Approved policy in principle:
- An administrator role, account ownership, or technical ability to operate the system does not by itself grant access to employee personal, compensation, absence, identity, audit, or other protected data.
- Administrative capabilities must be separated by domain and action, and granted only where required for a documented operational responsibility. Read, create, change, approve, export, delete, and security/audit access remain distinct permissions.
- Administrative scope must be explicit and enforced server-side for every request. Organization-wide scope is not implied by an administrator label.
- Sensitive operations require the applicable independent approval, separation-of-duties, verification and audit controls; no administrator may approve their own sensitive request or bypass an established workflow.
- Technical service identities and backend execution privileges must not be exposed as interactive human access. Server-side code must enforce business authorization even where infrastructure credentials can bypass database security rules.
- Emergency access remains governed by L-09; correction, deletion, dispute access and preservation remain governed by L-10 through L-14. This decision does not weaken those controls or authorize blanket access.
- Administrative access itself must be logged with minimized metadata, reviewed periodically, and revoked promptly when the role, duty, scope or employment relationship no longer justifies it.
- Unknown roles, permissions, scopes, or actions fail closed. No direct database edit or alternate administrative interface may bypass the approved authorization path.

**Still required before implementation:** define the administrative role and duty catalogue; map each role to exact domains, actions and scopes; identify high-risk operations requiring independent approval or dual control; specify service-identity boundaries and privileged-access procedures; define periodic access review and revocation; and add synthetic Emulator tests for cross-domain denial, scope escalation, self-approval, direct-write bypass and stale privilege revocation. No universal administrator permission or production administrative endpoint is authorized until these details are approved and tested.

### L-16 — Periodic access reviews and event-driven permission review

**Question:** How often should user and administrator permissions be reviewed, and which events require an immediate review?

Possible choices:
- **A. Issue-driven only:** review access only after a reported problem.
- **B. Scheduled and event-driven review:** perform periodic reviews and additional reviews after transfers, role changes, suspension, or termination; promptly revoke permissions that are no longer justified.
- **C. Annual review only:** review once per year without intermediate event-driven checks.

**Approved 2026-11-27 — option B (scheduled and event-driven access reviews with prompt revocation of unjustified permissions), by explicit user confirmation in the project conversation.**

Approved policy in principle:
- All human and delegated access grants must have an identifiable owner, purpose, domain/action set, organizational scope, approval reference, effective time and review status.
- Access must be reviewed on a defined recurring schedule and additionally whenever a relevant lifecycle or organizational event occurs, including transfer, role or duty change, suspension, termination, reactivation, scope change, delegation expiry/revocation, and site/department archival or reassignment.
- A triggering event must cause affected grants and pending delegated capabilities to be re-evaluated against the current canonical role, lifecycle, membership and placement state. Permissions no longer justified must be revoked promptly; no stale privilege may remain valid merely because its scheduled review date has not arrived.
- Reviewers must be authorized and sufficiently independent from the grant requester or beneficiary for sensitive privileges. High-risk permissions require documented approval and, where defined, dual control.
- Each review must record the reviewer, review time, grants and scopes examined, decision, justification, exceptions, remediation owner and completion status. Unreviewed, overdue, ambiguous or unsupported grants must be restricted or revoked according to a fail-closed policy.
- Review evidence must be minimized and must not unnecessarily copy employee personal data, credentials, tokens or sensitive payloads.
- Service identities and automated grants must also have an accountable owner, documented purpose, bounded permissions and periodic review; technical credentials do not create human data-access rights.
- Access review does not itself grant, expand or renew a permission. Any new or expanded privilege must follow the applicable authorization and approval workflow.

**Still required before implementation:** define review frequency by privilege risk, review owners and independence rules, event sources and delivery guarantees, revocation service-level targets, treatment of pending/in-flight operations and delegations, overdue-review escalation, exception handling, service-identity inventory, audit retention, and synthetic Emulator tests for transfer/role/lifecycle triggers, stale grants, missed events, overdue reviews and revocation propagation. No scheduled review job or production revocation integration is authorized until these details are approved and tested.

### L-17 — Security log integrity and protection

**Question:** How must logs recording access, changes, approvals and administrative operations be protected?

Possible choices:
- **A. Ordinary mutable logs:** administrators may edit or delete log records.
- **B. Append-only protected logs:** prevent unauthorized alteration and deletion, restrict access, verify integrity and define retention.
- **C. Broad administrator access:** make log copies available to all administrators for independent inspection.

**Approved 2026-11-27 — option B (append-only protected security logs with restricted access, integrity verification and defined retention), by explicit user confirmation in the project conversation.**

Approved policy in principle:
- Security and audit events must be generated by trusted server-side components and written through a controlled append-only path. Ordinary application users and administrators must not be able to edit or delete previously recorded events.
- Log integrity must be protected against unauthorized modification, truncation, deletion, reordering and substitution. The implementation must use an appropriate integrity-verification design, such as cryptographic chaining or signed checkpoints, with protected keys and independently controlled verification material where applicable.
- Append-only behavior in application code or a database API alone is not proof of tamper resistance. Storage permissions, privileged infrastructure access, backup/replication, key custody, administrative break-glass and operational procedures must be included in the threat model and independently reviewed.
- Access to read, search, export, retain, archive or administer logs must be separately authorized and scoped. No universal administrator read or write access is implied. Access to the logs themselves must also be audited.
- Log content must be minimized: do not record passwords, authentication tokens, secrets, private keys, payment credentials, unnecessary personal data, full document contents or sensitive before/after payloads. Use stable references and event metadata only where sufficient.
- Corrections to erroneous event interpretation must be recorded as new linked events; historical records must not be silently overwritten. Any legally required deletion or retention exception must follow a separately approved, auditable process and preserve integrity evidence to the extent lawful.
- Retention, archival, backup and disposal must follow a defined schedule and applicable legal holds. Integrity verification must be possible throughout the retention period, with documented handling of verification failures and missing log segments.
- Monitoring, alerting and incident response must detect and escalate suspected gaps, integrity failures, unauthorized access and attempts to disable or bypass logging. A system operation that requires an audit event must fail safely if the required audit write cannot be completed, according to a documented availability/security policy.

**Still required before implementation:** define event taxonomy and required fields; select and review the storage and cryptographic integrity design; establish key custody and rotation; separate log writer, reader, verifier and retention-administrator duties; define access scope, retention, archival, backup and lawful deletion; specify alerting, failure behavior and incident response; and add synthetic Emulator/integration tests for tampering, truncation, replay, unauthorized deletion, privilege escalation, missing events and integrity verification. No production immutable-log service or audit export endpoint is authorized until these details are approved and tested.

### L-18 — Technical support access to employee data

**Question:** What access should technical support personnel have when diagnosing or resolving a system issue?

Possible choices:
- **A. Full data access:** support personnel may inspect all employee data to make troubleshooting easier.
- **B. Minimized diagnostics by default:** use synthetic or minimized data; exceptional access to real data only when strictly necessary, specifically authorized, time-limited and audited.
- **C. Unrestricted support access:** any assigned technician may freely access all data.

**Approved 2026-11-27 — option B (synthetic/minimized diagnostics by default; exceptional, necessary, authorized, time-limited and audited access to real data), by explicit user confirmation in the project conversation.**

Approved policy in principle:
- Support workflows must use synthetic fixtures, redacted diagnostics, aggregate metrics and technical metadata wherever reasonably sufficient. Production data must not be copied into development, test, ticketing, chat, email or external support systems as a routine troubleshooting method.
- Support role or employment by a vendor does not itself grant permission to read employee, payroll, absence, identity, document or other personal data. Technical access and business-data access must be separately authorized.
- If access to real data is demonstrably indispensable, require a documented support case/incident reference, specific purpose, narrowly identified records and fields, named individual, approved actions, start and expiry, and approval by an authorized data owner/security approver independent of the requester where practicable.
- Access must be read-only by default, least-privilege and scoped to the minimum records, fields and duration. Any write, correction, export, impersonation or privileged operation requires a distinct authorization and approval; this decision does not authorize those capabilities.
- Access must be performed through controlled, individually attributable identities with strong authentication. Shared accounts, credential sharing, unlogged impersonation and bypassing application authorization are prohibited. Support access must not bypass server-side domain, field, ownership, lifecycle or scope checks.
- Every request, approval, access start, relevant read/action, extension, denial, expiry and revocation must be audited without copying sensitive payloads into the audit trail. Access must be monitored and reviewed after completion; unexpected access or scope expansion must be escalated.
- Access expires automatically at the approved end time and must be revocable earlier. Extensions require renewed justification and approval. The support provider must be bound by confidentiality, security, data-handling and deletion obligations appropriate to its role.
- Where the issue can be diagnosed with synthetic data, the support workflow must not expose production data. Screenshots, recordings, traces and diagnostic bundles must be screened and minimized before disclosure.

**Still required before implementation:** define eligible support roles and providers; approved case categories and approvers; identity/authentication and just-in-time grant workflow; exact data domains/fields and permitted actions; technical controls against broad queries, bulk export and unlogged impersonation; expiry/revocation and monitoring; vendor access, confidentiality and deletion requirements; evidence handling and incident escalation; and synthetic Emulator tests for scope enforcement, attribution, expiry, revocation, export denial and audit completeness. No production support-access or impersonation endpoint is authorized until these details are approved and tested.

### L-19 — Analytics, automation and AI tools

**Question:** How may employee data be used with analytics, automation and artificial-intelligence tools?

Possible choices:
- **A. Unrestricted disclosure:** company and personal data may be freely submitted to tools in use.
- **B. Synthetic/anonymized by default:** real data only for an authorized purpose, with minimization, provider review, security controls and audit.
- **C. Unrestricted enterprise-tool access:** all enterprise AI tools may access all data without distinction by domain or purpose.

**Approved 2026-11-27 — option B (synthetic or anonymized data by default; real data only for an authorized purpose with minimization, provider review, security controls and audit), by explicit user confirmation in the project conversation.**

Approved policy in principle:
- Use synthetic data for development, testing, demonstrations, prompt evaluation and routine troubleshooting. Where appropriate, use anonymized or aggregated data only after assessing whether re-identification remains reasonably possible. Pseudonymized data remains personal data and must not be treated as anonymous.
- Do not submit passwords, access tokens, API keys, private keys, authentication material, secrets, payment credentials or other security credentials to analytics, automation or AI tools.
- Do not submit identifiable employee, payroll, absence, health, identity-document, disciplinary, banking or other sensitive data unless a specific lawful and authorized purpose has been documented and the relevant data owner/privacy and security approvals have been obtained.
- Before any real-data use, assess necessity, proportionality, field-level minimization, recipient/provider role, data location and transfers, retention, deletion, backups, subprocessors, access controls, encryption, training/model-improvement use, human review and incident notification. Contractual and technical protections must match the sensitivity and purpose.
- Tool availability, an enterprise subscription, user consent to a product feature, or a vendor's general security statement does not by itself authorize a particular data disclosure or processing purpose.
- Apply least privilege and purpose limitation to connected applications, plugins, agents, APIs, automation identities and retrieval indexes. Grant only the minimum domain, records, fields, operations and duration required. Revalidate permissions at execution time; do not let an agent infer authority from prompt content or data it can retrieve.
- Prohibit unrestricted bulk export, cross-tenant or cross-domain retrieval, secondary use, model training or provider retention beyond the approved purpose unless separately assessed and expressly authorized.
- Record the approved use case, responsible owner, tool/provider, data categories, scope, approval, retention and review date. Audit access and material automated actions without copying sensitive source payloads into logs.
- Human approval is required before consequential changes to employee records, compensation, shifts, absence status, permissions or employment lifecycle. AI-generated output is advisory unless a separately approved workflow authorizes a bounded action with validation, authorization and audit.
- Provide a process to revoke tool connections and credentials, remove or expire indexes/caches where applicable, respond to provider incidents and verify deletion/retention outcomes. Do not assume that deleting a source record automatically deletes all derived copies.

**Still required before implementation:** maintain an inventory and risk classification of tools/providers and connected data flows; define prohibited and conditionally permitted data categories; establish lawful-purpose and privacy/security review gates; assess provider terms, data residency/transfers, retention, training use and subprocessors; define connector scopes, service identities, secret handling, human approvals and revocation; define audit and incident response; and add synthetic Emulator/integration tests for access boundaries, cross-domain retrieval denial, export restrictions, prompt-injection resistance, authorization revalidation and revocation. No production AI connector, automated employee-data processing or real-data upload is authorized until these details are approved and tested.

### L-20 — Security incident response

**Question:** What procedure must apply when a potential security incident is detected, such as unauthorized access, data loss, compromised credentials or audit-log tampering?

Possible choices:
- **A. Informal administrator response:** administrators handle incidents without mandatory centralized recording.
- **B. Documented incident-response procedure:** reporting, classification, containment, evidence preservation, impact assessment, required notifications, recovery and post-incident review.
- **C. Blanket automatic shutdown:** automatically block all accounts and delete suspicious data.

**Approved 2026-11-27 — option B (documented incident response with reporting, classification, containment, evidence preservation, impact assessment, required notifications, recovery and post-incident review), by explicit user confirmation in the project conversation.**

Approved policy in principle:
- Establish a documented process for reporting, triaging, classifying, escalating, investigating, containing, eradicating, recovering from and reviewing suspected or confirmed security incidents.
- Provide a clear reporting channel and on-call/escalation ownership. Preserve the original report, timestamps, decisions, approvals and incident timeline in an access-controlled incident record.
- Classify incidents by affected systems, data domains, confidentiality, integrity, availability, scope, severity and potential impact. Treat uncertainty as a reason to investigate and apply proportionate protective measures, not as proof that an incident has or has not occurred.
- Contain threats promptly and proportionately: revoke or rotate compromised credentials, suspend affected sessions or grants, isolate affected components, restrict risky integrations and disable vulnerable operations where justified. Avoid indiscriminate account shutdowns or destructive deletion when narrower containment is effective.
- Preserve relevant evidence with chain-of-custody records, trusted timestamps, access restrictions and integrity checks. Do not alter or destroy potentially relevant logs, records, backups or devices except through an authorized, documented process that preserves evidence and meets legal obligations.
- Assess affected people, records, systems, providers and downstream recipients. Identify data types, approximate scope, access/exfiltration evidence, time window, persistence, integrity impact and any continuing exposure. Record known facts, assumptions, gaps and confidence separately.
- Escalate promptly to designated security, privacy, legal, operational and business owners. Determine and meet applicable contractual, regulatory and statutory notification obligations and deadlines through authorized decision-makers; do not assume that every incident requires the same notification or that notification can be deferred without assessment.
- Coordinate with service providers and subprocessors under documented incident-notification, cooperation, evidence-preservation and remediation requirements. Record provider actions and dependencies.
- Restore services only after containment and recovery checks, including credential rotation, vulnerability remediation, integrity validation, permission review, monitoring and safe restoration of backups. Do not restore compromised privileges or stale sessions.
- Conduct a post-incident review proportionate to severity, documenting root causes, control failures, impact, response timing, lessons, corrective actions, owners and due dates. Track actions to closure and verify their effectiveness.
- Keep incident records and evidence access restricted on a need-to-know basis. Audit access and disclosure; minimize sensitive personal data in incident tickets and reports. Do not expose secrets or full employee-data payloads in general support channels.
- Exercise the procedure using synthetic scenarios, including account compromise, unauthorized employee-data access, audit-log integrity failure, provider compromise, accidental disclosure and loss of availability.

**Still required before implementation:** appoint incident commander and functional owners; define severity levels, reporting channels and response-time targets; establish decision authority for containment, suspension and recovery; define evidence handling, chain of custody and legal-hold coordination; map notification obligations and approval workflow; define provider escalation and communications; establish recovery criteria, post-incident review and corrective-action tracking; and add synthetic tabletop/Emulator exercises. No blanket account shutdown, destructive evidence deletion or production incident automation is authorized by this decision alone.

### L-21 — Business continuity, backups and recovery

**Question:** How should backups and recovery be handled after a major outage, ransomware incident or system failure?

Possible choices:
- **A. Irregular backups:** backups are not scheduled consistently and recovery is manual when needed.
- **B. Protected, tested recovery:** scheduled and protected backups, separate copies, periodic restore tests, defined RPO/RTO objectives and integrity checks.
- **C. Continuous replication without restore tests:** replication alone is considered sufficient for continuity.

**Approved 2026-11-27 — option B (scheduled and protected backups, separate copies, periodic restore tests, defined RPO/RTO objectives and integrity checks), by explicit user confirmation in the project conversation.**

Approved policy in principle:
- Establish documented backup and recovery plans for each in-scope system and data domain, based on business impact, data sensitivity, dependencies and approved recovery priorities.
- Define and approve Recovery Point Objectives (RPO) and Recovery Time Objectives (RTO) for each critical service and dataset. Targets must be realistic, measurable and periodically reviewed; no numeric target is implied by this decision.
- Schedule backups according to approved RPOs and data-change rates. Monitor completion, failures, duration, capacity and backup age; alert and escalate missed or incomplete backups.
- Maintain separate, access-controlled backup copies with isolation from production credentials and administrative planes. Protect backup data against unauthorized alteration, deletion, ransomware and premature expiry; use encryption and separately managed keys where appropriate.
- Apply least privilege and separation of duties to backup creation, restoration, retention administration and key management. Backup operators must not automatically gain unrestricted access to the underlying business data.
- Preserve backup integrity and provenance through checksums, manifests, authenticated metadata or other reviewed mechanisms. Verify backup readability and completeness; replication alone is not a substitute for independent backup and restore testing.
- Perform periodic restore tests in an isolated environment using synthetic or appropriately protected data. Test full and partial restoration, application consistency, dependencies, identity/access controls, audit continuity and recovery sequencing. Record outcomes, elapsed times, data loss against RPO, gaps and remediation.
- Define recovery procedures for ransomware and compromise, including clean recovery points, isolation, credential/key rotation, vulnerability remediation and checks against reinfection before reconnecting systems.
- Coordinate restoration with incident response, evidence preservation, legal holds and retention obligations. Do not overwrite potentially relevant evidence or restore compromised privileges and stale sessions.
- Protect backup copies and restore environments against unauthorized access and data leakage. Limit test data exposure; sanitize or securely dispose of temporary restore copies when no longer required.
- Document recovery owners, approval authority, communications, dependencies, runbooks, escalation paths and fallback procedures. Review plans after material architecture or threat changes and after exercises or real incidents.

**Still required before implementation:** inventory systems, datasets and dependencies; classify criticality; approve per-service RPO/RTO and retention schedules; select backup frequency, topology, isolation and immutability controls; define encryption and key custody; establish monitoring and failure escalation; define clean-room recovery and restore approval; set test frequency, scope and success criteria; and add synthetic restore exercises with recorded evidence. No production backup service, retention change or recovery operation is authorized by this policy decision alone.

Other lifecycle decisions remain open and fail closed:
- leave and other lifecycle transitions;
- account archive/restoration and archived-unit restoration;
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
| L-01 Transfer and prior-manager historical access | Approved — option B limited to operational records within former assignment interval; implementation gated on temporal semantics and tests |
| L-02 Suspension access | Approved — option B operational access revoked; narrowly necessary self-service only if separately authorized; implementation gated on status/revocation details |
| L-03 Termination access | Approved — option B operational access revoked; temporary, limited personal document access only if separately authorized; implementation gated on duration/document allowlist/revocation |
| L-04 Reactivation | Approved — option B re-verify identity, employment, placement and permissions; restore only newly approved permissions; implementation gated on transition/approval details and tests |
| L-05 Archived site/department | Approved — option B block operations, preserve history, require explicit reassignment; implementation gated on archival semantics, open-work handling and tests |
| L-06 UID/employee binding revocation | Approved — option B immediate revocation, preserve history, rebind only after verification and two-person approval; implementation gated on workflow, conflict handling and tests |
| L-07 Role/privilege changes | Approved — option B immediately revoke obsolete privileges and recheck current role/scope server-side; implementation gated on role mapping, effective-time semantics and tests |
| L-08 Temporary delegation | Approved — option B explicit, scoped and time-limited delegation with expiry and early revocation; implementation gated on delegable actions, approval workflow and tests |
| L-09 Emergency break-glass | Approved — option B temporary, justified, scoped and audited access with notification and independent review; implementation gated on incident criteria, action allowlist and oversight workflow |
| L-10 Sensitive data corrections | Approved — option B tracked request, operator verification, separate approval and recorded change history; implementation gated on field catalogue, workflow and tests |
| L-11 Data deletion and retention | Approved — option B tracked request, retention review, permitted deletion/anonymization and recorded outcome; implementation gated on retention rules, scope and tests |
| L-12 Employee access during a dispute | Approved — option B tracked access to relevant records with third-party/restricted-content redaction; implementation gated on scope, disclosure workflow and tests |
| L-13 Security notifications | Approved — option B minimized notices for defined material events; implementation gated on event catalogue, channel, exception and delivery controls |\n| L-14 Evidence preservation and scoped holds | Approved — option B scoped preservation with restricted access, defined duration and review; implementation gated on authority, scope, lifecycle and tests |\n| L-15 Administrator access to employee data | Approved — option B least-privilege, duty-specific permissions with independent controls; implementation gated on role/action/scope mapping and tests |\n| L-16 Periodic and event-driven access reviews | Approved — option B scheduled and lifecycle-triggered reviews with prompt revocation; implementation gated on cadence, ownership, event and revocation controls and tests |\n| L-17 Security log integrity and protection | Approved — option B append-only protected logs with restricted access and integrity verification; implementation gated on storage, key, retention, access and test design |\n| L-18 Technical support access | Approved — option B minimized diagnostics by default; exceptional real-data access strictly necessary, authorized, time-limited and audited; implementation gated on roles, scope, workflow and tests |\n| L-19 Analytics, automation and AI tools | Approved — option B synthetic/anonymized by default; real data only with authorized purpose, minimization, provider/security review and audit; implementation gated |\n| L-20 Security incident response | Approved — option B documented response lifecycle; implementation gated on owners, severity, authority, evidence, notifications, recovery and exercises |\n| L-21 Business continuity and recovery | Approved — option B protected scheduled backups, separate copies, restore tests, RPO/RTO and integrity checks; implementation gated |\n| Other lifecycle and historical access | Open — fail closed |

## 6. Explicit non-authorization

This record does not grant permissions, approve a role matrix, settle legal/privacy questions, create or migrate records, add Firestore paths, modify Security Rules, implement APIs, connect the operational app, access real collaborator data, configure a real Firebase project, merge, or deploy.

The repository's existing proposal matrix remains proposal-only. This record is a review aid and must not be interpreted as a security certification or as approval by silence.
