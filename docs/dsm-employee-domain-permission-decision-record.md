# Employee data permissions — decision record for review

**Status:** D-01 through D-07 and L-01 through L-74 have recorded policy approvals as detailed below; implementation remains gated on the stated role, scope, schema, workflow, lifecycle, and test requirements. No approval authorizes production activation.
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

### L-22 — Environment separation and promotion controls

**Question:** How should development, test, staging and production environments be separated?

Possible choices:
- **A. Shared environments:** environments share services and similar access privileges for operational convenience.
- **B. Separated environments:** distinct environments, credentials and data, least privilege and controlled promotion of changes between environments.
- **C. Single environment with a mode flag:** one environment is used for all purposes, with a flag distinguishing test from production.

**Approved 2026-11-27 — option B (separated environments, distinct credentials and data, least privilege and controlled promotion), by explicit user confirmation in the project conversation.**

Approved policy in principle:
- Maintain distinct development, test, staging and production environments, with documented purpose, ownership, trust boundaries and permitted data classes for each.
- Use separate projects/accounts or equivalent strong isolation boundaries for production and non-production services, databases, storage, queues, secrets, identity configuration, service identities, encryption keys, backups and external integrations. A client-side flag or UI mode is not an environment security boundary.
- Production credentials, signing keys, tokens and privileged service identities must not be copied into development, test or staging. Non-production identities must not have permissions to access or mutate production resources. Use separate secret stores and access policies.
- Use synthetic data in non-production by default. Production data must not be copied into lower environments unless a specific lawful and authorized purpose, minimization, de-identification, security controls and review have been documented. Pseudonymized data remains personal data.
- Restrict production access to named, authorized personnel and services on a need-to-know basis. Require stronger authentication, audited privileged access and separately approved emergency procedures. Developers must not receive production access merely because they can change application code.
- Promote reviewed, versioned artifacts through controlled stages. Build once where feasible, record provenance, verify integrity, require appropriate review and automated checks, and prevent unreviewed direct edits in production. Production deployment approval must be separate from development permissions.
- Keep environment-specific configuration explicit and validated. Fail closed if an environment is misidentified, a production endpoint is configured in a non-production environment, or an unexpected credential/resource combination is detected.
- Ensure CI/CD runners, build agents, preview deployments and test automation receive only the credentials and network access required for their environment. Protect build pipelines and artifact registries against unauthorized modification.
- Separate logs, monitoring, analytics, backups and incident procedures by environment while retaining enough correlation to investigate cross-environment risks. Do not allow test traffic or test data to contaminate production records.
- Review environment access and configuration periodically and after role, provider, architecture or deployment-pipeline changes. Revoke stale access and rotate credentials after suspected exposure.

**Still required before implementation:** define environment inventory and isolation model; separate cloud/Firebase projects and resource identifiers; configure environment-specific authentication, rules, service identities, secrets and keys; define synthetic fixtures and any exceptional production-data handling; establish CI/CD trust, artifact provenance, approval and rollback controls; define network boundaries, monitoring, backup and incident handling; and add tests proving non-production identities cannot read or mutate production resources and production credentials cannot be used in non-production. No production environment activation, credential provisioning or deployment is authorized by this policy decision alone.

### L-23 — Software dependencies and supply-chain security

**Question:** How should libraries, packages, SDKs and third-party software components be managed?

Possible choices:
- **A. Uncontrolled updates:** dependencies may be added or updated without mandatory review.
- **B. Controlled dependency management:** inventory and pin dependencies, review updates, check vulnerabilities and provenance, maintain lockfiles and review changes.
- **C. Permanent freeze:** prohibit dependency updates after initial installation.

**Approved 2026-11-27 — option B (inventoried and versioned dependencies, controlled updates, vulnerability and provenance checks, lockfiles and change review), by explicit user confirmation in the project conversation.**

Approved policy in principle:
- Maintain an authoritative inventory of direct and transitive dependencies, including package name, version, source/registry, license where relevant, and ownership or usage context.
- Pin reproducible dependency versions and commit the appropriate lockfiles. Changes to manifests, lockfiles, package sources, build tools and install scripts require review.
- Prefer trusted registries and verified package sources; assess package provenance and integrity where supported. Do not install unreviewed artifacts from arbitrary URLs or personal accounts.
- Scan dependencies and relevant build artifacts for known vulnerabilities and malicious or compromised packages. Triage findings by exploitability, exposure and impact; document accepted risks with an owner, rationale, compensating controls and expiry/review date.
- Apply security updates through a controlled, timely process, with compatibility checks and tests. A dependency freeze must not prevent necessary remediation.
- Minimize dependency count and privileges; scrutinize install scripts, native extensions, transitive additions and packages that execute during build or deployment.
- Protect CI/CD, package tokens, artifact registries and release credentials. Use least-privilege, short-lived credentials where feasible; never commit secrets to manifests, lockfiles or source control.
- Record dependency changes and their review in the normal version-control history. Preserve enough build and artifact provenance to identify the dependency set used for a release and support rollback or incident investigation.
- Reassess dependencies when vulnerabilities, maintainer changes, registry incidents, licensing changes or end-of-life notices arise. Remove unused and unsupported components through reviewed changes.
- Use synthetic data and isolated environments for dependency testing; dependency approval does not authorize production deployment or access to production secrets.

**Still required before implementation:** define the dependency inventory format and ownership; approved registries and provenance/signature verification; vulnerability sources, severity thresholds and remediation SLAs; exception and end-of-life policy; lockfile and update automation; CI checks and review requirements; artifact attestation and retention; and synthetic tests for the build pipeline. No production dependency update, pipeline change or deployment is authorized by this policy decision alone.

### L-24 — Credential and secret management

**Question:** How should technical passwords, API keys, tokens, certificates and signing keys be stored and controlled?

Possible choices:
- **A. Configuration files:** store secrets in project configuration files, including private repositories.
- **B. Dedicated secret management:** use a dedicated secret manager with least-privilege access, rotation, expiry, audit and prohibition on committing secrets or writing them to logs.
- **C. Shared documents/messages:** distribute secrets among administrators through internal documents or messages.

**Approved 2026-11-27 — option B (dedicated secret manager, least-privilege access, rotation, expiry, audit and no secrets in code or logs), by explicit user confirmation in the project conversation.**

Approved policy in principle:
- Store secrets in an approved secret manager or equivalent managed vault, not in source code, repositories, ordinary configuration files, tickets, chat messages, shared documents or build artifacts.
- Use separate secrets, identities and access policies for development, test, staging and production. Non-production workloads and personnel must not inherit production secret access.
- Grant access only to named users and workload identities with a documented operational need. Prefer short-lived credentials, workload identity and just-in-time access where supported; prohibit shared human accounts and embedded long-lived credentials.
- Require strong authentication and audit for privileged secret access. Log secret metadata and access outcomes without recording secret values. Restrict and review secret-manager administration separately from application and repository administration.
- Define rotation, expiry, revocation and replacement procedures for each secret class. Rotate promptly after suspected exposure, personnel/role changes, provider incidents or other defined triggers; verify dependent services have safely adopted replacements.
- Protect encryption and signing keys with separately controlled key-management facilities, documented ownership, backup/recovery, rotation and separation of duties. Key export and recovery must be tightly restricted and audited.
- Prevent secrets from entering logs, telemetry, crash reports, test fixtures, screenshots, support bundles, generated documentation and client-side bundles. Apply redaction and scanning controls, while treating detection as a backstop rather than permission to commit secrets.
- Use synthetic credentials in tests and emulators. Never copy production secrets into lower environments or developer workstations without a separately authorized, documented exception and equivalent safeguards.
- If a secret is exposed, treat it as compromised: revoke or rotate it, assess access and downstream impact, preserve relevant evidence and follow the incident-response procedure.
- Document secret inventory, owner, purpose, environment, consumers, privilege scope, creation and expiry dates, rotation policy and revocation procedure without recording secret values.

**Still required before implementation:** select the approved secret manager and key-management service; define secret classes, owners and inventory; configure per-environment workload identities and access policies; establish rotation/expiry SLAs, emergency revocation and recovery; implement repository and CI secret scanning, log redaction and client-bundle checks; define audit retention and independent access review; and add synthetic tests proving unauthorized identities cannot retrieve secrets across environments. No production secret provisioning, key creation or credential rotation is authorized by this policy decision alone.

### L-25 — Strong authentication for administrators and privileged users

**Question:** How must administrators and users with elevated privileges authenticate?

Possible choices:
- **A. Password-only authentication:** no additional verification.
- **B. Mandatory multi-factor authentication:** phishing-resistant methods preferred (passkeys or hardware security keys), limited sessions and step-up verification for critical operations.
- **C. Optional MFA:** each administrator decides whether to enable it.

**Approved 2026-11-27 — option B (mandatory MFA, phishing-resistant methods preferred, limited sessions and step-up verification for critical operations), by explicit user confirmation in the project conversation.**

Approved policy in principle:
- Require MFA for all human accounts with administrative, security, support, approval, export, secret-management, production or other elevated privileges. Password-only access is not sufficient for privileged operations.
- Prefer phishing-resistant authentication such as FIDO2/WebAuthn passkeys or hardware security keys. Any permitted fallback must be explicitly risk-assessed, protected against account recovery abuse and not silently downgrade the required assurance.
- Require step-up authentication for high-impact actions, including privilege grants/revocations, identity or employee-binding changes, secret/key access, bulk exports, break-glass activation, security configuration changes and production access.
- Apply bounded session lifetimes, reauthentication after defined inactivity or risk events, secure session/token handling, and prompt session revocation after account compromise, role changes or termination.
- Separate authentication assurance from authorization: MFA does not grant a role, scope, data permission or approval authority.
- Enforce privileged access server-side and fail closed when required MFA claims, authentication assurance or recent-authentication evidence is absent or invalid.
- Provide controlled enrollment, recovery, replacement and loss procedures. Recovery must not be weaker than the authentication it replaces; sensitive recovery and factor replacement require identity verification, audit and independent approval where appropriate.
- Prohibit shared administrator accounts. Attribute each privileged action to an individual verified identity and record security-relevant authentication and recovery events without logging secrets.
- Use synthetic identities and emulator/test environments to validate MFA-required and MFA-denied paths. Do not weaken production authentication to accommodate tests or unsupported clients.

**Still required before implementation:** define privileged role inventory and assurance requirements; select supported authenticators and fallback policy; configure MFA enforcement and step-up claims in the identity provider and backend; define session lifetime, revocation and reauthentication semantics; establish enrollment, recovery and emergency access procedures; define audit events and review ownership; and add synthetic tests for missing MFA, stale authentication, recovery abuse, session revocation and privilege escalation. No production MFA configuration, account enrollment or identity-provider change is authorized by this policy decision alone.

### L-26 — Account recovery and credential reset

**Question:** How should account recovery, password reset and replacement of lost authentication factors be handled?

Possible choices:
- **A. Self-service reset based only on control of the registered email address.**
- **B. Risk-based recovery:** verify identity with independent evidence, use short-lived single-use recovery mechanisms, notify the account owner, revoke affected sessions and apply additional review or delay for privileged accounts.
- **C. Manual administrator reset on request, without a standardized verification and audit workflow.**

**Approved 2026-11-27 — option B (risk-based identity-verified recovery with single-use short-lived mechanisms, notification, session revocation and additional privileged-account safeguards), selected under the user's standing authorization for ChatGPT to choose and record the recommended security option.**

Approved policy in principle:
- Treat account recovery and factor replacement as security-sensitive authentication events, not ordinary profile edits or support conveniences.
- Verify the claimant's identity using evidence independent of the recovery channel being replaced. Control of a mailbox, phone number, employee number, name or manager assertion alone must not be treated as sufficient proof for privileged-account recovery.
- Use short-lived, single-use recovery tokens or codes with secure generation, storage, rate limits, attempt limits, expiry and replay prevention. Never disclose recovery secrets to support personnel or record their values in logs.
- Notify the account owner through previously verified channels about recovery initiation, completion, factor replacement and relevant security changes; provide a safe way to report an unauthorized recovery attempt.
- Revoke or invalidate existing sessions, refresh tokens, recovery codes and affected credentials as appropriate. Require fresh authentication and MFA enrollment before restoring privileged access.
- Apply stronger identity proofing, independent review or a controlled delay to administrator, security, payroll, secret-management and other high-impact accounts. Recovery must not bypass MFA, separation of duties or approval requirements.
- Prevent social engineering and account enumeration: responses and workflows must not reveal whether arbitrary identifiers correspond to active accounts.
- Keep recovery roles narrowly scoped. Support personnel may assist with the workflow but must not unilaterally assert identity, obtain secret values, or grant themselves access to the recovered account.
- Record recovery initiation, verification method class, approvals, factor changes, session revocation and outcome in protected audit records, minimizing personal data and excluding secrets.
- If identity cannot be verified or evidence conflicts, fail closed and escalate to a documented independent review; do not create a duplicate account or rebind UID↔Employee as a recovery shortcut.

**Still required before implementation:** define identity-proofing methods by account risk; approved recovery channels and factor replacement rules; recovery token format, storage, expiry and rate limits; independent approvers and waiting periods for privileged accounts; session/token revocation guarantees; notification and abuse-reporting workflow; support-agent permissions; and synthetic tests for enumeration, replay, social engineering, stale sessions and unauthorized privileged recovery. No production recovery workflow or identity-binding change is authorized by this policy decision alone.

### L-27 — Protection against abusive authentication attempts

**Question:** How should the system detect and mitigate brute-force, credential-stuffing and other abusive authentication attempts?

Possible choices:
- **A. No dedicated protections:** rely on ordinary authentication and manual review.
- **B. Layered abuse protection:** progressive rate limits, brute-force and credential-stuffing defenses, anomaly detection, proportionate temporary restrictions, secure recovery and audit.
- **C. Permanent account lockout after a fixed number of failures.**

**Approved 2026-11-27 — option B (layered abuse protection with progressive rate limits, detection, proportionate temporary restrictions, secure recovery and audit), selected under the user's standing authorization for ChatGPT to choose and record the recommended security option.**

Approved policy in principle:
- Apply layered rate limits to authentication, recovery, MFA verification, factor enrollment and other sensitive identity endpoints. Use appropriate combinations of account, source/network, device/session and risk signals; do not rely on a single client-controlled identifier.
- Detect brute-force and credential-stuffing patterns, password-spraying, MFA fatigue, suspicious recovery activity, automated enumeration and distributed abuse. Correlate signals across relevant endpoints while minimizing retained personal and device data.
- Use progressive delays, temporary restrictions, challenge or step-up verification, and risk-based denial where appropriate. Avoid permanent lockout based solely on unauthenticated attempts and avoid responses that disclose whether an account exists.
- Protect against denial-of-service and targeted lockout: an attacker must not be able to indefinitely disable a victim's account merely by submitting failed attempts. Provide safe, independently verified recovery and clear user notification for material restrictions.
- Apply stronger controls to privileged accounts and high-impact actions. Successful password authentication alone must not bypass mandatory MFA, step-up verification or server-side authorization.
- Keep thresholds, risk scoring and detection logic server-controlled. Do not trust client-reported risk, timestamps, counters, device identity or authorization claims.
- Record relevant security events, decisions, restrictions and recovery outcomes in protected audit logs. Do not log passwords, tokens, MFA codes, recovery secrets or unnecessary raw device/network data.
- Monitor control health, false positives, bypass attempts and abuse trends. Define alert ownership, escalation and periodic tuning; preserve evidence for incident response without retaining excessive telemetry.
- Use synthetic identities and isolated Emulator/test environments to validate legitimate and abusive paths, including distributed attempts, recovery abuse, rate-limit bypass and denial-of-service edge cases.

**Still required before implementation:** define per-endpoint limits and risk thresholds; select trusted server-side signals and anti-automation controls; establish temporary restriction duration, reset and appeal/recovery procedures; define monitoring, alerting and false-positive review ownership; align with identity-provider protections; set telemetry minimization and retention; and add synthetic adversarial tests. No production rate-limit configuration, account lockout policy or identity-provider change is authorized by this policy decision alone.

### L-28 — Session and device lifecycle security

**Question:** How should authenticated sessions and registered devices be managed throughout their lifecycle?

Possible choices:
- **A. Basic session handling:** rely on default identity-provider behavior with limited visibility and revocation controls.
- **B. Managed session lifecycle:** individual sessions, bounded lifetime, reauthentication for sensitive actions, user/admin revocation, secure token handling and lifecycle-triggered invalidation.
- **C. Persistent sessions:** long-lived sessions with broad device trust and limited reauthentication.

**Approved 2026-11-27 — option B (managed session lifecycle with bounded lifetime, revocation and reauthentication), selected under the user's standing authorization for ChatGPT to choose and record the recommended security option.**

Approved policy in principle:
- Use individual user sessions; prohibit shared accounts and shared session credentials. Bind each session to a verified identity-provider subject and validate the current canonical membership, lifecycle state, role, scope and permissions server-side for each protected request.
- Apply bounded idle and absolute session lifetimes appropriate to risk. Require fresh authentication or step-up verification for sensitive actions, privilege changes, recovery, and other high-impact operations.
- Provide a secure way for users and authorized administrators to review and revoke sessions, subject to least privilege and audit. Revocation must take effect server-side and must not depend solely on client-side sign-out.
- Revoke or invalidate affected sessions and refresh credentials after account compromise, credential or MFA reset, suspension, termination, UID-to-employee binding revocation, material role/scope changes, and other defined lifecycle events. Do not automatically restore previously revoked sessions or privileges after reactivation.
- Protect session and refresh tokens in transit and at rest; never place secrets in URLs, logs, analytics, browser-readable persistent storage or error messages. Use secure cookie attributes and appropriate CSRF protections where cookie-based sessions are used.
- Detect unusual session activity and apply proportionate step-up or revocation controls. Avoid treating device recognition, IP address or a client-side session flag as proof of identity or authorization.
- Maintain protected, minimized audit events for session creation, renewal, step-up, revocation and material security decisions. Do not record raw tokens or unnecessary device fingerprints.
- Ensure logout, password/MFA recovery, administrator revocation and lifecycle-triggered revocation are tested across all relevant clients and backend endpoints.

**Still required before implementation:** select session architecture and token storage; define idle/absolute lifetimes and step-up policy; specify device enrollment and trust semantics; map revocation propagation and refresh-token handling for each client/provider; define CSRF protections where applicable, monitoring and audit retention; and add synthetic Emulator tests for expiry, replay, revocation, account switching, role changes and concurrent sessions. This approval does not authorize production identity-provider settings or deployment.

### L-29 — Security monitoring, alerting and event response

**Question:** How should security-relevant events be monitored, escalated and investigated?

Possible choices:
- **A. Minimal monitoring:** retain basic application logs and investigate only after a reported incident.
- **B. Risk-based monitoring and response:** centralized security events, protected audit, actionable alerts, defined triage/escalation and human review for consequential actions.
- **C. Fully automated response:** automatically block accounts and take consequential actions based primarily on anomaly scores.

**Approved 2026-11-27 — option B (risk-based monitoring, actionable alerting, protected audit and defined human-reviewed response), selected under the user's standing authorization for ChatGPT to choose and record the recommended security option.**

Approved policy in principle:
- Define a documented set of security-relevant events across authentication, MFA and recovery, session lifecycle, employee/account binding, role and delegation changes, privileged actions, data access, exports, configuration changes and backend authorization denials.
- Centralize security telemetry in a controlled destination with restricted access, integrity protections, reliable timestamps and documented retention. Preserve authoritative audit records separately from ordinary diagnostic/application logs where appropriate.
- Generate risk-based alerts for material patterns such as repeated authentication abuse, suspicious recovery, privilege escalation, unusual access or export activity, break-glass use, audit pipeline failure and unexpected changes to security controls.
- Assign accountable owners for alert triage, severity classification, escalation, containment decisions and closure. Define response targets proportionate to severity and maintain a documented incident-handling path.
- Require human review and authorization for consequential actions where automated signals may be uncertain. Automated containment, if later implemented, must be bounded, reversible where possible, tested against false positives and protected against attacker-triggered denial of service.
- Minimize telemetry: never log passwords, tokens, MFA codes, recovery secrets or unnecessary personal data. Restrict access to logs and monitor access to the logs themselves.
- Protect log integrity and availability, detect gaps or tampering, synchronize time sources, and retain sufficient evidence for authorized investigation without indefinite collection.
- Test alert generation, delivery, escalation, audit integrity, failure modes and incident procedures using synthetic events in isolated environments.

**Still required before implementation:** define event taxonomy and severity, alert thresholds and correlation, log architecture and integrity controls, retention and access policy, named operational ownership and escalation path, incident playbooks, privacy review, and synthetic tests for missed alerts, noisy alerts, tampering and pipeline outage. This approval does not authorize production monitoring integrations, external data sharing or automatic account restrictions.

### L-30 — Data classification, minimization and handling

**Question:** How should information be classified and handled according to sensitivity and operational need?

Possible choices:
- **A. Uniform handling:** apply broadly similar controls to all application data.
- **B. Risk-based data governance:** classify data, minimize collection and exposure, enforce purpose and access limits, and apply handling, retention and disposal controls proportionate to sensitivity.
- **C. Broad internal availability:** make operational data generally available to authenticated staff and rely primarily on organizational trust.

**Approved 2026-11-27 — option B (risk-based classification, minimization and handling), selected under the user's standing authorization for ChatGPT to choose and record the recommended security option.**

Approved policy in principle:
- Establish a documented data inventory and classification scheme based on sensitivity, impact, legal/contractual obligations and operational context. Identify personal, employment, compensation, health/absence, authentication, security/audit and synthetic/test data distinctly.
- Collect and process only fields necessary for a documented purpose. Prefer derived or minimized views over raw source records; do not expose sensitive absence reasons, health information, payroll details, credentials or unrelated employee records through general operational interfaces.
- Enforce purpose limitation, least privilege and field-level allowlists at trusted server boundaries. Authentication alone, client-side filtering, UI hiding, local storage partitioning or possession of an identifier must not confer access.
- Apply controls appropriate to classification, including encryption in transit and at rest where supported, restricted key and administrative access, protected audit, approved transfer channels and safeguards against unintended export or disclosure.
- Separate synthetic/test data from real personal and operational data. Use synthetic fixtures by default in development, demonstrations, tests and AI/analytics workflows; prohibit copying production data into lower-trust environments without a separately approved and minimized process.
- Define retention and disposal schedules by data class and purpose, including backup expiry, audit evidence, legal holds and documented deletion/anonymization outcomes. Do not silently overwrite or erase records subject to an authorized hold.
- Review data flows, integrations, processors and exports before enabling them. Share only the minimum required fields with an authorized recipient and record the purpose, scope and approval where appropriate.
- Periodically review classification, access, data flows and retention; reclassify when context changes and promptly correct over-collection or overexposure.

**Still required before implementation:** complete the data inventory and ownership map; approve classification levels and handling matrix; define purpose, retention and disposal schedules per domain; document encryption/key management and transfer controls; assess integrations and processors; define exceptions and review cadence; and add synthetic tests for field leakage, unauthorized export, retention and deletion behavior. This approval does not authorize new data collection, third-party sharing, bulk export or production data migration.

### L-31 — Vulnerability intake, remediation and security updates

**Question:** How should reported vulnerabilities and security defects be triaged, corrected and verified?

Possible choices:
- **A. Ad hoc remediation:** address vulnerabilities when noticed, without a formal intake or prioritization process.
- **B. Managed vulnerability lifecycle:** documented reporting and intake, risk-based triage, tracked remediation, verified fixes and controlled updates.
- **C. Automatic updates without review:** apply dependency and application updates immediately without compatibility or security validation.

**Approved 2026-11-27 — option B (managed vulnerability intake, risk-based remediation and verified security updates), selected under the user's standing authorization for ChatGPT to choose and record the recommended security option.**

Approved policy in principle:
- Provide a documented channel for internal and external vulnerability reports, with clear ownership, acknowledgement, confidentiality and escalation for urgent or actively exploited issues.
- Track findings with affected component and version, evidence, severity, exploitability, exposure, impact, remediation owner, target date, status and verification evidence. Avoid placing secrets or personal data in issue records.
- Prioritize using risk and exploitability, not severity score alone. Consider internet exposure, privilege boundaries, data sensitivity, active exploitation, available mitigations and business impact.
- Maintain an inventory of application components, dependencies, runtimes, build tools and relevant service configurations. Monitor authoritative advisories and supported vulnerability feeds.
- Remediate through reviewed, traceable changes. Pin and lock dependency versions, review provenance and integrity, inspect changelogs and breaking changes, and avoid unreviewed automatic production updates.
- Verify fixes with focused regression, security and compatibility tests in isolated environments using synthetic data. Include tests for the original exploit path and relevant authorization boundaries.
- Define documented exception and risk-acceptance procedures with a named accountable approver, compensating controls, expiry and periodic review. Do not silently defer critical findings.
- Coordinate urgent mitigations and updates through a controlled release process with rollback planning and post-remediation verification. Preserve evidence and link the finding to the corrective change.
- Reassess vulnerabilities when dependencies, architecture, exposure, threat intelligence or deployed versions change.

**Still required before implementation:** designate vulnerability intake and response owners; define severity and remediation targets; choose advisory sources and scanning tools; complete component inventory and version policy; define disclosure and escalation process; establish exception approval and expiry; specify test, release and rollback evidence; and create synthetic workflow tests. This approval does not authorize automatic dependency updates, production patching or deployment.

### L-32 — Privacy requests and personal-data rights handling

**Question:** How should requests concerning access, correction, restriction or deletion of personal data be received and fulfilled?

Possible choices:
- **A. Informal handling:** allow staff or administrators to make ad hoc changes on request.
- **B. Verified, tracked privacy workflow:** authenticate the requester, establish authority and scope, assess applicable obligations and retention constraints, require review for sensitive actions, and record the outcome.
- **C. Immediate automated fulfillment:** execute access, correction or deletion requests automatically based only on a submitted identity claim.

**Approved 2026-11-27 — option B (verified and tracked privacy-request workflow with scope, review and recorded outcomes), selected under the user's standing authorization for ChatGPT to choose and record the recommended security option.**

Approved policy in principle:
- Provide a documented intake and tracking process for requests concerning personal data, with clear ownership, status, deadlines to be determined by applicable requirements, and a secure communication channel.
- Verify the identity of the requester and, where relevant, their authority to act for another person. Use proportionate verification and do not collect excessive additional identity information.
- Determine the systems, domains, records, purposes and time periods in scope before accessing or changing data. Distinguish the requester's own data from third-party information and restricted employment, compensation, health, security and audit records.
- Assess applicable legal, contractual, employment, retention and legal-hold constraints before disclosure, correction, restriction, deletion or anonymization. Escalate uncertain or conflicting cases to an authorized privacy/legal owner rather than making assumptions.
- Require controlled review for sensitive or high-impact actions. Keep requests separate from ordinary operational permissions; an employee, manager or administrator must not gain broad access merely by handling a request.
- Preserve provenance and integrity: record the request, verification outcome, scope, decision, authorized actor, affected systems, actions taken, exceptions and completion notice. Do not place unnecessary personal data or secrets in audit records.
- Apply corrections through traceable workflows that preserve required history and prevent unauthorized alteration of payroll, employment or audit evidence. Deletion or anonymization must account for backups, replicas, downstream processors and applicable holds.
- Communicate outcomes securely and explain partial fulfillment or refusal through an approved process, without disclosing another person's information or internal security-sensitive details.
- Test request handling with synthetic identities and records, including identity mismatch, third-party data, conflicting retention obligations, legal holds, partial fulfillment and downstream-system failures.

**Still required before implementation:** assign privacy-request ownership; define intake channels, identity proofing and authority checks; map personal-data stores and processors; establish applicable response timelines and escalation with qualified privacy/legal review; define redaction, correction, restriction, deletion and anonymization procedures including backup handling; and add synthetic end-to-end tests. This approval does not authorize bulk disclosure, automatic deletion, changes to legal retention, or processing of real personal data.

### L-33 — Business continuity and incident recovery

**Question:** How should the service recover safely after outages, security incidents, data corruption or infrastructure failures?

Possible choices:
- **A. Informal recovery:** restore services as needed without documented priorities or recurring exercises.
- **B. Planned continuity and verified recovery:** documented recovery priorities, defined RTO/RPO targets, protected backups, restore exercises and integrity/authorization checks before reopening services.
- **C. Immediate failover without validation:** automatically resume service from a backup or alternate environment without verification.

**Approved 2026-11-27 — option B (planned continuity and verified recovery), selected under the user's standing authorization for ChatGPT to choose and record the recommended security option.**

Approved policy in principle:
- Maintain a documented business continuity and disaster recovery plan with service/domain dependencies, recovery priorities, accountable owners, communication paths and escalation.
- Define and approve recovery time objectives (RTO) and recovery point objectives (RPO) for each critical service and data domain, based on business impact and risk; do not assume targets without analysis.
- Protect backups using access controls, encryption where supported, separation from primary operational credentials and environments, integrity checks, monitoring and documented retention. Include backup administration and restore operations in privileged-access controls and audit.
- Use more than one protected recovery copy where justified, including a suitably isolated or offline/immutable copy where feasible. Ensure backup deletion or modification cannot be performed casually using the same privileges as ordinary application operations.
- Regularly exercise restoration using isolated test environments and synthetic or appropriately approved data. Verify backup integrity, restore completeness, application functionality, access control, canonical identity bindings, audit continuity and data consistency before considering a recovered system trustworthy.
- Treat recovery after suspected compromise differently from routine outage recovery: assess incident scope, credential/key rotation, persistence and contamination risks; avoid blindly restoring compromised credentials, vulnerable software or malicious state.
- Define controlled failover and failback procedures, including decision authority, validation, communications, rollback and reconciliation of data changes. Prevent split-brain writes and unreviewed reintroduction of stale permissions.
- Document exercise results, failures, remediation actions and evidence; review the plan periodically and after significant architecture or incident changes.

**Still required before implementation:** perform business impact and dependency analysis; assign recovery owners; define and approve RTO/RPO; specify backup architecture, encryption/key custody, isolation, retention and access; define recovery validation and failback steps; establish exercise schedule and evidence; and add synthetic tests for backup failure, corrupted restores, stale authorization, identity/session revocation, data reconciliation and compromised recovery scenarios. This approval does not authorize production backups, Firebase changes, failover, restore or deployment.

### L-34 — Third-party integrations and external service access

**Question:** How should external integrations, vendors, APIs and data processors be admitted and governed?

Possible choices:
- **A. Convenience-first integration:** connect services with minimal review and broad default permissions.
- **B. Risk-reviewed integration governance:** evaluate purpose, data scope, provider risk, permissions, credentials, contract/privacy considerations, monitoring and offboarding before approval.
- **C. Prohibit all external integrations:** no external service may be connected under any circumstances.

**Approved 2026-11-27 — option B (risk-reviewed, least-privilege integration governance), selected under the user's standing authorization for ChatGPT to choose and record the recommended security option.**

Approved policy in principle:
- Maintain an inventory of external services, providers, integrations, API endpoints, data flows, owners, purpose, permission scopes, environments and lifecycle status.
- Review security, privacy, contractual and operational risks before enabling an integration. Assess provider access, subprocessors where relevant, data residency/retention, incident notification, availability, authentication, auditability, and exit/deletion options.
- Limit data shared to the minimum necessary for an explicitly approved purpose. Do not send employee data, payroll, health/absence details, credentials, secrets or audit data to external services without specific authorization, necessity and safeguards.
- Use dedicated integration identities and narrowly scoped credentials; store secrets in an approved secret-management system, rotate/revoke them, and never embed credentials in source, client code, logs or test fixtures.
- Require controlled review of scopes, callback URLs, webhook authenticity, signature/secret validation, replay protections, rate limits, schema validation and error handling. Treat external responses and payloads as untrusted input.
- Separate integration credentials and data across environments; use synthetic fixtures in tests. Do not allow external providers to gain implicit access to internal authorization, employee identity or lifecycle controls.
- Monitor integration access, errors, unusual activity, permission changes and provider incidents. Keep minimized, protected audit evidence and defined incident escalation.
- Define ownership, periodic access review, renewal, revocation, offboarding and data deletion/return obligations. Disable unused or unapproved integrations and revoke associated secrets promptly.
- Require a documented exception approval, scope, expiry and compensating controls for any deviation from these requirements.

**Still required before implementation:** complete integration/provider inventory; assign service owners; perform security and privacy reviews; define approved data flows, scopes, contracts and retention; select authentication and webhook protections; set monitoring and review cadence; define offboarding and credential revocation; and add synthetic tests for malicious payloads, credential compromise, replay, excessive scope and provider outage. This approval does not authorize any third-party integration, external data transfer or real provider connection.

### L-35 — Human error prevention and irreversible operations

**Question:** How should high-impact or potentially irreversible actions be protected against mistakes and misuse?

Possible choices:
- **A. Direct execution:** permit authorized users to perform consequential actions immediately.
- **B. Guarded operations:** explicit confirmation, preview, separation of preparation and execution, reversibility where feasible, and stronger approval for critical actions.
- **C. Block all high-impact actions:** prohibit deletion, bulk changes and other consequential operations entirely.

**Approved 2026-11-27 — option B (guarded high-impact operations with confirmation, preview, reversibility and independent approval where warranted), selected under the user's standing authorization for ChatGPT to choose and record the recommended security option.**

Approved policy in principle:
- Classify actions by impact and reversibility. Require explicit confirmation for high-impact actions and stronger authorization, including independent approval where appropriate, for critical operations.
- Present a clear preview of the target, scope, affected records, fields, counts and consequences before committing. Avoid ambiguous labels or defaults that can trigger destructive operations.
- Separate preparation from execution for bulk or sensitive operations. Require the executing actor to revalidate current authorization, scope and state at commit time; previews and stale confirmations must not authorize later execution.
- Use idempotency, expected revisions or concurrency checks where applicable to prevent duplicate, stale or conflicting mutations.
- Prefer reversible workflows such as soft-delete, staged changes or restore paths when legally and operationally appropriate. Where actions cannot be reversed, apply stricter confirmation, independent review, backup/retention assessment and recorded justification.
- Restrict bulk operations and exports to separately authorized scopes, with bounded counts, clear selection, safeguards against accidental all-record targeting and explicit confirmation.
- Do not allow the same actor to approve their own critical action when policy requires separation of duties. Enforce approvals server-side; UI prompts alone are not security controls.
- Provide safe failure behavior: reject unknown fields, ambiguous scope, stale versions, missing approvals, invalid lifecycle state and unexpected record counts. Avoid partial commits where atomicity is feasible; otherwise report partial outcomes precisely and support reconciliation.
- Record the actor, approver where applicable, action, reason, scope, preview/commit context, outcome and affected identifiers in protected audit without logging secrets.
- Test accidental double-submit, stale preview, scope expansion, concurrent changes, wrong-domain selection, destructive operation recovery, approval bypass and partial failure using synthetic data.

**Still required before implementation:** define the impact classification and action catalogue; confirmation and preview requirements per action; approval/separation-of-duties matrix; concurrency/idempotency strategy; reversibility and retention constraints; bulk-operation limits and recovery procedures; audit schema; and synthetic tests for each guarded action. This approval does not authorize destructive or bulk operations, real-data changes or production activation.

### L-36 — Secure design, threat modeling and security review gates

**Question:** How should security requirements be incorporated into feature design and changes?

Possible choices:
- **A. Reactive security:** perform security review mainly after implementation or when incidents arise.
- **B. Security-by-design gates:** threat model material changes, define security acceptance criteria, review architecture and abuse cases before implementation, and validate them with tests.
- **C. Full pre-approval for every minor change:** require formal security review for all changes regardless of risk or impact.

**Approved 2026-11-27 — option B (risk-based security-by-design and review gates), selected under the user's standing authorization for ChatGPT to choose and record the recommended security option.**

Approved policy in principle:
- Integrate security, privacy and abuse-case analysis into planning and design for new features and material changes, proportional to risk and impact.
- Maintain a threat model that identifies assets, trust boundaries, actors, attack surfaces, abuse cases, assumptions, mitigations and residual risks. Revisit it when architecture, data flows, permissions or integrations change.
- Define security acceptance criteria before implementation for authentication, authorization, data minimization, lifecycle, audit, failure behavior and tests as applicable.
- Require peer review for security-sensitive changes and independent review for critical boundaries, privileged actions, authentication, authorization, sensitive data handling and external integrations.
- Validate requirements with automated and manual tests in isolated environments using synthetic data. Include abuse cases, negative tests and failure paths, not only happy-path tests.
- Document risk exceptions with scope, justification, accountable approval, compensating controls and expiry; do not silently waive security gates.
- Keep review artifacts and decisions traceable to implementation and test evidence. Policy approval, review completion, implementation, passing tests and deployment remain distinct states.
- Prevent security gates from becoming ceremonial checklists: reviewers must be able to reject incomplete evidence and require remediation.

**Still required before implementation:** define risk tiers and review triggers; select threat-model template and ownership; specify review/approval roles and independent-review criteria; establish security acceptance-criteria and evidence linkage; define exception process and expiry; and implement automated/ manual checks and synthetic threat tests. This approval does not certify the code, approve deployment or authorize production changes.

### L-37 — Data integrity and unauthorized modification prevention

**Question:** How should record integrity and client-submitted mutations be protected?

Possible choices:
- **A. Basic validation:** client validation with basic server checks.
- **B. Strict integrity controls:** server-side schema validation, canonical ownership/authorization checks, revision/concurrency controls, integrity auditing and abuse detection.
- **C. Trust client record IDs and fields** when requests are authenticated.

**Approved 2026-11-27 — option B (strict server-side integrity controls), selected under the user's standing authorization for ChatGPT to choose and record the recommended security option.**

Approved policy in principle:
- Validate every input at a trusted server boundary against explicit schemas, types, lengths, canonicalization rules and allowed fields; reject unknown or authority-bearing fields.
- Authorize every write using verified actor identity, canonical employee binding, membership/lifecycle, scope, role, action and field permissions—not client claims.
- Protect record ownership and domain boundaries. Client-supplied IDs, owner UID, role, scope, revision, timestamps or approval metadata are never authoritative without server-derived verification.
- Apply expected-revision/optimistic concurrency checks, idempotency for retry-sensitive operations, and atomic transactions where feasible to prevent stale, duplicate or conflicting mutations.
- Generate minimized protected audit events for actor, action, target, scope, outcome and revision; do not log secrets or sensitive payloads.
- Detect and monitor integrity anomalies, rejected writes, inconsistent bindings and out-of-band modifications; investigate with controlled response.
- Enforce query constraints and validate records on both reads and writes. Malformed, unknown or inconsistent records fail closed.
- Test synthetic abuse cases: authority-field injection, cross-domain writes, stale revisions, replay/double submission, ID spoofing, concurrent mutation and malformed payloads.

**Still required before implementation:** define domain schemas and canonical ownership binding, expected-revision and transaction/idempotency semantics, audit schema, anomaly signals/monitoring, and synthetic test coverage. This approval authorizes no database implementation, real-data mutation or production activation.

### L-38 — Verification evidence and test governance

**Question:** What evidence is required to claim that security controls are verified and a change is ready for review?

Possible choices:
- **A. Informal evidence:** developer reports and spot checks are sufficient.
- **B. Reproducible evidence gates:** documented, repeatable tests in isolated environments; traceable results; review of failures; explicit release-blocking criteria.
- **C. Formal certification for every change:** require external certification regardless of risk.

**Approved 2026-11-27 — option B (reproducible, traceable security evidence gates), selected under the user's standing authorization for ChatGPT to choose and record the recommended security option.**

Approved policy in principle:
- Security claims must be backed by reproducible test procedures, environment/configuration details, test inputs (synthetic only), expected outcomes and captured results.
- Map each applicable security requirement and threat-model mitigation to implementation references and evidence; distinguish policy approval, code review, tests executed, tests passed, unresolved findings and release authorization.
- Test both permitted and denied paths, abuse cases, edge cases, lifecycle transitions, failures and concurrency behavior in isolated Emulator/test environments.
- Evidence must identify the commit/version tested and be retained in a reviewable form; rerun affected checks when code, dependencies, configuration or security assumptions change.
- Critical/high findings and failed mandatory checks block release unless a documented, scoped, time-limited exception is approved by accountable reviewers with compensating controls.
- Reviewers must not accept unexecuted, stale, incomplete or non-reproducible tests as passing; do not imply tests were run when only reviewed or planned.
- Synthetic fixtures only; no real employee/customer data, live credentials or production access in test evidence.

**Still required before implementation:** define evidence format and storage, requirement-to-test mapping, test ownership, risk severity thresholds, CI enforcement, exception approval/expiry, and reviewer criteria. This decision establishes governance policy only; it does not assert current CI/test status, certify security, or authorize merge/deployment/production activation.

### L-39 — CI dependency and vulnerability gates

**Question:** How should dependency vulnerabilities and risky package changes be prevented from passing continuous integration unnoticed?

Possible choices:
- **A. Advisory-only:** show warnings but permit normal advancement.
- **B. Risk-based enforced gates:** automated dependency inventory and vulnerability/provenance checks; block on defined severity or policy violations; reviewed exceptions with expiry.
- **C. Freeze all dependencies indefinitely:** prohibit all dependency updates.

**Approved 2026-11-27 — option B (risk-based enforced dependency and vulnerability gates), selected under the user's standing authorization for ChatGPT to choose and record the recommended security option.**

Approved policy in principle:
- Maintain a reproducible dependency inventory, lockfiles, and version/provenance metadata for direct and transitive dependencies.
- Run automated vulnerability and license/policy checks in CI; assess severity, exploitability, exposure and available remediation, with defined blocking thresholds.
- Block advancement for critical/high vulnerabilities under policy, untrusted or unverifiable provenance, dependency confusion indicators, unexpected lockfile changes, and failed mandatory checks; do not silently ignore findings.
- Prefer supported versions and controlled, reviewable updates; test updates in isolated CI and review material changes to scripts, install hooks and permissions.
- Use scoped, documented, time-limited exceptions with accountable approval, rationale, compensating controls and expiry; exceptions must not disable unrelated checks.
- Keep scanning results tied to commit and workflow run, minimize secret exposure in CI, and monitor scanner/configuration failures as failures rather than success.
- Avoid automatic upgrades that change runtime behavior without review and tests; automate safe discovery and proposed updates, but retain controlled review for material or security-sensitive changes.

**Still required before implementation:** define severity thresholds and risk criteria, scanners and provenance sources, license policy, CI workflow/permissions, remediation ownership and deadlines, exception workflow, and synthetic validation of blocking behavior. This policy does not claim scans currently run, authorize dependency changes, merge, deploy or production activation.

### L-40 — Transport security and data-in-transit protection

**Question:** How should communications between clients, services and external providers protect data and credentials in transit?

Possible choices:
- **A. Basic transport:** rely on platform defaults and application-level precautions.
- **B. Enforced secure transport:** require modern TLS, secure endpoint configuration, strict credential handling, controlled origins and leakage-resistant errors/logging.
- **C. Network isolation only:** rely primarily on private networks without consistent end-to-end transport requirements.

**Approved 2026-11-27 — option B (enforced secure transport and leakage prevention), selected under the user's standing authorization for ChatGPT to choose and record the recommended security option.**

Approved policy in principle:
- Require HTTPS/TLS for all production-bound client/service and service/provider communications; reject plaintext or downgraded transport except isolated local Emulator/test traffic explicitly configured for development.
- Use platform-supported modern TLS configurations and validate certificates/hostnames; prohibit disabling certificate validation or accepting invalid certificates in production code.
- Protect authentication tokens, session credentials and API secrets: transmit only through approved secure mechanisms, never in URLs, query strings, referrers, analytics, crash reports or ordinary logs.
- Restrict browser origins with explicit allowlists and appropriate CORS/CSRF protections where applicable; CORS is not an authorization boundary.
- Apply secure cookie/session attributes where cookies are used, and avoid exposing tokens to browser storage or scripts unnecessarily; enforce authorization independently of transport security.
- Minimize sensitive data in request/response payloads; prevent leakage through verbose errors, redirects, tracing, telemetry and third-party resources.
- Define outbound destination controls for server integrations; validate provider endpoints and prevent SSRF, open redirects and unintended cross-origin data transfer.
- Test insecure transport rejection, certificate/hostname failures, token leakage paths, origin abuse and error/log redaction using synthetic data.

**Still required before implementation:** define supported TLS/platform baselines, endpoint and origin inventories, token/session transport architecture, cookie/CSRF requirements, outbound destination policy, redaction rules and automated tests. This policy does not certify current transport configuration, authorize a real provider connection, merge, deploy or production activation.

### L-41 — Web application and API abuse protection

**Question:** What baseline protections should apply to web interfaces and APIs against injection, cross-site attacks and abusive request patterns?

Possible choices:
- **A. Framework defaults:** rely on framework protections and validate only selected inputs.
- **B. Defense in depth:** validate and encode at trust boundaries, enforce server-side authorization and request controls, apply browser security protections, and test abuse cases.
- **C. Broad blocking:** reject most dynamic inputs and cross-origin interactions regardless of business need.

**Approved 2026-11-27 — option B (defense-in-depth web and API abuse protection), selected under the user's standing authorization for ChatGPT to choose and record the recommended security option.**

Approved policy in principle:
- Validate all untrusted input server-side against explicit schemas, types, lengths, formats and allowlists; use parameterized queries and context-appropriate output encoding to prevent injection.
- Enforce authentication, canonical ownership, role/action/field permissions and organizational scope on every API request; never rely on UI visibility, client filters, CORS or client-supplied identity as authorization.
- Apply CSRF protections to cookie-authenticated state-changing requests, secure cookie attributes, and strict origin validation where applicable; use appropriate CSP and browser security headers to reduce script injection and framing risks.
- Prevent SSRF by validating and restricting server-side outbound destinations, blocking internal/metadata address ranges and unsafe redirects, and revalidating resolved destinations as appropriate.
- Bound request size, pagination, execution time and concurrency; apply risk-based rate limits and abuse detection without creating unsafe account-lockout behavior.
- Use safe error responses and avoid leaking stack traces, secrets, tokens, internal paths or sensitive record details; log security-relevant outcomes with minimized protected audit.
- Separate public and privileged API surfaces, use explicit method/content-type expectations, reject unexpected fields and methods, and make state-changing operations idempotent or concurrency-safe where appropriate.
- Test injection, XSS, CSRF, SSRF, IDOR/BOLA, cross-scope access, mass assignment, oversized payloads, abusive request rates and authorization bypass with synthetic identities and isolated Emulator/test environments.

**Still required before implementation:** inventory API routes and trust boundaries; define input/output schemas, CSP and security headers, CSRF/session architecture, outbound destination policy, request/rate limits, monitoring thresholds and negative test coverage. This policy does not claim current defenses are implemented or tests passed, and does not authorize production activation.

### L-42 — Stored data and local cache protection

**Question:** How should sensitive data be protected when stored on servers, devices, browser storage or offline caches?

Possible choices:
- **A. Platform defaults:** rely on standard storage protections and application conventions.
- **B. Layered storage protection:** classify and minimize stored data, encrypt sensitive data at rest where appropriate, control keys and access, and strictly limit local/offline persistence.
- **C. No local persistence:** prohibit all client-side persistence for every data category.

**Approved 2026-11-27 — option B (layered stored-data and local-cache protection), selected under the user's standing authorization for ChatGPT to choose and record the recommended security option.**

Approved policy in principle:
- Classify data and retain only what is necessary for an approved purpose and duration; do not persist secrets, authentication tokens or sensitive payroll/health data in ordinary browser storage.
- Require encryption at rest for sensitive server-side stores and backups, with access-controlled key management, rotation, recovery and separation of duties appropriate to risk.
- Treat browser LocalStorage, IndexedDB, caches and device storage as untrusted client-controlled environments; partitioning or encryption on the client does not prove record ownership or authorization.
- Keep offline/local persistence disabled for sensitive domains unless a separate domain-specific decision defines necessity, exact fields, device/session binding, expiry, revocation, deletion and threat mitigations.
- Minimize cached data, apply bounded lifetimes, clear session-bound data on logout/account switch and lifecycle or binding revocation, and handle failed deletion as a security-relevant condition.
- Never silently migrate legacy LocalStorage/IndexedDB records into canonical data stores or treat legacy client data as authoritative; any future migration requires a separately reviewed, explicit and auditable process.
- Prevent sensitive data from leaking through browser caches, service-worker caches, crash reports, diagnostics, backups and logs; define secure deletion/retention limits and acknowledge where physical overwrite cannot be guaranteed.
- Test account switching, shared-device scenarios, stale cache access, offline revocation, storage inspection, backup restoration and deletion behavior using synthetic fixtures.

**Still required before implementation:** define data classification and retention schedules, approved storage locations per domain, encryption/key architecture, offline eligibility and TTLs, logout/account-switch/lifecycle cleanup semantics, backup controls and synthetic tests. This policy does not authorize local payroll/health caching, legacy migration, real-data access or production activation.

### L-43 — Administrative operations and insider-abuse controls

**Question:** How should privileged administrative operations be constrained and monitored to reduce privilege escalation, misuse and insider risk?

Possible choices:
- **A. Broad administrator trust:** organization administrators may perform most actions, with audit after the fact.
- **B. Least privilege and independent controls:** separate duties, narrowly scoped grants, independent approval for critical actions, and continuous audit/review.
- **C. Centralized unrestricted super-admin:** reserve all sensitive operations to one universal administrator role.

**Approved 2026-11-27 — option B (least privilege, separation of duties and independent administrative controls), selected under the user's standing authorization for ChatGPT to choose and record the recommended security option.**

Approved policy in principle:
- Do not treat an organization/account administrator role as universal authority over employee data or every domain; grant permissions by explicit action, domain and organizational scope.
- Separate identity administration, role/permission granting, employee-data operations, security monitoring and approval duties where practicable.
- Require independent approval for critical privilege grants, privilege escalation, sensitive data access exceptions, security-control changes and other high-impact administrative actions; prohibit self-approval.
- Enforce privileged actions server-side using verified actor identity, current lifecycle and membership, explicit permission, scope, reason and approval state; UI controls are not security boundaries.
- Use time-limited, purpose-bound privileged elevation with expiry and prompt revocation; avoid standing privilege where temporary access suffices.
- Protect administrator authentication with MFA and step-up verification for critical actions; apply session limits and server-side revocation.
- Record grants, changes, approvals, denials, use, expiry and revocation in protected audit; monitor unusual access patterns and alert accountable reviewers.
- Conduct periodic and event-driven reviews of privileged accounts, role assignments, delegations and emergency access; remove stale or conflicting grants.
- Test privilege escalation, self-approval, cross-domain and cross-scope access, compromised administrator sessions, stale grants and audit tampering using synthetic identities.

**Still required before implementation:** define the privileged role/action/scope matrix, separation-of-duties rules, independent approver eligibility, elevation duration and emergency process, review cadence, alert ownership, audit schema and synthetic negative tests. This policy does not grant administrator privileges, authorize privileged endpoints or production activation.

### L-44 — Data loss prevention and controlled data egress

**Question:** How should sensitive information be protected against accidental disclosure, unauthorized export and unsafe transfer?

Possible choices:
- **A. User-managed handling:** rely primarily on user judgment and ordinary application permissions.
- **B. Risk-based data-loss prevention:** classify and minimize data, constrain egress by purpose and permission, inspect risky transfers, and audit enforcement.
- **C. Block all data movement:** prohibit all exports, downloads and integrations regardless of business need.

**Approved 2026-11-27 — option B (risk-based data-loss prevention and controlled data egress), selected under the user's standing authorization for ChatGPT to choose and record the recommended security option.**

Approved policy in principle:
- Classify data by sensitivity and domain; expose only the minimum fields needed for an authorized task and audience.
- Treat export, download, print, clipboard, sharing, API transfer, integration and bulk retrieval as distinct egress paths requiring explicit domain/action/scope permissions and a defined purpose.
- Default sensitive and high-impact data egress to deny unless a reviewed workflow explicitly authorizes it; enforce controls server-side, not solely in the UI.
- Apply field allowlists, row/scope limits, pagination and volume thresholds; require preview and explicit confirmation for permitted exports, with stronger independent approval for bulk or high-risk exports.
- Generate short-lived, access-controlled download artifacts; avoid public links, predictable identifiers, uncontrolled persistence and unnecessary copies.
- Validate uploaded files and imported content as untrusted input; enforce file type/size limits, safe parsing, malware scanning where supported, and spreadsheet formula-injection protections on generated exports.
- Prevent secrets, authentication tokens and unnecessary personal or sensitive data from entering logs, telemetry, error messages, support bundles or analytics.
- Apply destination and integration allowlists where appropriate; review external recipients, scopes, retention and onward-transfer conditions before enabling data flows.
- Record permitted and denied high-risk egress events with minimized metadata, actor, purpose, scope, destination class, volume and outcome; protect audit records from alteration by the initiating actor.
- Detect unusual export volume, repeated denials, unusual destinations and anomalous access patterns; route alerts to accountable human reviewers and provide a documented containment process.
- Define retention and secure disposal for temporary exports, generated files, caches and transfer artifacts; revoke access when permissions or lifecycle state change.
- Test synthetic attempts at cross-scope export, field overexposure, bulk extraction, unsafe file parsing, formula injection, public-link exposure, unauthorized destinations and audit/log leakage.

**Still required before implementation:** approve the data classification and egress matrix, domain-specific export permissions, volume thresholds, approval rules, file-processing controls, destination policy, alert ownership, retention periods and synthetic test evidence. This policy does not authorize real-data exports, external integrations, production activation or migration of legacy data.

### L-45 — Secure notifications and messaging channels

**Question:** How should system notifications and messages avoid disclosing sensitive information while remaining useful and trustworthy?

Possible choices:
- **A. Full-detail notifications:** include operational details in email, push and message previews for convenience.
- **B. Minimal, authenticated notifications:** disclose only necessary generic information, keep sensitive details behind authenticated access, and govern delivery and preferences.
- **C. Disable all notifications:** avoid notification-related disclosure by suppressing every notification channel.

**Approved 2026-11-27 — option B (minimal, authenticated notifications and controlled messaging), selected under the user's standing authorization for ChatGPT to choose and record the recommended security option.**

Approved policy in principle:
- Treat email, SMS, push notifications, lock-screen previews, browser notifications and chat messages as potentially exposed channels; never assume the recipient's device or mailbox is private.
- Use generic notification text by default. Do not include payroll, health/absence reasons, authentication secrets, access tokens, sensitive employee details or confidential operational records in message bodies, subjects or previews.
- Direct recipients to the authenticated application to view details; re-check current identity, lifecycle, permission and scope when the protected content is opened.
- Verify recipient identity and channel ownership through an approved workflow before enabling sensitive account or employment-related notifications; avoid relying on user-supplied destination fields as proof of identity.
- Minimize notification content, metadata, recipients and retention; avoid exposing employee names or identifiers where a generic event notice is sufficient.
- Apply role- and scope-aware recipient selection, prevent cross-tenant or cross-department delivery, and re-evaluate authorization at dispatch time.
- Protect notification links with short-lived, single-purpose tokens where necessary; do not embed secrets or grant access merely by possession of a long-lived URL.
- Separate security-critical notices from optional operational notifications; define delivery, retry, expiry, deduplication and failure handling without leaking content through logs or provider diagnostics.
- Provide safe preference controls for optional notifications without allowing users to suppress mandatory security notices or required workflow communications.
- Use approved providers only after privacy, security, retention, data-location and onward-transfer review; minimize payloads sent to providers and revoke integrations when no longer approved.
- Audit notification configuration changes, privileged template changes and security-critical delivery outcomes using minimized metadata; restrict access to delivery logs.
- Test synthetic cases for lock-screen leakage, wrong-recipient routing, stale permissions, account switching, link replay, cross-scope delivery, provider failure and sensitive content in logs.

**Still required before implementation:** define notification classes and mandatory events, recipient verification, channel/provider approval, payload allowlists, link lifetime and replay controls, user preferences, delivery retry policy, retention, monitoring and synthetic test evidence. This policy does not authorize sending real notifications, connecting an external messaging provider or production activation.

### L-46 — Backend resource protection and automated abuse controls

**Question:** How should backend APIs and services resist automated abuse, excessive resource consumption and denial-of-service patterns without weakening legitimate access?

Possible choices:
- **A. Basic request throttling:** apply a shared rate limit with limited endpoint-specific controls.
- **B. Layered, risk-based resource protection:** enforce per-identity, per-operation and per-resource quotas, bounded workloads, abuse detection and safe degradation.
- **C. Broad unrestricted capacity:** rely primarily on infrastructure scaling and provider protections.

**Approved 2026-11-27 — option B (layered, risk-based resource protection), selected under the user's standing authorization for ChatGPT to choose and record the recommended security option.**

Approved policy in principle:
- Enforce server-side limits for request rates, concurrency, payload size, pagination, query complexity, execution time, batch size and generated output size.
- Apply differentiated quotas by verified actor, tenant, endpoint, operation and expensive resource; do not rely solely on client IP addresses or client-provided identity fields.
- Authenticate and authorize before expensive data access or processing wherever practical; derive actor identity and scope from verified server-side context.
- Bound fan-out, retries, recursion, file processing and downstream calls; use timeouts, cancellation, circuit breakers and backpressure to prevent cascading failures.
- Use idempotency keys and concurrency controls for retryable mutations; prevent duplicate or replayed requests from multiplying side effects.
- Protect costly workflows such as exports, reports, imports and administrative bulk operations with explicit permissions, quotas, queue limits and approval where required.
- Detect bursts, enumeration, repeated denials, credential abuse and unusual resource consumption; use proportionate progressive throttling and temporary restrictions with safe recovery.
- Prevent one tenant or actor from exhausting shared capacity; define fair-use isolation and priority for critical security and lifecycle operations.
- Return generic, non-sensitive error responses with appropriate retry guidance; do not expose internal topology, secrets, stack traces or quota internals that enable abuse.
- Monitor service health, saturation, queue depth, throttling, cost anomalies and downstream dependency failures; define alert ownership and incident escalation.
- Ensure emergency controls and allowlists are narrow, time-limited, audited and independently reviewed; no permanent bypass of authentication, authorization or tenant isolation.
- Test synthetic traffic for burst abuse, slow requests, oversized payloads, expensive queries, retry storms, cross-tenant exhaustion, enumeration and recovery after throttling.

**Still required before implementation:** define endpoint/resource cost classes, per-tenant and per-actor quotas, concurrency and queue limits, retry and idempotency rules, monitoring thresholds, fair-use policy, emergency procedures and synthetic load/abuse test evidence. This policy does not authorize production traffic changes, external load testing against live services or production activation.

### L-47 — Secure error handling and diagnostic information protection

**Question:** How should application errors, logs, traces and diagnostic reports support troubleshooting without disclosing secrets, personal data or internal security details?

Possible choices:
- **A. Detailed client errors:** return verbose exceptions and stack traces to speed up troubleshooting.
- **B. Layered safe diagnostics:** return generic client errors, retain minimized protected diagnostics server-side, and restrict access by role and purpose.
- **C. Suppress diagnostic detail:** discard most diagnostic information and return only generic failures.

**Approved 2026-11-27 — option B (layered safe diagnostics and protected error handling), selected under the user's standing authorization for ChatGPT to choose and record the recommended security option.**

Approved policy in principle:
- Return stable, generic client-facing error messages and opaque correlation identifiers; never expose stack traces, filesystem paths, database details, secrets, tokens, internal hostnames or authorization policy internals.
- Distinguish validation, authentication, authorization, conflict, throttling and service failure through safe status semantics without revealing whether protected records or accounts exist.
- Keep detailed diagnostics server-side, with strict access controls, purpose limitation, minimization and retention limits.
- Redact or exclude passwords, access/refresh tokens, session identifiers, API keys, secret values, payroll and health data, and unnecessary personal information from logs, traces, crash reports and support bundles.
- Validate and sanitize untrusted values before logging; prevent log injection, control characters, forged fields and unbounded attacker-controlled payloads.
- Use structured, consistently classified events with correlation IDs and timestamps; keep identifiers pseudonymous where possible and separate operational telemetry from audit evidence.
- Ensure diagnostic access is independently authorized and audited; support personnel receive only the minimum data necessary, for a limited period and approved purpose.
- Protect diagnostic stores against unauthorized read, alteration and deletion; define integrity, backup, retention and secure disposal requirements.
- Prevent monitoring providers and third-party error-reporting tools from receiving sensitive payloads by default; review data processing, access, residency, retention and onward transfers before enabling them.
- Fail safely if logging or monitoring dependencies are unavailable; diagnostics must never bypass authorization or block critical revocation and security controls.
- Test synthetic failures for secret leakage, cross-tenant data exposure, stack-trace disclosure, log injection, excessive payloads, correlation correctness and unauthorized diagnostic access.

**Still required before implementation:** define error taxonomy and response contract, redaction rules, structured event schema, diagnostic access roles, retention and integrity controls, provider approvals, alert ownership and synthetic leakage tests. This policy does not authorize production telemetry providers, real-data diagnostic collection or production activation.

### L-48 — Configuration integrity and environment security

**Question:** How should security-sensitive configuration and environment boundaries be protected against unauthorized, accidental or unreviewed changes?

Possible choices:
- **A. Basic configuration control:** restrict access to configuration files and rely on ordinary code review.
- **B. Governed configuration integrity:** classify security-sensitive settings, enforce least-privilege changes, independent review, provenance, validation and environment separation.
- **C. Unrestricted operational overrides:** allow administrators to change live settings directly for speed.

**Approved 2026-11-27 — option B (governed configuration integrity and environment separation), selected under the user's standing authorization for ChatGPT to choose and record the recommended security option.**

Approved policy in principle:
- Inventory and classify security-sensitive configuration, including authorization rules, feature flags, identity settings, integration endpoints, retention, logging and security controls.
- Keep development, test/emulator and production environments separate, with distinct identities, credentials, data and access policies; synthetic data only in non-production.
- Store configuration changes in version control or an equivalently protected, traceable system; prohibit secrets and personal data in configuration artifacts.
- Enforce least-privilege change permissions, peer review and independent approval for high-impact security or access-control changes; prohibit self-approval where separation is required.
- Validate configuration against schemas, safe defaults and policy constraints before acceptance; reject unknown, malformed, conflicting or insecure values.
- Require explicit, reviewed promotion between environments; never copy production secrets or real personal data into lower environments.
- Record actor, change, reason, review, version, environment, outcome and rollback reference in protected audit evidence.
- Detect unauthorized drift and unexpected feature-flag or security-setting changes; alert designated owners and fail closed when critical configuration cannot be trusted.
- Provide tested rollback and recovery procedures; emergency changes remain time-limited, scoped, independently reviewed and audited.
- Test synthetic scenarios for privilege abuse, environment crossover, unsafe defaults, configuration drift, tampering and failed rollback.

**Still required before implementation:** configuration inventory and ownership, environment matrix, schema and policy validation, change/approval workflow, promotion controls, secret references, drift detection, rollback procedure and synthetic test coverage. This policy does not authorize production configuration changes, feature-flag activation, real credentials or deployment.

### L-49 — Secure data import and ingestion

**Question:** How should files and externally supplied records be validated and processed to prevent malicious content, corruption, unauthorized data changes and unsafe imports?

Possible choices:
- **A. Basic file validation:** check file extension and required columns, then import records.
- **B. Defense-in-depth ingestion:** validate provenance, type, size, schema, content, authorization, integrity and business constraints; stage and review changes before commit.
- **C. Trusted-source bypass:** accept files from designated users or systems with minimal validation.

**Approved 2026-11-27 — option B (defense-in-depth data ingestion with staged validation), selected under the user's standing authorization for ChatGPT to choose and record the recommended security option.**

Approved policy in principle:
- Treat all uploaded files, imported rows, archives and external payloads as untrusted, regardless of sender or file extension.
- Allowlist required formats and enforce size, row, column, archive-expansion, processing-time and resource limits; reject malformed, encrypted or unsupported content unless a separately reviewed workflow supports it.
- Validate actual file structure and content rather than trusting names, MIME types, extensions or client-supplied metadata.
- Parse CSV and spreadsheet data safely; neutralize formula injection in values that may later be opened by spreadsheet software, and never execute macros, formulas, embedded scripts or active content during ingestion.
- Enforce strict schema, field allowlists, type/range constraints, encoding checks, canonical identifiers and domain-specific business rules; reject unknown authority-bearing fields.
- Authenticate the actor and independently authorize the exact import action, domain, organization/site scope, target records and permitted fields on the server.
- Stage imports for preview and validation; report row-level errors without exposing sensitive data, and require explicit confirmation or independent approval for high-impact or bulk changes.
- Detect duplicate, conflicting, stale and replayed records; use idempotency and concurrency/revision checks to prevent unintended overwrites.
- Preserve provenance and protected audit evidence, including source, actor, time, validation result, approval and outcome, while minimizing retained source content.
- Ensure imports cannot bypass lifecycle, ownership, UID binding, retention, legal-hold or domain authorization controls.
- Quarantine rejected files and temporary artifacts; apply malware scanning where supported, controlled retention and secure deletion.
- Test synthetic cases for malicious files, parser edge cases, formula injection, oversized inputs, duplicate/replayed rows, scope violations, partial failure and rollback.

**Still required before implementation:** supported-format inventory, size/resource thresholds, schema and field mappings, provenance requirements, staging/approval workflow, duplicate/conflict policy, quarantine and retention design, audit fields and synthetic test coverage. This policy does not authorize importing real personal data, automatic legacy migration, production data changes or deployment.

### L-50 — Secure export and document generation

**Question:** How should generated reports and exported documents preserve confidentiality, authorization, integrity and traceability throughout creation, delivery and retention?

Possible choices:
- **A. Basic export controls:** authorize the export request and generate files using ordinary application defaults.
- **B. End-to-end governed export:** enforce scoped authorization, minimized data, safe rendering, protected delivery, integrity and lifecycle controls.
- **C. Unrestricted document generation:** allow broad report generation and rely on recipient discretion.

**Approved 2026-11-27 — option B (end-to-end governed export and document generation), selected under the user's standing authorization for ChatGPT to choose and record the recommended security option.**

Approved policy in principle:
- Authorize every export server-side against the current actor, membership and lifecycle state, domain/action permission, organizational scope, purpose, requested fields and target records; do not rely on UI visibility or prior authorization.
- Apply data minimization and approved field allowlists to every report, PDF, spreadsheet, CSV and generated document; deny payroll, health and other restricted fields unless a separate domain-specific policy explicitly permits them.
- Require preview, explicit confirmation and independent approval where export volume, sensitivity or impact crosses defined thresholds; enforce quotas and anti-enumeration limits.
- Generate files in isolated, bounded processing contexts; escape untrusted content, prevent spreadsheet formula injection, disable active content and avoid unsafe template evaluation.
- Use controlled templates and versioned generation logic; validate output structure, metadata, formulas, embedded objects, links and unintended hidden content before release.
- Protect generated artifacts with encryption in transit and at rest where stored, access-controlled delivery, short-lived download links and recipient/scope verification; never expose public or guessable file URLs.
- Bind each artifact to an export request and record actor, purpose, scope, fields, template/version, time, approval, recipient, integrity reference and outcome in protected audit evidence without logging sensitive file contents.
- Define retention, expiry, revocation and secure deletion for temporary and delivered artifacts; prevent stale links or cached copies from remaining accessible after authorization or lifecycle changes.
- Add appropriate provenance markings or watermarks where justified by risk, without inserting unnecessary personal data into documents.
- Test synthetic cases for out-of-scope fields, stale authorization, recipient mismatch, formula injection, metadata leakage, hidden spreadsheet content, link expiry, tampering and bulk-export abuse.

**Still required before implementation:** export catalogue and field allowlists, sensitivity/volume thresholds, approval matrix, template governance, safe-rendering rules, storage/delivery architecture, retention schedule, artifact integrity design and synthetic test coverage. This policy does not authorize real-data exports, payroll/health reporting, bulk extraction or production activation.

### L-51 — Secure search and query authorization

**Question:** How should search, filtering, sorting, aggregation and query results be constrained to prevent indirect disclosure, enumeration and unauthorized access?

Possible choices:
- **A. UI-filtered search:** rely primarily on client-side filters and hide unauthorized fields in the interface.
- **B. Server-enforced query security:** authorize each query and constrain its execution and results by identity, domain, action, scope and approved fields.
- **C. Broad search with post-filtering:** query a wide dataset and remove unauthorized results after retrieval.

**Approved 2026-11-27 — option B (server-enforced query authorization and result minimization), selected under the user's standing authorization for ChatGPT to choose and record the recommended security option.**

Approved policy in principle:
- Treat search terms, filters, sort keys, pagination tokens, aggregations and requested projections as untrusted input.
- Authenticate and revalidate the actor, membership and lifecycle state for every request; enforce domain/action permissions, canonical ownership and organizational scope on the server before data access.
- Construct queries from server-controlled allowlists and scope constraints; never accept client-supplied tenant, organization, employee ownership or authorization predicates as authoritative.
- Apply authorization before retrieval and aggregation, not merely by hiding fields or filtering results in the client.
- Restrict searchable and sortable fields to explicitly approved attributes; deny sensitive payroll, health, identity and other restricted fields unless separately authorized for the specific purpose and scope.
- Prevent enumeration through bounded pagination, rate limits, minimum necessary result detail, controlled autocomplete and protection against sequential identifiers and wildcard scans.
- Treat counts, facets, suggestions, existence checks, error differences and timing as potential information channels; minimize or suppress them where they could reveal unauthorized records.
- Bind cursors and continuation tokens to actor, scope, query constraints and expiry; reject tampered, stale or cross-user token reuse.
- Enforce query complexity, execution-time, result-size and resource budgets; reject unsupported operators, malformed expressions and expensive unrestricted queries.
- Revalidate authorization and relevant revisions when serving subsequent pages or materialized results; fail closed when membership, lifecycle or scope changes.
- Audit sensitive searches and denied attempts with minimized metadata; avoid recording raw sensitive search terms unless justified and protected.
- Test synthetic cases for IDOR, scope expansion, filter manipulation, unauthorized counts, autocomplete leakage, pagination-token replay, stale membership and query abuse.

**Still required before implementation:** searchable-field catalogue, domain/action/scope matrix, query builder and cursor design, aggregation disclosure rules, rate/complexity thresholds, audit policy and synthetic security test coverage. This policy does not authorize broader employee search, access to real personal data, unrestricted analytics or production activation.

### L-52 — Concurrent data integrity and conflict control

**Question:** How should concurrent edits and overlapping operations be coordinated to prevent lost updates, inconsistent records, duplicate effects and unauthorized conflict resolution?

Possible choices:
- **A. Last-write-wins:** accept the latest submitted value and retain ordinary audit history.
- **B. Explicit concurrency control:** use server-enforced revisions, atomic operations, idempotency and conflict-aware workflows.
- **C. Client-side coordination:** rely on UI warnings and client timestamps to avoid simultaneous changes.

**Approved 2026-11-27 — option B (explicit server-enforced concurrency and conflict control), selected under the user's standing authorization for ChatGPT to choose and record the recommended security option.**

Approved policy in principle:
- Treat client timestamps, revision numbers and conflict-resolution claims as untrusted; derive authoritative state and concurrency checks on the server.
- Require expected-revision or equivalent conditional-write checks for mutable canonical records; reject stale writes rather than silently overwriting newer data.
- Use atomic transactions or equivalent consistency guarantees for related updates, ownership bindings, lifecycle changes, approvals and audit evidence.
- Define idempotency keys and bounded replay handling for operations that may be retried; ensure retries cannot duplicate payroll-affecting, scheduling, provisioning or other consequential effects.
- Make conflict outcomes explicit to the caller without disclosing records outside the caller's authorized scope; require a fresh read and authorized resubmission where needed.
- Do not resolve sensitive or high-impact conflicts with last-write-wins, client-side merges or silent field-level overwrites.
- Revalidate actor identity, membership, lifecycle, domain/action permission, scope and approval validity at commit time, including after any queue or approval delay.
- Preserve immutable or protected audit evidence of accepted changes, rejected stale writes, retries, conflict decisions and relevant revision transitions.
- Ensure multi-record workflows either commit consistently or fail safely with documented compensation; prevent partially applied authorization, transfer, provisioning and revocation operations.
- Define bounded locking, retry and contention policies to avoid deadlocks, unbounded retries and denial of service.
- Test synthetic simultaneous edits, stale revisions, duplicate submissions, reordered retries, partial failures, approval-state changes and cross-scope conflict attempts.

**Still required before implementation:** canonical revision model, transaction boundaries, idempotency-key design and retention, conflict UX/workflows, retry and locking budgets, audit schema, compensation strategy and synthetic concurrency test coverage. This policy does not authorize changes to production records, payroll operations, automatic conflict resolution or deployment.

### L-53 — Secure background jobs and scheduled processing

**Question:** How should queues, schedulers, workers and automated jobs be authorized and constrained so that delayed or unattended execution cannot outlive permissions or exceed its intended scope?

Possible choices:
- **A. Broad service account:** run background work with a shared service identity and rely on job configuration.
- **B. Scoped workload identity:** assign each workload a least-privilege identity, validate authority at execution time and constrain job inputs, retries and side effects.
- **C. User-context snapshot:** capture the initiating user's permissions when a job is queued and trust that snapshot until completion.

**Approved 2026-11-27 — option B (scoped workload identity and execution-time authorization), selected under the user's standing authorization for ChatGPT to choose and record the recommended security option.**

Approved policy in principle:
- Give each worker, scheduler and workload a distinct, non-human identity with only the domain, action and resource permissions it requires; prohibit shared universal service accounts.
- Authenticate workload identity and validate job provenance, integrity, schema, issuer, intended audience, environment and expiry before execution.
- Treat queue payloads and scheduling parameters as untrusted references, not as authorization grants; resolve canonical records and scope server-side.
- Revalidate current membership, lifecycle, ownership, policy and approval state at execution and before consequential side effects; queued user authorization must not remain valid merely because it was valid at enqueue time.
- Bind each job to an explicit purpose, tenant/domain scope, allowed operations, resource budget, deadline and maximum execution count.
- Use idempotent processing, bounded retries, dead-letter handling and replay protection; prevent duplicate or reordered jobs from creating duplicate consequential effects.
- Separate job submission, approval and execution for high-impact operations; workers must not self-approve or bypass required human oversight.
- Protect queue contents and results in transit and at rest; minimize sensitive payload data and prefer short-lived references to canonical records over copied personal data.
- Enforce concurrency, rate, timeout and resource limits per workload and organizational scope; isolate failures and prevent one tenant's workload from exhausting shared resources.
- Support cancellation, revocation and safe termination when permissions, lifecycle, configuration or job validity changes; define behavior for partially completed operations.
- Record workload identity, job provenance, authorization decision, scope, execution attempts, side effects, result and failure in protected audit evidence without logging secrets or unnecessary personal data.
- Monitor unusual job creation, privilege use, retry storms, queue growth, stale jobs and cross-scope access; require human-reviewed response for material anomalies.
- Test synthetic scenarios for forged payloads, stale authorization, replay, duplicate delivery, poisoned messages, privilege escalation, cross-tenant execution, cancellation and partial failure.

**Still required before implementation:** workload identity catalogue, per-job permission matrix, queue schema and integrity design, execution-time authorization contract, retry/dead-letter policy, cancellation and compensation workflows, resource budgets, audit/monitoring ownership and synthetic test coverage. This policy does not authorize unattended production jobs, real-data processing, broad service identities or deployment.

### L-54 — Secure onboarding, invitations and account activation

**Question:** How should employee onboarding, invitations and account activation establish verified identity and canonical account ownership without allowing fraudulent enrollment or privilege acquisition?

Possible choices:
- **A. Self-service activation:** allow invite recipients to activate accounts with an email link and basic profile matching.
- **B. Verified, independently approved provisioning:** bind verified identity to an authoritative employee record through a scoped, expiring invitation and independent approval workflow.
- **C. Administrator-created unrestricted accounts:** allow administrators to create accounts and assign roles directly.

**Approved 2026-11-27 — option B (verified identity, canonical binding and independent provisioning approval), selected under the user's standing authorization for ChatGPT to choose and record the recommended security option.**

Approved policy in principle:
- Treat invitations as short-lived, single-use workflow references, not as proof of identity, employment, organizational scope or permission.
- Verify the invitee's identity through an approved authentication and verification process before account activation or binding; do not rely solely on possession of an email address or invitation URL.
- Derive the canonical employee record, organization and permitted placement from authoritative server-side records; reject client-supplied UID, employee ID, role, organization or scope as authority.
- Require a unique, unambiguous active UID-to-Employee binding and prevent duplicate, conflicting or cross-organization bindings.
- Require independent approval for provisioning and sensitive account-to-employee binding changes; prohibit requester self-approval and enforce separation server-side.
- Bind invitation tokens cryptographically to their intended workflow, purpose and expiry; store only protected token verifiers, avoid plaintext secrets in logs and responses, and support immediate revocation.
- Revalidate invitation status, identity verification, employment lifecycle, target record, approval and current authorization atomically at activation time.
- Apply least-privilege initial access; do not infer manager, administrator or other elevated roles from invitation metadata or employee attributes without a separately approved role workflow.
- Notify relevant parties of invitation, activation, binding and rejection events using minimized content and verified destinations.
- Audit issuance, delivery attempt, verification, approval, activation, binding, expiry, revocation and denial with protected, minimized evidence.
- Provide safe recovery for expired, misdirected or compromised invitations; never reactivate a revoked invitation or silently transfer an existing binding.
- Test synthetic cases for invitation replay, token theft, email mismatch, duplicate employee records, conflicting bindings, self-approval, stale lifecycle state, role injection and concurrent activation.

**Still required before implementation:** identity-proofing assurance, invitation delivery and token lifecycle, canonical employee matching rules, approver quorum and separation, atomic binding contract, notification rules, recovery procedures and synthetic test coverage. This policy does not authorize real employee onboarding, real account activation, production invitations or privilege grants.

### L-55 — Secure account deactivation and credential revocation

**Question:** How should suspension, termination, compromise and role changes revoke account access and all dependent credentials, sessions, delegations and automated work?

Possible choices:
- **A. Disable sign-in only:** prevent new authentication and allow existing sessions and tokens to expire naturally.
- **B. Coordinated server-side revocation:** invalidate active access and dependent grants promptly, with lifecycle-aware checks at every protected operation.
- **C. Manual cleanup:** rely on administrators to identify and revoke each access path individually.

**Approved 2026-11-27 — option B (coordinated server-side revocation and lifecycle enforcement), selected under the user's standing authorization for ChatGPT to choose and record the recommended security option.**

Approved policy in principle:
- Treat suspension, termination, compromise, binding removal and privilege reduction as authoritative lifecycle events that trigger server-side access reevaluation.
- Revoke or invalidate active sessions, refresh tokens, recovery credentials, API keys, device grants, delegated permissions and workload authorizations as applicable; do not rely solely on client logout or natural token expiry.
- Enforce current account, membership, employment lifecycle, role, scope and binding status on every sensitive server-side operation, including callable functions, background jobs and queued work.
- Propagate revocation to integrations and third-party providers through tracked, retryable workflows; record pending revocations and escalate failures rather than silently treating them as complete.
- Cancel, quarantine or reauthorize queued and scheduled jobs when their initiating actor, target account, approval or scope becomes invalid; revalidate again before side effects.
- Apply immediate denial for high-risk compromise events and define bounded propagation targets for other lifecycle changes; fail closed when authoritative lifecycle state cannot be established.
- Preserve narrowly scoped personal access only where separately authorized, time-limited and isolated from operational privileges; never restore former roles automatically on reactivation.
- Protect emergency recovery and break-glass procedures with independent approval, explicit expiry, monitoring and post-event review; they must not bypass revocation silently.
- Notify affected users and designated security/administrative owners with minimized information, avoiding disclosure of sensitive employment or security details to unverified destinations.
- Maintain protected audit evidence of the triggering event, affected credentials and grants, revocation attempts, completion status, exceptions and reviewer actions.
- Define reconciliation jobs to detect orphaned sessions, stale grants, unknown credentials and failed provider revocations; remediation must be bounded and auditable.
- Test synthetic scenarios for active-session invalidation, refresh-token reuse, stale API keys, delegated access, queued-job execution after revocation, provider outage, partial failure and reactivation without privilege restoration.

**Still required before implementation:** lifecycle event catalogue and authoritative source, revocation propagation targets, credential/session inventory, provider integration contracts, retry and reconciliation design, exception ownership, notification rules and synthetic revocation test coverage. This policy does not authorize real account suspension, termination, credential changes or production activation.

### L-56 — Secure shared-device and workstation sessions

**Question:** What safeguards should protect employee accounts and sensitive operational information on shared, unattended, lost or potentially compromised workstations and devices?

Possible choices:
- **A. User-managed sign-out:** rely on employees to sign out and close browser windows when finished.
- **B. Centrally enforced device and session safeguards:** combine bounded inactivity and absolute session limits, reauthentication, server-side revocation and controlled local-data handling.
- **C. Persistent convenience sessions:** allow long-lived sessions on recognized devices with limited periodic checks.

**Approved 2026-11-27 — option B (centrally enforced shared-device and session safeguards), selected under the user's standing authorization for ChatGPT to choose and record the recommended security option.**

Approved policy in principle:
- Treat shared, kiosk, reception, office-floor and otherwise unattended workstations as untrusted; do not grant persistent trust solely because a device or browser was previously used.
- Require individual accounts and prohibit shared credentials; authenticate each user and bind authorization to the verified server-side identity and current employment/membership state.
- Apply short, risk-based inactivity timeouts and bounded absolute session lifetimes; require reauthentication after timeout, account switching, device-risk signals and sensitive actions.
- Ensure timeout, sign-out, account switch, suspension and revocation invalidate server-side sessions and relevant refresh credentials; closing a tab or clearing a client view is not sufficient.
- Provide an explicit, reliable sign-out and account-switch workflow that clears in-memory application state, sensitive browser caches, temporary files and locally retained artifacts to the extent technically controllable.
- Do not store passwords, refresh tokens or sensitive employee, payroll or absence data in LocalStorage, browser-readable persistent storage or shared-device caches; any specifically approved offline capability must have a separate threat review and bounded encrypted storage lifecycle.
- Use secure cookie and browser-session settings where applicable, protect against session fixation and cross-user state leakage, and prevent back-button or restored-tab access from exposing previously viewed data.
- Revalidate authorization on every protected backend operation; client-side screen locking and route hiding are usability controls, not security boundaries.
- Detect and respond to lost, stolen or compromised devices through session/device-grant revocation, credential rotation where warranted and incident procedures; device recognition must never override account or role revocation.
- Minimize information shown on lock screens, notifications, print queues and shared displays; prevent sensitive data from appearing in browser history, downloads or unprotected temporary artifacts.
- Define workstation handoff procedures, privacy screens and physical safeguards appropriate to the environment, with clear responsibility for unattended sessions.
- Log security-relevant session creation, reauthentication, timeout, sign-out, device revocation and anomalous reuse with minimized protected audit data.
- Test synthetic scenarios for idle timeout, absolute expiry, rapid user switching, restored tabs, cached responses, offline transitions, revoked devices, concurrent sessions and backend access after client lock.

**Still required before implementation:** device classes and risk profiles, timeout values, authentication/session provider capabilities, cookie and browser policy, local-data inventory, offline-access decision, device incident workflow, audit schema and synthetic cross-user isolation tests. This policy does not authorize device enrollment, real credential handling, workstation configuration changes or production activation.

### L-57 — Cryptographic and signing key rotation and compromise response

**Question:** How should cryptographic keys, signing keys, certificates and related secrets be generated, stored, rotated, retired and handled when compromise is suspected or confirmed?

Possible choices:
- **A. Manual replacement on incident:** rotate keys only when an operator identifies a concrete problem.
- **B. Governed lifecycle and rehearsed compromise response:** centrally inventory and protect keys, rotate on schedule and risk events, support controlled overlap and revocation, and verify recovery.
- **C. Long-lived keys for operational simplicity:** minimize rotation to reduce integration changes.

**Approved 2026-11-27 — option B (governed key lifecycle and rehearsed compromise response), selected under the user's standing authorization for ChatGPT to choose and record the recommended security option.**

Approved policy in principle:
- Maintain an authoritative inventory of cryptographic keys, signing keys, certificates, service credentials and key owners, recording purpose, environment, scope, creation time, rotation deadline, dependencies and retirement state without exposing secret material.
- Generate keys using approved cryptographic libraries and secure random generation; prohibit hard-coded, shared, manually copied or source-controlled production secrets.
- Store private keys and high-value secrets in an appropriately protected secret or key-management service, with least-privilege access, separation of duties, access logging and environment isolation.
- Define key purpose, algorithm, strength, permitted use and cryptoperiod; prohibit algorithm or key reuse across incompatible purposes and environments.
- Rotate keys on a documented schedule and immediately when required by suspected exposure, personnel or provider changes, cryptographic weakness, policy breach or incident response.
- Support controlled key-version transitions: publish or distribute new verification material safely, limit any dual-key acceptance window, track dependent services and reject retired or revoked keys after the defined transition.
- For signed artifacts and tokens, define key identifiers, verification rules, expiry and revocation behavior; ensure verifiers do not accept unknown, downgraded, expired or revoked keys.
- Protect backup and recovery copies of key material with equivalent controls; test restoration without weakening access restrictions or mixing environments.
- Establish a compromise playbook covering containment, key revocation, replacement, dependent credential rotation, impact assessment, validation of affected signatures/tokens, notification and evidence preservation.
- Make rotation and revocation operations authorized, reviewable, idempotent and auditable; never log private keys, secret values or recovery material.
- Monitor certificate expiry, failed rotations, unexpected key use, access anomalies and incomplete propagation; assign accountable owners and escalation paths.
- Test synthetic key generation, scheduled rotation, emergency rotation, old-key rejection, verifier overlap, rollback safety, backup recovery and partial integration failure.

**Still required before implementation:** key and certificate inventory, ownership and classification, approved algorithms and cryptoperiods, key-management provider and access model, dependent-service transition plan, compromise severity/runbooks, recovery controls, monitoring and synthetic integration tests. This policy does not authorize creating, importing, rotating or revoking real production keys or credentials.

### L-58 — Data retention, archival and verifiable deletion

**Question:** How should employee-domain data be retained, archived, restored, anonymized or deleted so that lifecycle obligations are enforced consistently and outcomes can be evidenced without retaining unnecessary personal data?

Possible choices:
- **A. Ad hoc retention:** leave retention and deletion to manual case-by-case handling.
- **B. Governed lifecycle schedules and verified disposition:** classify data, define approved retention triggers and periods, restrict archives, execute authorized disposition, and preserve minimized evidence.
- **C. Indefinite retention:** retain historical records by default for convenience and possible future use.

**Approved 2026-11-27 — option B (governed retention, archival and verified disposition), selected under the user's standing authorization for ChatGPT to choose and record the recommended security option.**

Approved policy in principle:
- Maintain a data inventory and classification mapping for each domain, record type, purpose, system, owner and processor; do not infer retention periods from technical defaults.
- Define and approve a retention schedule per category, with the lawful purpose, triggering event, period, applicable jurisdictional/privacy review, responsible owner and disposition method documented before implementation.
- Apply data minimization and purpose limitation throughout active use, archival, backup, export, analytics and support workflows; prohibit indefinite retention without a separately documented and approved basis.
- Treat archival as a restricted lifecycle state, not as continued ordinary operational access; enforce least privilege, access logging, integrity protection and explicit restoration approval.
- Ensure transfer, suspension, termination, account closure, dispute and legal-hold events trigger the relevant retention and access review without silently deleting records or extending access.
- Support verified deletion or irreversible anonymization only after authority, scope, retention obligations, legal holds and dependencies have been checked; propagate disposition to replicas, indexes, caches, exports and downstream processors where applicable.
- Define backup expiry and cryptographic-erasure controls where appropriate; document bounded residual backup retention and prevent routine restoration from reintroducing already-disposed data into active use.
- Make disposition jobs scoped, authorized, idempotent, retry-safe and observable; require preview or dry-run, stale-state checks and independent approval for high-impact or irreversible actions.
- Preserve minimized, tamper-resistant evidence of the request/authority, data categories and systems in scope, decision, execution time, method, outcome and exceptions, without copying deleted content or secrets into the audit record.
- Provide a controlled exception process for legal holds, disputes, investigations and statutory retention, with specific scope, authority, reason, review date, expiry and access restrictions; remove the hold and resume disposition when authorized.
- Give data subjects or authorized representatives a verified, tracked request path where applicable; record the outcome and reasons for any lawful limitation or refusal.
- Test synthetic cases for schedule boundaries, timezone and trigger semantics, partial failures, retries, replicas, backup restoration, legal holds, anonymization resistance and proof-of-disposition integrity.

**Still required before implementation:** domain-by-domain inventory and retention schedule, legal/privacy review and accountable owners, trigger and timezone semantics, archive access model, legal-hold workflow, deletion/anonymization standards, backup and processor propagation design, evidence schema, exception handling and synthetic end-to-end tests. This policy does not authorize deletion, anonymization, archival changes or retention changes to real data, nor production activation.

### L-59 — Security log monitoring, retention and tamper detection

**Question:** How should security and operational audit logs be monitored, retained and protected against tampering, unauthorized access, gaps and misuse while minimizing personal and sensitive data?

Possible choices:
- **A. Best-effort application logs:** rely on ordinary service logs and investigate only after a reported incident.
- **B. Governed, tamper-evident logging and monitored response:** define authoritative events, protected collection, integrity verification, retention and alert ownership.
- **C. Record everything indefinitely:** retain full request and response payloads for maximum investigative detail.

**Approved 2026-11-27 — option B (governed, minimized, tamper-evident logging and monitored response), selected under the user's standing authorization for ChatGPT to choose and record the recommended security option.**

Approved policy in principle:
- Define an authoritative event catalogue covering authentication, authorization denials, privileged actions, lifecycle transitions, sensitive reads and exports, configuration changes, key operations, data disposition, security incidents and background workloads.
- Generate security-relevant actor, target, action, outcome and timestamp fields server-side from verified context; never trust client-supplied audit metadata.
- Minimize event content: exclude passwords, tokens, private keys, invitation secrets, full document payloads, unnecessary personal data and sensitive before/after values.
- Send logs to a centrally governed, access-restricted destination with separation from the systems and identities that generate events; prevent ordinary application operators from silently altering or deleting retained evidence.
- Apply tamper-evidence controls such as chained integrity proofs, signed checkpoints or independently protected immutable storage, with documented verification and key governance.
- Monitor collection health, missing event sequences where detectable, ingestion delays, clock drift, integrity failures, retention failures, unusual privileged access and suspicious event patterns.
- Define actionable alert thresholds, severity, accountable responders, escalation paths and human-reviewed containment; monitoring signals alone must not silently impose irreversible employment or account decisions.
- Restrict log search and export by role, purpose, time window and field; audit access to logs themselves and protect investigative queries and derived reports.
- Define retention and deletion schedules for each log class, legal-hold handling and controlled disposal consistent with L-58; prohibit indefinite retention by default.
- Synchronize clocks using approved sources and record time semantics consistently, including UTC storage and explicit handling of event time versus ingestion time.
- Ensure critical security events are captured even when business operations fail; define safe buffering, bounded retry and fail-closed behavior for high-risk operations when required audit evidence cannot be durably recorded.
- Protect log transport and storage with encryption, managed keys, least-privilege identities, environment separation, backup and tested recovery.
- Test synthetic cases for forged client metadata, dropped or delayed events, duplicate delivery, clock skew, tampering, compromised log-writer credentials, alert routing, retention expiry and audit-access abuse.

**Still required before implementation:** event taxonomy and severity mapping, source and collector architecture, integrity mechanism and key ownership, clock and ordering semantics, retention schedule, access roles, alert thresholds and responders, outage behavior, privacy review, evidence verification procedures and synthetic end-to-end tests. This policy does not authorize production log collection, monitoring integrations, retention changes or deployment.

### L-60 — Secure service-to-service communication and machine identity

**Question:** How should internal services, callable functions, background workers and external integrations authenticate one another and protect service-to-service traffic?

Possible choices:
- **A. Shared static credentials:** use a small set of long-lived shared secrets across services for operational simplicity.
- **B. Workload-specific identity and short-lived credentials:** authenticate each workload independently, authorize explicit audiences and actions, and protect transport end to end.
- **C. Network location as trust:** treat traffic from internal networks as trusted without strong per-workload authentication.

**Approved 2026-11-27 — option B (workload-specific identity and short-lived credentials), selected under the user's standing authorization for ChatGPT to choose and record the recommended security option.**

Approved policy in principle:
- Assign each service, callable function, scheduled job and integration a distinct, attributable workload identity; prohibit shared human accounts and broad shared service credentials.
- Authenticate workloads using an approved identity mechanism with short-lived, audience-bound credentials and verifiable issuer, subject, expiry and intended service.
- Authorize every service-to-service operation server-side by explicit caller identity, target service, action, domain and resource scope; network location or possession of a generic internal token is never sufficient authorization.
- Apply mutual TLS or an equivalent authenticated transport mechanism where supported and proportionate; validate certificates, trust roots, names, expiry and revocation, and protect against downgrade or insecure fallback.
- Keep credentials and private keys in managed secret/key services, restrict access to the workload that needs them, rotate automatically where safely supported and revoke promptly on compromise or workload retirement.
- Separate identities and credentials by environment and purpose; prohibit development, emulator, staging and production credential reuse.
- Prevent end-user tokens from being repurposed as machine credentials; define explicit, validated delegation or token exchange when user context must flow to a downstream service.
- Propagate only the minimum verified actor and authorization context required; downstream services must not trust caller-supplied role, tenant, employee, scope or audit claims without cryptographic validation and canonical authorization checks.
- Bound permissions, quotas, request size, execution time and destinations; use allowlisted service endpoints and outbound controls to reduce SSRF and confused-deputy risks.
- Make retries and asynchronous handoffs authenticated, scoped, replay-resistant where required, idempotent and auditable; bind messages to their intended workload and operation.
- Fail closed for sensitive operations when workload identity, certificate validation, authorization or revocation status cannot be established; define safe degradation for non-sensitive availability paths.
- Monitor workload identity issuance, credential use, unusual service-to-service calls, authorization failures, certificate expiry and revocation propagation without logging secrets or unnecessary payloads.
- Test synthetic cases for forged service identities, audience confusion, cross-environment credential reuse, expired/revoked credentials, compromised workloads, replay, downgrade, unauthorized destinations and downstream scope escalation.

**Still required before implementation:** workload and service inventory, identity provider and trust model, token/certificate profiles, service/action authorization matrix, user-context delegation contract, environment isolation, rotation and revocation integration, network/destination policy, incident ownership, monitoring and synthetic end-to-end tests. This policy does not authorize creating production identities, issuing real credentials, changing network configuration or deploying services.

### L-61 — Privacy protection for test data, fixtures and development environments

**Question:** How should test fixtures, development datasets, debugging captures and non-production environments avoid exposing real employee or collaborator information while remaining useful for verification?

Possible choices:
- **A. Reuse production copies:** periodically copy production data into development and test environments.
- **B. Synthetic-first and controlled de-identification:** use generated synthetic data by default, with narrowly governed exceptions only after privacy and security review.
- **C. Developer-managed samples:** allow teams to create and retain local extracts as needed.

**Approved 2026-11-27 — option B (synthetic-first testing and tightly governed exceptions), selected under the user's standing authorization for ChatGPT to choose and record the recommended security option.**

Approved policy in principle:
- Use generated synthetic fixtures as the default and required baseline for development, demonstrations, automated tests, documentation, screenshots and bug reproduction.
- Do not copy production databases, employee records, payroll, absence information, identity documents, credentials, logs or support exports into non-production environments.
- Ensure synthetic records use fictional identities, domains, contact details, identifiers and organizational structures that cannot reasonably be mistaken for real people or real accounts; never embed real UID, email, phone, IBAN, tokens or secrets.
- Keep fixture generation deterministic where reproducibility is needed, while ensuring generated values cannot collide with real account identifiers or grant access to real systems.
- Treat pseudonymized, masked, hashed or otherwise transformed real data as personal data unless a documented assessment establishes effective anonymization for the intended context.
- Permit any exceptional use of real-derived data only after documented necessity, purpose limitation, data minimization, privacy/security review, legal basis/authority confirmation, owner approval and a time-bounded access plan; synthetic alternatives must be assessed first.
- If an exception is approved, use an isolated controlled environment, minimum field and record scope, strong access restrictions, encryption, audit, expiry and verified deletion; prohibit local uncontrolled copies and onward sharing.
- Keep development, test, Emulator, staging and production identities, credentials, storage and network access separate; test environments must not silently connect to production services or send real notifications.
- Use fake providers, sandbox endpoints and deterministic test doubles for email, SMS, payment, identity and external integrations; ensure test messages cannot reach real recipients.
- Prevent secrets and personal data from entering source control, issue trackers, crash reports, screenshots, CI artifacts, logs, recordings and AI prompts; scan and redact accidental disclosures.
- Define fixture ownership, provenance, versioning, retention and cleanup; include safe reset procedures that cannot target production data.
- Test synthetic cases for direct and indirect identifiers, rare combinations, free-text leakage, fixture collision, cross-environment access, artifact retention and accidental outbound communication.

**Still required before implementation:** fixture-generation standard and ownership, synthetic data schema/catalogue, environment and credential isolation, approved fake-provider strategy, exception and privacy-review workflow, scanning/redaction controls, artifact retention and cleanup rules, and automated negative tests. This policy does not authorize copying, importing or processing real employee/collaborator data in test or development environments, nor production access or deployment.

### L-62 — Secure software release, build and distribution pipeline

**Question:** How should source changes be built, verified, packaged, signed, promoted and distributed so that artifacts are traceable, reproducible and protected against unauthorized substitution?

Possible choices:
- **A. Developer-controlled releases:** developers build and distribute artifacts manually from local workstations.
- **B. Governed, isolated and attestable release pipeline:** use protected source controls, isolated reproducible builds, verified dependencies, artifact provenance, signing and controlled promotion.
- **C. Trust the latest successful build:** distribute whichever artifact is most recent without a formal provenance or approval chain.

**Approved 2026-11-27 — option B (governed, isolated and attestable release pipeline), selected under the user's standing authorization for ChatGPT to choose and record the recommended security option.**

Approved policy in principle:
- Treat the protected source revision, reviewed change set and approved build definition as the authoritative inputs; prohibit release builds from unreviewed branches or uncontrolled local workstations.
- Require peer review, branch protection, required checks and separation of duties for security-sensitive changes, workflow modifications, release configuration and signing policy.
- Run builds in ephemeral, isolated workers with least-privilege identities, no unnecessary network access, no persistent shared workspace and environment-specific credentials.
- Pin dependencies and build tools, verify provenance/integrity, use lockfiles and controlled registries, and apply vulnerability and license review gates appropriate to risk.
- Make build inputs explicit and versioned; aim for reproducible builds and retain enough metadata to independently reproduce or verify the artifact.
- Generate machine-readable provenance/attestation linking source commit, build definition, dependencies, builder identity, test evidence and artifact digest.
- Sign release artifacts and attestations with protected, purpose-specific keys; verify signatures and digests before promotion, installation or distribution.
- Prevent untrusted pull-request code from accessing release secrets, signing keys, privileged runners or production credentials.
- Promote the same immutable artifact through environments; do not rebuild silently between test, staging and production, and require explicit approvals and environment gates for each promotion.
- Keep release permissions separate from code-write and ordinary admin permissions; require independent approval for production release and emergency bypasses.
- Maintain an inventory of released artifacts, versions, digests, provenance, approvers, deployment targets and rollback compatibility; support prompt withdrawal and revocation of compromised artifacts.
- Protect build logs and artifacts against unauthorized access and tampering; redact secrets and personal data and apply retention/deletion rules.
- Test synthetic scenarios for dependency substitution, compromised runner, poisoned cache, untrusted PR secret access, signature mismatch, provenance gaps, artifact replacement and rollback failure.

**Still required before implementation:** source and branch protection configuration, build platform and runner isolation, dependency/registry policy, reproducibility requirements, provenance format and verifier, signing-key custody/rotation, approval matrix, artifact registry, promotion and rollback workflows, emergency release controls, retention and synthetic end-to-end tests. This policy does not authorize a production build, signing with real keys, artifact distribution, deployment or release activation.

### L-63 — Controlled deployment and infrastructure change management

**Question:** How should verified software artifacts and infrastructure/configuration changes be authorized, deployed, monitored and rolled back without allowing unreviewed or untraceable changes to affect protected environments?

Possible choices:
- **A. Operator-directed changes:** authorized operators deploy or change infrastructure manually using local procedures.
- **B. Governed deployment with explicit approvals and verified rollback:** deploy immutable verified artifacts through controlled environment gates, reviewed infrastructure changes, monitored rollout and tested recovery.
- **C. Automatic promotion:** deploy changes automatically after build completion, without environment-specific authorization or operational readiness checks.

**Approved 2026-11-27 — option B (governed deployment with explicit approvals and verified rollback), selected under the user's standing authorization for ChatGPT to choose and record the recommended security option.**

Approved policy in principle:
- Treat deployment and infrastructure modification as privileged, separately authorized actions; successful build or artifact signing alone does not authorize deployment.
- Deploy only immutable artifacts whose source revision, provenance, signatures, digests and required verification evidence have been independently validated.
- Require environment-specific approval gates, separation of duties and named accountable owners; production approval must be distinct from code authorship and ordinary repository administration.
- Define and review infrastructure/configuration as code where practical; require peer review, policy validation, change history and protected state before applying changes.
- Restrict deployment identities and runners to the minimum environment, resources and actions required; use short-lived credentials and prohibit untrusted pull-request workflows from obtaining deployment secrets.
- Separate development, test, Emulator, staging and production accounts, networks, data stores, secrets and permissions; block accidental cross-environment targeting by default.
- Validate readiness before rollout, including required tests, migrations compatibility, dependency/service health, capacity, security controls, monitoring and backup/restore prerequisites.
- Use staged rollout, health checks and measurable stop/rollback criteria proportionate to change risk; pause automatically on defined safety signals and require human review for high-impact changes.
- Apply schema and data changes through versioned, backward-compatible and explicitly approved migration plans; prohibit destructive or irreversible production data changes without separate authorization, verified backup and recovery plan.
- Preserve a known-good deployment reference and test rollback procedures; distinguish application rollback from database/state rollback and do not assume data changes are automatically reversible.
- Detect and investigate configuration drift and out-of-band changes; reconcile only through reviewed, authorized workflows and preserve evidence of emergency changes.
- Record actor, approver, target environment, artifact digest, source revision, configuration version, change ticket, timestamps, health outcome and rollback actions in protected audit records without secrets or unnecessary personal data.
- Provide a narrowly scoped emergency path with documented reason, time limit, independent retrospective review and prompt restoration of normal controls; emergency access must not become a standing bypass.
- Test synthetic scenarios for wrong-environment targeting, unauthorized deployment, artifact substitution, compromised deploy identity, failed health checks, partial rollout, incompatible schema changes, rollback failure, drift and emergency-path abuse.

**Still required before implementation:** environment inventory and boundaries, deployment role/approval matrix, infrastructure-as-code standards, protected runner and credential design, readiness criteria, rollout/stop thresholds, migration compatibility rules, rollback and restore runbooks, drift detection, emergency procedure, audit schema, retention and synthetic end-to-end tests. This policy does not authorize production deployment, real infrastructure changes, real data migrations, Firebase activation or release execution.

### L-64 — Security assurance, independent review and risk acceptance

**Question:** What independent assurance and formal risk-acceptance process must be completed before security-sensitive capabilities or material changes are considered ready for use?

Possible choices:
- **A. Team self-attestation:** the implementation team declares completion based on its own checklist and tests.
- **B. Risk-based independent assurance and time-bounded exception governance:** require traceable evidence, reviewers independent of implementation for material risks, explicit residual-risk ownership and expiry for exceptions.
- **C. External certification for every change:** require a formal external certification before any software or configuration change can proceed.

**Approved 2026-11-27 — option B (risk-based independent assurance and time-bounded exception governance), selected under the user's standing authorization for ChatGPT to choose and record the recommended security option.**

Approved policy in principle:
- Define security assurance scope from documented assets, data classifications, threat models, trust boundaries, user impact and change risk; scale depth to risk without waiving baseline controls.
- Maintain traceability from security requirements and approved decisions to implementation, code review, threat analysis, test cases, results, artifacts and release/deployment records.
- Require independent review by a qualified person who did not author or solely implement the material control being assessed; identify conflicts of interest and escalate unresolved disagreements.
- Require targeted security testing for authentication, authorization, ownership, organizational scope, sensitive-field exposure, lifecycle revocation, concurrency, abuse controls, logging, privacy and recovery as applicable to the change.
- Include negative tests and adversarial cases; passing happy-path tests alone is insufficient evidence of enforcement.
- Record test environment, synthetic fixture version, source commit, tool versions, execution time, results, failures, limitations and artifact digest; do not describe unexecuted or stale tests as passing.
- Treat static analysis, dependency scanning, automated tests and external assessments as complementary evidence, not substitutes for design review or runtime authorization verification.
- Block release/use when critical security checks fail, required evidence is missing, a material finding is unresolved, or the tested artifact cannot be tied to the candidate artifact.
- Require each residual-risk exception to state the affected asset/control, threat and impact, reason, compensating controls, scope, accountable risk owner, independent approver, monitoring, remediation plan and explicit expiry.
- Prohibit self-approval of exceptions by the implementer or sole risk owner; prohibit exceptions that waive legal obligations, identity/ownership checks, tenant isolation, or fundamental authorization boundaries.
- Reassess exceptions on expiry, material change, incident, newly discovered vulnerability or changed threat context; expired exceptions fail closed and block the affected capability until renewed or remediated.
- Preserve review evidence and decisions in protected, access-controlled records with retention and integrity safeguards; avoid storing secrets or unnecessary personal data.
- Distinguish policy approval, design approval, implementation completion, test evidence, independent assurance, release authorization and production operation as separate states; never infer one from another.
- Test synthetic scenarios for false-positive assurance, missing evidence, stale test results, reviewer conflicts, unapproved risk acceptance, expired exceptions and artifact/evidence mismatch.

**Still required before implementation:** assurance ownership and reviewer qualifications, risk tiers and review triggers, evidence catalogue and retention, required test matrix, finding severity and blocking thresholds, exception workflow and approver matrix, expiry enforcement, and independent review exercises. This policy does not certify the system, attest that controls are implemented, declare tests passed, authorize production activation or replace legal/privacy review.

### L-65 — Security incident disclosure and coordinated vulnerability reporting

**Question:** How should security vulnerabilities and incidents affecting the application, its users, integrations or data be reported, triaged, communicated and disclosed while protecting affected people and preserving response integrity?

Possible choices:
- **A. Ad hoc disclosure:** handle reports and notifications case by case without a defined intake, triage or disclosure process.
- **B. Coordinated, risk-based disclosure and incident communications:** provide a protected reporting channel, accountable triage, coordinated remediation and legally reviewed, timely communication to affected parties.
- **C. Immediate public disclosure:** publish all reports and incident details as soon as received, regardless of validation, exploitability or remediation status.

**Approved 2026-11-27 — option B (coordinated, risk-based disclosure and incident communications), selected under the user's standing authorization for ChatGPT to choose and record the recommended security option.**

Approved policy in principle:
- Establish a discoverable, monitored security reporting channel with clear instructions, acknowledgement expectations and a safe method for submitting evidence without requesting passwords, tokens, employee records or unnecessary personal data.
- Define accountable security, engineering, privacy/legal, operational and communications owners; maintain escalation and deputy coverage so reports are not dependent on one individual.
- Triage reports promptly using severity, exploitability, affected assets and data, exposure scope, active exploitation, safety impact and available mitigations; distinguish confirmed findings from unverified claims.
- Acknowledge good-faith reports, protect reporter confidentiality where feasible, prohibit retaliation for responsible disclosure and define coordinated disclosure expectations and reasonable remediation coordination.
- Preserve relevant evidence with integrity and access controls; minimize collection, restrict access, record handling and avoid altering evidence during investigation.
- Coordinate containment, remediation, validation and release through the approved incident and change processes; do not expose exploit details that materially increase harm before effective mitigation is available.
- Determine notification obligations and deadlines with qualified privacy/legal review; communicate promptly and accurately to affected people and relevant authorities when required, without waiting for complete root-cause certainty where law or safety requires earlier notice.
- Provide affected users with actionable information: what is known, what data or functions may be affected, relevant dates, steps taken, protective actions they can take and a safe contact channel; avoid speculation and unnecessary technical or personal details.
- Coordinate disclosures with relevant providers, processors, integration partners and responsible authorities when their systems or obligations are involved; establish contractual notification and cooperation expectations.
- Publish remediation advisories and security updates with affected versions, severity, mitigations and upgrade guidance once disclosure is safe and validated; do not reveal secrets, personal data or exploitable details unnecessarily.
- Track report and incident status, decisions, timelines, notifications, remediation evidence and lessons learned in protected records; apply retention and deletion rules.
- Review the process periodically and after material incidents, including tabletop exercises for active exploitation, data exposure, third-party compromise, reporter conflict and delayed notification.
- Test synthetic scenarios for report-channel abuse, missed escalation, false reports, evidence leakage, premature disclosure, notification failure, third-party dependency and overdue remediation.

**Still required before implementation:** reporting-channel ownership and availability, triage severity matrix and response targets, responsible disclosure terms, incident/communications authority, privacy/legal notification decision workflow, provider contract requirements, evidence handling, advisory publication process, retention and exercise schedule. This policy does not assert that an incident has occurred, that notifications have been made, or that any vulnerability has been remediated; it does not authorize public disclosure of private data or exploit details.

### L-66 — Privacy governance, data protection impact and change review

**Question:** How should privacy risks, personal-data processing changes and data-subject impacts be assessed, approved, monitored and revisited throughout the system lifecycle?

Possible choices:
- **A. Initial notice only:** document privacy information at project start and revisit only after a complaint or incident.
- **B. Continuous, risk-based privacy governance:** maintain processing records, assess material changes before release, apply privacy-by-design controls and review residual risks throughout the lifecycle.
- **C. Blanket prohibition:** prohibit all processing of personal data, including strictly necessary employment and account operations.

**Approved 2026-11-27 — option B (continuous, risk-based privacy governance), selected under the user's standing authorization for ChatGPT to choose and record the recommended security option.**

Approved policy in principle:
- Maintain an accurate inventory of personal-data processing purposes, categories, data subjects, sources, recipients, processors, locations, retention periods, access roles and applicable safeguards.
- Identify and document the applicable controller, processor and other organizational responsibilities before enabling a processing activity; do not infer legal roles solely from technical architecture.
- Establish a lawful-purpose and necessity review for each processing purpose, with data minimization, purpose limitation, accuracy, transparency, storage limitation and confidentiality safeguards.
- Assess privacy implications during design and before material changes to data categories, access, profiling/automation, integrations, exports, retention, hosting locations or processing purposes.
- Perform a formal data protection impact assessment where legally required or where the nature, scope, context and purposes indicate likely high risk; document screening rationale when a full assessment is not required.
- Consult qualified privacy/legal specialists and, where legally required, the competent supervisory authority before processing that cannot proceed lawfully without prior consultation.
- Apply privacy by design and default: deny optional collection and exposure, separate domains and purposes, minimize identifiers, restrict access, use synthetic data in non-production and avoid sensitive data in logs, notifications, analytics and AI prompts.
- Document data-subject rights workflows, identity and authority verification, response ownership, deadlines, exceptions, legal holds, third-party coordination and evidence of outcomes.
- Govern processors and other recipients through documented due diligence, instructions, purpose and scope limits, security obligations, subprocessors, location/transfer review, incident cooperation, audit rights and secure termination/deletion.
- Review international or cross-border data transfers and applicable safeguards before enabling them; do not assume a provider's location, contract or encryption alone resolves transfer requirements.
- Define retention and deletion by data domain and purpose, including backups, exports, logs, derived data and processor copies; preserve only legally justified records and document exceptions.
- Reassess privacy risks after incidents, complaints, audit findings, new vulnerabilities, legal changes, material product changes or changes in organizational roles and processing context.
- Maintain accountable owners, review dates, decisions, residual risks, mitigations and evidence; require independent review for material or high-risk processing and time-bound approval of any permissible exception.
- Test synthetic scenarios for excess collection, unauthorized secondary use, cross-scope disclosure, rights-request failure, processor offboarding, retention expiry, cross-border transfer gaps and privacy leakage through diagnostics or AI tooling.

**Still required before implementation:** controller/processor role determination, processing inventory and purposes, lawful-basis assessment by qualified counsel/privacy owner, data retention schedule, DPIA screening and assessment criteria, rights-request procedures, processor register and contracts, transfer assessment, privacy review gates, accountable owners and synthetic validation. This policy is not legal advice, does not establish a lawful basis or complete a DPIA, and does not authorize new personal-data processing, real-data imports, production activation or disclosure.

### L-67 — Accessibility, inclusive design and assistive-technology security

**Question:** How should accessibility and inclusive interaction be incorporated into employee workflows while ensuring that assistive technologies, alternative input methods and accessible representations do not weaken authentication, authorization, privacy or audit controls?

Possible choices:
- **A. Minimum visual compliance:** prioritize visual layout and address assistive-technology support only when reported.
- **B. Accessibility by design with equivalent security:** build and test accessible workflows across input/output modalities while preserving the same authorization, confirmation and privacy guarantees.
- **C. Separate accessible mode:** provide a simplified alternate interface with reduced security controls to ease interaction.

**Approved 2026-11-27 — option B (accessibility by design with equivalent security), selected under the user's standing authorization for ChatGPT to choose and record the recommended security option.**

Approved policy in principle:
- Treat accessibility as a core quality and security requirement throughout design, implementation, testing and maintenance, using applicable recognized standards and legal requirements as acceptance criteria.
- Support keyboard-only operation, screen readers, visible focus, sufficient contrast, scalable text, clear labels, semantic structure, accessible validation and understandable error recovery.
- Ensure critical workflows—including authentication, account recovery, employee self-service, shift proposals, approvals, consent/notice interactions and security reporting—are operable with supported assistive technologies and alternative input methods.
- Preserve the same server-side identity, ownership, role, scope, field and lifecycle authorization checks across all interface modes; accessibility accommodations must not create bypasses or weaker permissions.
- Provide accessible alternatives to visual-only challenges and time-limited interactions without exposing authentication secrets, weakening identity verification or making recovery less secure.
- Do not rely on color, position, sound, animation, drag-and-drop or visual-only indicators as the sole means of conveying status, errors, warnings or required actions.
- Announce dynamic status and validation changes appropriately to assistive technology while minimizing sensitive information exposed through screen readers, notifications, shared displays or audio output.
- Make confirmation, cancellation, undo and destructive-action safeguards accessible and understandable; avoid inaccessible timeouts and provide safe extension or reauthentication patterns where appropriate.
- Respect user-controlled text scaling, reduced motion and display preferences without hiding security notices, audit-relevant confirmations or essential workflow information.
- Avoid requiring disclosure of a disability or medical diagnosis to use ordinary accessible functionality; any individualized accommodation data, if ever required, needs separate legal/privacy review and strict access controls.
- Ensure third-party components and integrations meet accessibility and security requirements; review embedded widgets, identity providers and document formats before adoption.
- Test with automated accessibility tools and representative manual assistive-technology scenarios; include keyboard, screen-reader, zoom/reflow, contrast, touch target, error recovery and end-to-end workflow coverage.
- Record accessibility defects with severity, affected workflows, supported technologies, mitigations and remediation owners; block release for defects that prevent secure completion of critical workflows or cause authorization/privacy failures.
- Test synthetic scenarios for inaccessible MFA/recovery, keyboard trap, screen-reader disclosure, focus loss during approval, timeout-induced unsafe action, inaccessible error handling and alternate-mode permission mismatch.

**Still required before implementation:** applicable accessibility standard and conformance target, supported browser/device/assistive-technology matrix, design-system semantics, authentication and timeout accommodations, third-party review criteria, manual test protocol, defect severity/blocking rules and remediation ownership. This policy does not certify accessibility conformance, authorize weaker authentication or permissions, or approve production activation.

### L-68 — Data quality, accuracy, correction and provenance governance

**Question:** What controls must govern the quality, accuracy, currency and traceability of employee-domain data without treating unverified information as authoritative?

**Approved 2026-11-27 — option B (governed quality and provenance controls), by delegated user authorization to select the recommended option.**

- Maintain an explicit field-level source-of-truth catalogue identifying the authoritative system or record, accountable owner, permitted writers, validation rules, update process and expected freshness for each canonical field. A user's role, an imported file, a client cache or a more recent timestamp does not by itself establish authority.
- Preserve data provenance appropriate to the field and risk: origin/source reference, capture or effective time, ingestion time, responsible actor or workload identity, validation and approval outcome, transformation/version where relevant, and links to the resulting canonical revision. Minimize provenance metadata and protect it from unauthorized alteration.
- Distinguish effective dates, event times, record-creation times and processing times; define timezone and precision semantics. Do not silently reinterpret missing, ambiguous, future-dated, stale or conflicting values.
- Validate types, formats, enumerations, relationships, domain constraints, referential integrity and cross-field consistency on the server before accepting a change. Reject unknown fields and client-supplied authority, ownership, approval or provenance claims. Validation success does not prove the source information is factually correct.
- Treat imported, synchronized, manually entered and legacy values according to an explicit trust classification. Quarantine or stage untrusted and conflicting inputs for review; do not silently overwrite canonical data, merge records, infer missing employment facts or perform automatic legacy migration.
- Route disputed or inaccurate personal/employment data through L-10's tracked correction process, including authoritative-source verification, independent approval where required, revision/concurrency checks and protected correction history. Preserve the distinction between a request, a verified fact, an approved correction and an applied canonical change.
- Provide authorized users with appropriately scoped indicators for source, last verification/update time and unresolved quality issues where operationally necessary. Do not expose internal evidence, third-party personal data or restricted provenance merely to explain a value.
- Define freshness expectations and periodic/event-driven reconciliation for critical fields. Detect duplicates, orphaned bindings, impossible transitions, conflicting values and unexplained changes; route findings to an accountable human owner rather than automatically changing permissions, identity bindings, payroll or lifecycle state.
- Keep quality metrics and diagnostic reports minimized, access-controlled and auditable. Do not use quality scores as the sole basis for employment decisions, access grants, disciplinary action or automated adverse outcomes.
- Test synthetic cases for forged provenance, stale imports, duplicate employees, conflicting authoritative sources, invalid effective dates/timezones, unauthorized field writes, correction races, orphaned references, silent overwrite attempts and leakage through quality reports.

**Still required before implementation:** field-level source-of-truth and ownership catalogue; trust classification and acceptable evidence by field; freshness/reconciliation schedules; timestamp and timezone semantics; validation and conflict-resolution rules; quarantine and human-review workflow; provenance schema, integrity and retention controls; quality-issue ownership and escalation; and synthetic Emulator tests. This policy does not certify data accuracy, authorize automatic reconciliation or legacy migration, permit direct client writes, change canonical ownership or access permissions, or authorize real-data processing or production activation.

### L-69 — Employee leave lifecycle and temporary work-status transitions

**Question:** How should approved employee leave and other temporary work-status transitions affect operational access, assignments and historical records without exposing sensitive reasons or creating ambiguous authorization windows?

**Approved 2026-11-27 — option B (explicit, time-bounded lifecycle transitions with minimized data and scoped access), selected under the user's standing authorization for ChatGPT to choose and record the recommended security option.**

- Represent a leave or temporary work-status transition only through an explicitly defined, backend-authorized lifecycle event with a canonical employee binding, approved effective start/end semantics, responsible authority and protected audit evidence. A client-side flag, calendar entry or absence request alone does not change account lifecycle or permissions.
- Maintain a reviewed transition catalogue mapping each permitted event type to its operational consequences, affected capabilities, effective-time behavior, required approvals, expiry/review and return-to-work process. Unknown, contradictory, incomplete or expired states fail closed for affected operational actions.
- Separate the employee's employment relationship, authentication account, organizational placement, shift assignment and domain permissions. A temporary leave must not silently terminate employment, delete the employee, change UID bindings, transfer ownership or restore/revoke unrelated privileges.
- Apply only the minimum access restrictions necessary for the approved transition and documented operational purpose. Revoke or suspend specific operational capabilities when justified; preserve separately authorized self-service, privacy-request, payslip or other statutory access only through independently reviewed permissions. No blanket administrator or manager override.
- Expose to managers and scheduling workflows only a minimized availability/status signal and relevant effective dates where authorized. Do not disclose medical diagnosis, leave reason, protected category, supporting documents or other sensitive details through roster, notifications, search, exports, audit views or analytics.
- Prevent new assignments or approvals that conflict with an effective restriction, using server-side checks at proposal and execution time. Define handling for shifts spanning transition boundaries, timezone differences, pending approvals and concurrent changes; do not silently cancel, reassign or rewrite historical shifts.
- Treat extensions, early returns, cancellations and corrections as new verified and approved events with explicit effective times and revision checks. Do not infer return to work from elapsed dates or automatically restore prior permissions; revalidate identity, employment, placement, account state and current grants before restoring any capability.
- Preserve historical assignments, approvals and audit evidence under applicable retention and hold rules. Restrict historical access according to current authorization and the relevant historical period; a leave transition does not grant a manager broader retrospective access.
- Notify only authorized recipients with minimum necessary information. Ensure notifications and shared-device displays do not reveal sensitive leave details, and do not use leave status or data-quality indicators as the sole basis for adverse employment decisions.
- Test synthetic cases for forged lifecycle events, unauthorized manager changes, boundary-crossing shifts, timezone errors, conflicting extensions, early return, expired state, stale permissions, cross-employee access, sensitive-reason leakage and unauthorized automatic restoration.

**Still required before implementation:** approved lifecycle event catalogue and definitions; authorized initiator/verifier/approver matrix and separation of duties; effective-time and timezone rules; capability-by-event access matrix; employee/manager/self-service visibility rules; shift-boundary and pending-workflow handling; extension, cancellation and return-to-work procedures; notification and retention rules; and synthetic Emulator tests proving server-side enforcement and fail-closed behavior. This decision does not define statutory leave entitlements, authorize collection or disclosure of medical reasons, alter employment status automatically, or approve real-data processing or production activation.

### L-70 — Account archival, restoration and archived organizational units

**Question:** How should inactive employee accounts and archived organizational units be preserved and, where justified, restored without confusing archival with deletion or reviving obsolete access?

**Approved 2026-11-27 — option B (controlled, reversible archival with separately authorized restoration), selected under the user's standing authorization for ChatGPT to choose and record the recommended security option.**

- Treat archival as a distinct lifecycle state and operation, not as deletion, anonymization, employment termination, account suspension or a legal hold. Define the permitted reasons, initiating authority, approval requirements, effective time and affected resources before implementation.
- Before archival, calculate and review the exact impact: authentication/account state, active sessions and credentials, delegated grants, employee bindings, pending approvals, scheduled/background work, organizational memberships, shift assignments, references and required historical records. No broad cascade or destructive cleanup by implication.
- Revoke operational access and invalidate sessions, tokens, delegations and workload permissions that must no longer operate. Any narrowly retained self-service, privacy-request or statutory access must be separately authorized, time-bounded where appropriate and independently tested.
- Preserve only records required for legitimate operational, contractual, legal or audit purposes under the applicable retention schedule and holds. Minimize archived personal data, restrict access by purpose and role, record access, and prevent ordinary operational search or roster views from exposing archived records.
- Preserve referential integrity and provenance for historical shifts, approvals, audit evidence and organizational assignments. Do not rewrite historical ownership or silently move records when a site, department or organizational unit is archived.
- Archive an organizational unit only through an explicit, approved workflow that identifies its members, open assignments, pending work, delegations, references and historical dependencies. Require a separately approved reassignment or closure plan; do not infer a replacement unit or automatically grant its managers access to archived records.
- Restoration must be a new, explicitly authorized and audited workflow, not a reversal of a flag. Revalidate identity, employment relationship, canonical UID↔Employee binding, current organizational placement, role grants, unit status, credentials, security posture and outstanding holds before enabling any operation.
- Never automatically restore old roles, delegated privileges, manager scope, sessions, invitations, API credentials, scheduled jobs or prior assignments. Recreate only the minimum current grants through the normal approval process; unresolved or conflicting state remains fail closed.
- Require preview, impact summary, independent approval, revision checks and idempotent execution for archival and restoration. Provide safe cancellation before commit and a documented recovery path for partial failures; do not silently retry destructive side effects.
- Record actor, approver, reason code, target, effective time, affected resource references, revocation outcomes, retention disposition, restoration checks and final result in protected audit evidence, without copying unnecessary sensitive content into logs.
- Test synthetic cases for unauthorized archive/restore, cross-organization scope, stale approvals, partial failure, session/token survival, orphaned references, archived-unit membership, historical record leakage, legal holds, expired retention and attempts to resurrect obsolete privileges.

**Still required before implementation:** archival eligibility and reason catalogue; resource and dependency inventory; approval/separation-of-duties matrix; retention and legal-hold mapping; exact account/session/credential/job revocation semantics; organizational-unit closure and reassignment workflow; restoration identity and authorization checklist; partial-failure/recovery design; audit schema and access controls; and synthetic Emulator tests across account, employee, unit and historical-record boundaries. This decision does not authorize bulk deletion, automatic restoration, retention overrides, real-data processing, production account changes or deployment.

### L-71 — Historical employee records after termination or lifecycle change

**Question:** Who may access historical employee records after termination, transfer, suspension or other lifecycle changes, and under what limits, without preserving obsolete operational privileges?

**Approved 2026-11-27 — option B (purpose-limited historical access through separate, time-bounded authorization), selected under the user's standing authorization for ChatGPT to choose and record the recommended security option.**

- Treat historical data retention and permission to access retained data as separate decisions. Retaining a record for legal, employment, payroll, audit or operational reasons does not grant any person or role permission to read it.
- Revoke operational access, manager scope, delegations, sessions and credentials according to the applicable lifecycle event. Do not preserve prior access merely because the actor created, approved, supervised or once had access to the record.
- Permit historical access only for a documented, legitimate and authorized purpose, through a distinct read-only permission scoped to the relevant record categories, fields, employee/organizational period and duration. Require stronger review for payroll, disputes, sensitive absence material and restricted audit evidence.
- Resolve access using canonical historical assignment and organizational-period records, not current manager title, client-supplied dates, employee identifiers or cached membership. A current organizational role does not confer access to all former members or all historical periods.
- Apply L-01's narrowly bounded previous-manager access only to the approved previous-assignment interval and operational record set. Do not extend it to payroll, sensitive absence details, unrelated employee profile data or periods outside that assignment without a separate approval.
- Provide employees or former employees access to their own records only through an independently authorized self-service or verified request workflow, with identity proofing, field minimization, third-party redaction, legal-hold and retention checks. Termination alone neither creates nor removes statutory rights; applicable legal requirements must be reviewed by the responsible privacy/legal owner.
- Route requests from HR, payroll, legal, auditors, managers and support through role- and purpose-specific authorization. Administrative status, employment seniority, convenience or a generic support ticket is not sufficient authority. Any exceptional access must follow L-09 break-glass controls and be independently reviewed.
- Enforce authorization server-side on every query and returned field, including exports, search, reports, notifications, background jobs and direct document references. Deny broad historical collection, unrestricted employee timelines and cross-organization traversal by default.
- Minimize disclosure to the exact period and fields required; suppress sensitive absence reasons and health-related content unless a distinct lawful and specifically authorized process permits it. Record access purpose and outcome without copying unnecessary personal content into audit logs.
- Reassess and revoke historical-access grants when the purpose ends, the actor changes role, the relevant assignment closes, a legal hold changes, or the grant expires. Review access periodically and preserve a protected audit trail of decisions and reads.
- Test synthetic cases for former-manager overreach, current-manager access to prior periods, cross-employee and cross-organization queries, unauthorized payroll/absence reads, expired grants, forged historical dates, export bypass, self-service identity mismatch and legal-hold conflicts.

**Still required before implementation:** historical record-category and field catalogue; lawful-purpose and role-specific access matrix reviewed by privacy/legal owners; authoritative historical placement/assignment schema; self-service identity and redaction workflow; retention/hold interaction; grant duration, review and revocation rules; query/export/background-job enforcement design; audit requirements; and synthetic Emulator tests for each lifecycle and historical boundary. This decision does not determine statutory entitlements, authorize general HR/payroll access, create retention periods, permit bulk exports, or approve real-data processing or production activation.

### L-72 — Legal-hold release and post-hold disposition

**Question:** How should a legal or regulatory hold be formally released and retained records subsequently reviewed for disposition, without premature deletion, indefinite preservation by default or inconsistent copies?

**Approved 2026-11-27 — option B (verified, scoped hold release followed by a separate retention-based disposition workflow), selected under the user's standing authorization for ChatGPT to choose and record the recommended security option.**

- Treat hold creation, amendment, suspension, release and final record disposition as distinct, explicitly authorized events. A hold must identify its authority, matter/reference, covered data subjects and record categories, custodians or systems, scope, effective time, review date and responsible owner; do not accept an unstructured client flag as authority.
- Require documented confirmation from the authorized legal/privacy owner before a hold is released or narrowed. Where policy requires, use independent approval and verify that no overlapping matter, statutory preservation duty, investigation, appeal or other active hold still covers the records.
- Record the exact scope and effective time of each release or amendment, its approver, rationale and evidence reference in protected audit records. Preserve the prior hold history; never overwrite or erase the fact that a hold existed.
- Releasing a hold does not itself delete, anonymize, export or unlock records. Recalculate disposition eligibility against the applicable retention schedule, purpose, legal basis, other holds, contractual duties and pending verified requests through a separate controlled decision.
- If retention remains required, keep only the minimum necessary records with restricted access and a new review/disposition date. If disposition is permitted, use the separately approved deletion or anonymization workflow, with preview, scope validation, separation of duties, idempotency and protected evidence.
- Propagate authorized hold changes and dispositions to all governed copies and processing locations, including primary stores, replicas, search indexes, caches, generated exports, document stores, backups and authorized processors, subject to technically documented backup-expiry and restore controls. Do not claim complete erasure where immutable backups or third-party copies remain until their governed expiry or verified disposition.
- Prevent restored backups, replayed events, delayed jobs or re-imports from silently reintroducing records whose disposition status remains effective. Reconcile restored data against authoritative hold and disposition state before access is enabled.
- Keep hold metadata and audit evidence minimized and access-restricted. Ordinary managers, employees, support staff and system administrators must not infer or alter legal strategy or hold scope from broad record visibility; access to matter details is separately restricted.
- Provide a controlled exception path for conflicting instructions or uncertain authority: suspend destructive disposition for the affected scope, preserve current evidence, escalate to the designated legal/privacy owner and record the resolution. Do not treat uncertainty as permission for broad access or indefinite blanket retention.
- Test synthetic cases for overlapping holds, partial release, wrong-scope release, unauthorized approver, expired review date, pending litigation/investigation, retention still active, delayed deletion jobs, replica/index/cache propagation, processor failure, backup restoration and attempted resurrection of disposed records.

**Still required before implementation:** hold authority and owner matrix; matter/scope metadata schema; release and independent-approval workflow; overlapping-hold resolution rules; retention schedule linkage and disposition decision evidence; inventory of replicas, indexes, exports, backups and processors; deletion/anonymization propagation and restore-reconciliation design; exception/escalation process; audit access controls; and synthetic Emulator tests. This decision does not determine legal sufficiency, set retention periods, authorize immediate deletion on hold release, override statutory duties, or approve real-data processing or production activation.

### L-73 — Audit evidence access, disclosure and evidentiary export

**Question:** How should audit evidence be accessed, disclosed or packaged for investigation and external review without turning ordinary audit visibility into unrestricted access to employee data or weakening evidence integrity?

**Approved 2026-11-27 — option B (purpose-bound, read-only evidence access with controlled disclosure and verifiable chain of custody), selected under the user's standing authorization for ChatGPT to choose and record the recommended security option.**

- Separate permission to view operational audit summaries from permission to inspect underlying evidence, security telemetry, identity details, payloads or employee records. D-06 audit visibility does not grant access to raw logs or unrestricted evidence.
- Require a documented case, incident, compliance or legal purpose; authorized requester; precise time range, systems, actors and record categories; and an approved evidence scope before retrieval. Unknown or overly broad requests fail closed.
- Use role-specific authorization and separation of duties for evidence custodians, investigators, privacy/legal reviewers and approvers. A person must not approve their own expanded access or alter evidence they are responsible for collecting.
- Default to read-only, minimized evidence views. Redact unrelated employees, credentials, tokens, secrets, sensitive absence details and unrelated personal content. Reveal additional fields only when necessity and authority are documented and separately approved.
- Preserve source records and integrity metadata. Evidence collection must record source, collection time, collector identity, query/filter criteria, relevant versions, integrity digest or equivalent verification, transformations/redactions and every custody transfer. Never edit the original evidence in place.
- Treat derived extracts, screenshots, reports and evidence bundles as new controlled artifacts with their own classification, access list, purpose, retention, integrity verification and disposal rules. A successful export must not create an unrestricted reusable copy.
- Require independent approval and explicit preview for bulk, cross-employee, highly sensitive or externally disclosed evidence. Validate recipient identity, authority, secure delivery channel, expiry and acknowledgement where appropriate; do not send evidence through ordinary notifications or public links.
- Keep evidence-access logs separate from the evidence being protected, with restricted append-only or tamper-evident handling, so investigators cannot erase their own access trail. Avoid logging unnecessary sensitive payloads or secrets.
- Apply legal holds and retention rules to both source evidence and derived bundles. Disclosure does not waive a hold or authorize deletion; disposition follows the separate approved retention and hold-release workflows.
- Revoke case access and delivery links when the purpose ends, the case closes, an approver withdraws authorization or a grant expires. Review outstanding copies and recipients, and record verified return/deletion where contractually and technically possible.
- Test synthetic cases for unauthorized raw-log access, self-approval, overbroad queries, cross-tenant evidence, redaction failures, altered source evidence, digest mismatch, custody gaps, public-link exposure, expired recipient access, held evidence deletion and audit-trail tampering.

**Still required before implementation:** evidence classification and source inventory; case-purpose and requester authority matrix; custodian/investigator/reviewer separation-of-duties model; query and field allowlists; redaction rules; integrity and chain-of-custody format; derived-artifact storage, delivery and expiry design; external-recipient verification; hold/retention linkage; access review and revocation procedures; and synthetic Emulator tests. This decision does not authorize unrestricted raw-log access, bulk employee surveillance, general-purpose evidence exports, external disclosure without review, or production activation.

### L-74 — Tenant and organizational-boundary isolation

**Question:** How should tenant, organization and subordinate-unit boundaries be established and enforced across requests and stored data so that a valid identity or role in one organization cannot access another organization's records?

**Approved 2026-11-27 — option B (canonical server-derived tenant context with deny-by-default isolation at every data access layer), selected under the user's standing authorization for ChatGPT to choose and record the recommended security option.**

- Resolve the tenant and organizational context from the authenticated principal's verified, active canonical membership and authoritative backend records on every request. Never trust a client-supplied tenant, organization, site, department, employee, owner or scope identifier as proof of membership or authority.
- Bind each protected record and operation to an authoritative tenant/organization ownership model. Validate the relationship between tenant, organization, unit, employee, assignment and resource on the server; reject missing, ambiguous, conflicting, inactive or cross-boundary references.
- Enforce tenant isolation in every read, write, query, search, aggregation, export, document lookup, notification, callable, scheduled job, background worker and service-to-service operation. A UI filter or client-side path partition is not an authorization boundary.
- Derive query constraints from the verified principal and approved scope before retrieving data. Do not fetch broad collections and filter unauthorized records after retrieval. Validate returned references and fields as well as the initial request.
- Keep tenant identity and authorization context explicit in workload identities and internal service calls. Authenticate the calling service, constrain its audience and permitted tenant scope, and reauthorize the requested operation against current server-side membership and grants.
- Treat cross-tenant administration, support, migration, analytics and incident investigation as exceptional capabilities, not inherent administrator rights. Require a documented purpose, explicit tenant set, minimum fields/actions, time limit, independent approval and protected audit; no wildcard tenant access by default.
- Prevent identifiers, counters, storage paths, caches, search indexes, object URLs, exports and generated artifacts from becoming cross-tenant reference channels. Use tenant-aware keys and authorization checks at retrieval time; unguessable identifiers alone are not access control.
- Invalidate or re-evaluate cached authorization and tenant context after membership, binding, role, organization, lifecycle or session changes. Never reuse a previous user's or tenant's context on shared devices or pooled workers.
- Fail closed on tenant resolution outages, stale membership, conflicting ownership metadata, unknown schema versions and partial migrations. Do not fall back to a global/default tenant or silently widen scope.
- Record minimized tenant-scoped access and denial evidence with protected integrity controls. Avoid leaking whether another tenant's resource exists through error messages, timing-sensitive responses or diagnostics.
- Test synthetic adversarial cases for forged tenant identifiers, swapped resource IDs, nested-unit traversal, duplicate bindings, inactive memberships, query omissions, export/document URL bypass, cache poisoning, pooled-worker context leakage, service identity confusion, concurrent membership revocation and exceptional cross-tenant access.

**Still required before implementation:** canonical tenant and organization ownership schema; membership and hierarchy invariants; tenant-context resolution contract; per-endpoint and per-worker authorization inventory; query/index/storage/cache/artifact isolation design; exceptional cross-tenant approval matrix; revocation and cache-invalidation semantics; generic error and monitoring requirements; and synthetic Emulator tests demonstrating isolation across all data and processing paths. This decision does not create a tenant hierarchy, authorize cross-tenant administration, establish legal entity boundaries, approve real-data processing or permit production activation.

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
| L-13 Security notifications | Approved — option B minimized notices for defined material events; implementation gated on event catalogue, channel, exception and delivery controls |\n| L-14 Evidence preservation and scoped holds | Approved — option B scoped preservation with restricted access, defined duration and review; implementation gated on authority, scope, lifecycle and tests |\n| L-15 Administrator access to employee data | Approved — option B least-privilege, duty-specific permissions with independent controls; implementation gated on role/action/scope mapping and tests |\n| L-16 Periodic and event-driven access reviews | Approved — option B scheduled and lifecycle-triggered reviews with prompt revocation; implementation gated on cadence, ownership, event and revocation controls and tests |\n| L-17 Security log integrity and protection | Approved — option B append-only protected logs with restricted access and integrity verification; implementation gated on storage, key, retention, access and test design |\n| L-18 Technical support access | Approved — option B minimized diagnostics by default; exceptional real-data access strictly necessary, authorized, time-limited and audited; implementation gated on roles, scope, workflow and tests |\n| L-19 Analytics, automation and AI tools | Approved — option B synthetic/anonymized by default; real data only with authorized purpose, minimization, provider/security review and audit; implementation gated |\n| L-20 Security incident response | Approved — option B documented response lifecycle; implementation gated on owners, severity, authority, evidence, notifications, recovery and exercises |\n| L-21 Business continuity and recovery | Approved — option B protected scheduled backups, separate copies, restore tests, RPO/RTO and integrity checks; implementation gated |\n| L-22 Environment separation and promotion | Approved — option B separate environments, credentials and data, least privilege and controlled promotion; implementation gated |\n| L-23 Software dependencies and supply-chain security | Approved — option B inventoried/versioned dependencies, controlled updates, vulnerability/provenance checks, lockfiles and review; implementation gated on inventory, tooling, thresholds, exceptions and CI controls |
| L-24 Credential and secret management | Approved — option B dedicated secret manager, least privilege, rotation, expiry, audit and no secrets in code/logs; implementation gated on vault, key management, identity, lifecycle and test controls |
| L-25 Strong authentication for privileged users | Approved — option B mandatory MFA, phishing-resistant methods preferred, bounded sessions and step-up verification; implementation gated on identity provider, recovery, session and test controls |
| L-26 Account recovery and credential reset | Approved — option B risk-based identity-verified recovery, single-use short-lived mechanisms, notification, session revocation and privileged-account safeguards; implementation gated on identity proofing, workflow, revocation and tests |
| L-27 Protection against abusive authentication attempts | Approved — option B layered rate limits, brute-force/credential-stuffing defenses, anomaly detection, proportionate temporary restrictions, secure recovery and audit; implementation gated on thresholds, signals, recovery, monitoring and tests |
| L-28 Session and device lifecycle security | Approved — option B managed sessions, bounded lifetime, step-up authentication, server-side revocation, lifecycle invalidation and protected audit; implementation gated on architecture, token handling, lifetimes and tests |
| L-29 Security monitoring and event response | Approved — option B risk-based centralized monitoring, protected audit, actionable alerts, defined escalation and human-reviewed response; implementation gated on event taxonomy, ownership, retention, architecture and tests |
| L-30 Data classification and handling | Approved — option B risk-based classification, minimization, purpose limitation, least-privilege field access, environment separation and retention/disposal controls; implementation gated on inventory, schedules, handling matrix and tests |
| L-31 Vulnerability management and security updates | Approved — option B documented intake, risk-based triage, tracked remediation, verified fixes and controlled updates; implementation gated on ownership, SLAs, inventory, tooling and tests |
| L-32 Privacy requests and personal-data rights | Approved — option B verified, scoped and tracked workflow with authority checks, retention/legal-hold review, controlled actions and recorded outcomes; implementation gated on privacy ownership, data mapping, procedures and tests |
| L-33 Business continuity and incident recovery | Approved — option B planned continuity, domain-specific RTO/RPO, protected backups, tested restores and integrity/authorization validation; implementation gated on impact analysis, architecture, owners and exercises |
| L-34 Third-party integrations | Approved — option B risk-reviewed integration governance, minimal data/scope, credential isolation, monitoring, periodic review and offboarding; implementation gated on provider inventory, risk/privacy review, contracts, ownership and tests |
| L-35 Human error and irreversible operations | Approved — option B guarded operations with explicit confirmation, preview, stale-state validation, reversibility, separation of duties and protected audit; implementation gated on action classification, approval matrix, safeguards and tests |
| L-36 Security-by-design and threat modeling | Approved — option B risk-based threat modeling, security acceptance criteria, review gates, evidence-linked testing and time-bounded risk exceptions; implementation gated on ownership, review triggers, process and tests |
| L-37 Data integrity and unauthorized modification prevention | Approved — option B strict server-side integrity controls; implementation gated on schemas, ownership binding, revision/idempotency, audit, monitoring and tests |\n| L-38 Verification evidence and test governance | Approved — option B reproducible, traceable security evidence gates; implementation gated on evidence format, mapping, CI, severity/exception criteria and tests |\n| L-39 CI dependency and vulnerability gates | Approved — option B risk-based enforced inventory, vulnerability/provenance checks and blocking thresholds; implementation gated on tooling, thresholds, CI permissions, exceptions and tests |\n| L-40 Transport security and data-in-transit protection | Approved — option B enforced TLS, credential protection, origin/destination controls and leakage-resistant errors/logs; implementation gated on architecture, baselines, policies and tests |\n| L-41 Web application and API abuse protection | Approved — option B defense-in-depth validation, authorization, browser protections, outbound controls and abuse limits; implementation gated on route inventory, policies, monitoring and tests |\n| L-42 Stored data and local cache protection | Approved — option B layered encryption, minimization, key governance and strict local/offline persistence limits; implementation gated on classification, retention, storage, lifecycle cleanup and tests |\n| L-43 Administrative operations and insider-abuse controls | Approved — option B least privilege, separation of duties, independent approvals, time-limited elevation and protected audit; implementation gated on role matrix, approver rules, monitoring and tests |\n| L-44 Data loss prevention and controlled data egress | Approved — option B risk-based classification, egress permissions, minimized exports, protected audit and anomaly review; implementation gated on domain rules, workflows and tests |\n| L-45 Secure notifications and messaging channels | Approved — option B minimal authenticated notifications, protected links, scoped recipient checks and provider governance; implementation gated on channel rules, workflows and tests |\n| L-46 Backend resource protection and automated abuse controls | Approved — option B layered quotas, bounded workloads, fair-use isolation, abuse detection and safe degradation; implementation gated on resource budgets, monitoring and tests |\n| L-47 Secure error handling and diagnostic information protection | Approved — option B generic client errors, minimized protected diagnostics, redaction and audited access; implementation gated on schemas, retention, access controls and leakage tests |\n| L-48 Configuration integrity and environment security | Approved — option B governed configuration changes, environment separation, validation, drift detection and audited rollback; implementation gated on inventory, workflows, validation and tests |
| L-49 Secure data import and ingestion | Approved — option B defense-in-depth validation, staged review, scoped authorization, provenance, safe parsing and protected audit; implementation gated on formats, schemas, workflows, limits and tests |
| L-50 Secure export and document generation | Approved — option B end-to-end scoped authorization, minimized fields, safe rendering, protected delivery, artifact lifecycle and audit; implementation gated on catalogue, thresholds, workflows and tests |
| L-51 Secure search and query authorization | Approved — option B server-enforced identity, scope and field constraints, minimized results, bounded queries and protected audit; implementation gated on field catalogue, query design, thresholds and tests |
| L-52 Concurrent data integrity and conflict control | Approved — option B server-enforced revisions, atomicity, idempotency, explicit conflict handling and protected audit; implementation gated on revision model, transaction boundaries, workflows and tests |
| L-53 Secure background jobs and scheduled processing | Approved — option B scoped workload identities, execution-time authorization, bounded/idempotent processing, cancellation and protected audit; implementation gated on workload matrix, queue design, workflows and tests |
| L-54 Secure onboarding, invitations and account activation | Approved — option B verified identity, expiring scoped invitations, canonical binding, independent approval and protected audit; implementation gated on identity proofing, workflows, binding contract and tests |
| L-55 Secure account deactivation and credential revocation | Approved — option B coordinated server-side revocation, lifecycle-aware authorization, dependent-job cancellation and protected audit; implementation gated on event catalogue, propagation, integrations and tests |
| L-56 Secure shared-device and workstation sessions | Approved — option B centrally enforced session expiry, reauthentication, server-side revocation and local-data minimization; implementation gated on device profiles, session configuration and cross-user isolation tests |
| L-57 Cryptographic and signing key rotation and compromise response | Approved — option B governed key inventory, protected storage, scheduled/event-driven rotation, controlled verifier transition and rehearsed compromise response; implementation gated on key inventory, ownership, provider and integration tests |
| L-58 Data retention, archival and verifiable deletion | Approved — option B governed schedules, restricted archives, authorized disposition and minimized evidence; implementation gated on domain schedules, legal/privacy review, propagation and tests |
| L-59 Security log monitoring, retention and tamper detection | Approved — option B minimized, centrally protected and tamper-evident logs with monitored response; implementation gated on event taxonomy, integrity design, retention, access and tests |
| L-60 Secure service-to-service communication and machine identity | Approved — option B distinct workload identities, short-lived audience-bound credentials and authenticated transport; implementation gated on identity model, service authorization, rotation, isolation and tests |
| L-61 Privacy protection for test data, fixtures and development environments | Approved — option B synthetic-first data with tightly governed exceptions; implementation gated on fixture standards, environment isolation, exception review, scanning and tests |
| L-62 Secure software release, build and distribution pipeline | Approved — option B isolated, reproducible and attestable pipeline with signed immutable artifacts and controlled promotion; implementation gated on source protection, runner isolation, provenance, signing and release workflow tests |
| L-63 Controlled deployment and infrastructure change management | Approved — option B explicit environment approvals, verified immutable artifacts, staged rollout, monitored stop/rollback and audited infrastructure changes; implementation gated on environment boundaries, approval matrix, runner controls and recovery tests |
| L-64 Security assurance, independent review and risk acceptance | Approved — option B risk-based independent assurance, traceable evidence and time-bounded exceptions; implementation gated on review ownership, evidence standards, blocking criteria and expiry enforcement |
| L-65 Security incident disclosure and coordinated vulnerability reporting | Approved — option B protected reporting, risk-based triage, coordinated remediation and legally reviewed timely communications; implementation gated on ownership, severity targets, notification workflow and exercises |
| L-66 Privacy governance, data protection impact and change review | Approved — option B continuous risk-based privacy governance and pre-change assessment; implementation gated on processing inventory, lawful-basis review, DPIA screening, rights workflows and processor/transfer controls |
| L-67 Accessibility, inclusive design and assistive-technology security | Approved — option B accessible workflows with equivalent server-enforced security; implementation gated on conformance target, supported technology matrix, authentication accommodations and manual assistive-technology tests |
| L-68 Data quality, accuracy, correction and provenance governance | Approved — option B governed field-level sources, validation, provenance, reconciliation and human-reviewed correction; implementation gated on catalogue, workflows, integrity, retention and tests |
| L-69 Employee leave lifecycle and temporary work-status transitions | Approved — option B explicit, time-bounded transitions with minimized data and scoped access; implementation gated on event catalogue, authority, effective-time rules, access matrix and tests |
| L-70 Account archival, restoration and archived organizational units | Approved — option B controlled reversible archival and separately authorized restoration; implementation gated on impact inventory, revocation, retention, approval and recovery tests |
| L-71 Historical employee records after termination or lifecycle change | Approved — option B purpose-limited, read-only, time-bounded historical access; implementation gated on lawful-purpose review, historical scope model, revocation, query enforcement and tests |
| L-72 Legal-hold release and post-hold disposition | Approved — option B verified hold release followed by separate retention-based disposition; implementation gated on legal authority, overlapping-hold checks, copy propagation and tests |
| L-73 Audit evidence access, disclosure and evidentiary export | Approved — option B purpose-bound read-only evidence access and controlled disclosure; implementation gated on evidence scope, redaction, custody, recipient and test controls |
| L-74 Tenant and organizational-boundary isolation | Approved — option B canonical server-derived tenant context and deny-by-default isolation; implementation gated on ownership schema, complete path inventory, revocation and cross-tenant tests |
| Other lifecycle and historical access | Open — fail closed |

## 6. Explicit non-authorization

This record does not grant permissions, approve a role matrix, settle legal/privacy questions, create or migrate records, add Firestore paths, modify Security Rules, implement APIs, connect the operational app, access real collaborator data, configure a real Firebase project, merge, or deploy.

The repository's existing proposal matrix remains proposal-only. This record is a review aid and must not be interpreted as a security certification or as approval by silence.
