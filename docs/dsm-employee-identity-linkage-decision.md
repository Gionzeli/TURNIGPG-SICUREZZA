# DSM employee identity linkage — decision brief

**Status:** architecture decision required; proposal only, not approved or implemented.
**Scope:** associate a verified Firebase identity with a DSM employee/profile record without trusting browser-owned identifiers.
**Evidence branch:** `dsm-enterprise/core-v1`, reviewed at commit `6620b01e2749a66b0cc349c5d1d4a7444254e5fe`.
**Safety boundary:** documentation and synthetic examples only. No Firebase Rules, operational configuration, client composition root, production data, migration, credentials or deployment changes.

## 1. Verified repository facts

1. The local IndexedDB schema has account-indexed stores `profiles`, `shifts`, and `absences`. Each record has top-level `id` and `accountId`; the compound `accountId_id` index is unique.
2. `BaseRepository.create()` generates a record ID and stores the supplied domain payload under `data`. The client repository enforces account filtering for local reads, but this is not a server authorization boundary.
3. `ProfileService` currently accepts only two profile sections:
   - `params`: compensation/payroll parameters;
   - `profile`: `ccnl`, `section`, `level`, `role`, `effective_date`.
   It does not define a Firebase UID, employee identifier, site ID, department ID or authoritative owner field.
4. The backend membership policy validates `uid`, `accountId`, `status`, `role`, `scopeType`, and `scopeIds`. A member receives only `dsm:read:own-scope`; the current membership shape does not identify a profile record.
5. The resource authorization policy can compare a principal's scope against canonical account/site/department context. Its resolver depends on injected loaders. No canonical Firestore loaders or protected DSM data endpoints are implemented.
6. The current health callable explicitly reports `protectedDataApisImplemented: false` and `authorizationImplemented: false`.

**Important security distinction — “own-scope” is not individual ownership:** the current `authorizeResource()` implementation authorizes a member when the resolved resource's `siteId` or `departmentId` is included in membership `scopeIds`. It does not compare the resource to a profile owned by the verified UID. Therefore `dsm:read:own-scope` currently means organizational-scope access in this pure policy, not proof that a member may read only their own employee profile. Until an authoritative UID↔employee binding and per-record relationship exist, do not describe this permission as individual “own profile” isolation or expose employee-specific data APIs on that assumption.

**Conclusion:** the current code does not establish a trustworthy relation between a Firebase UID and a DSM profile. A matching name, email, display label, local account ID, or browser-supplied profile ID is not proof of ownership.

## 2. Security properties required

Any future linkage must satisfy all of the following:

- The Firebase UID comes only from a revocation-checked, server-verified ID token.
- The account is resolved using the approved account-selection policy and canonical active membership; an account selector is never proof of access.
- The profile/employee link is read from a backend-owned canonical store, never from request claims or client-writable profile fields.
- The linked profile belongs to the same account and is active under the approved lifecycle policy.
- A member can resolve only the single linked employee identity (or a separately approved explicit set); the member cannot supply an arbitrary profile ID.
- Managers/admins receive only the access their approved role/scope permits. Manager access must be checked against the current site/department relationship on every operation.
- Missing, duplicate, malformed, cross-account, inactive, stale or conflicting links fail closed.
- All profile, shift and absence APIs re-authenticate and re-authorize on every request. The browser principal and IndexedDB account partition are not authorization.
- Link creation, reassignment, revocation and account transfer are privileged operations with concurrency protection and server-side audit.
- Sensitive payroll/profile data is not copied into membership documents, ID tokens, custom claims, logs or authorization responses.

## 3. Candidate models — not selected

### Option A — backend-owned UID-to-profile binding

Logical proposal:

`accounts/{accountId}/employeeBindings/{uid}`

Candidate fields: `uid`, `accountId`, `profileId`, `status`, `createdAt`, `updatedAt`, `revision`.

Advantages:
- The lookup key comes from verified UID; the client need not nominate a profile ID.
- Identity linkage is separated from payroll/profile content and role membership.
- Reassignment can be audited without changing the profile's business data.

Risks / decisions:
- A UID can have at most one active employee binding per account unless product requirements explicitly allow multiple employment records.
- Binding uniqueness and lifecycle semantics need transactional enforcement.
- The profile record path and canonical profile store are not yet approved; current profiles are in local IndexedDB.
- Rules for initial linking, proof of identity, manager-assisted linking, unlinking, termination and account transfer must be defined.

### Option B — employee identifier in membership

Add a backend-managed `employeeId` or `profileId` to `accounts/{accountId}/members/{uid}`.

Advantages:
- Fewer lookups and one membership read can resolve both role and employee scope.

Risks:
- Mixes identity-to-person linkage with authorization membership.
- Profile identifiers become part of a security-sensitive membership document and require careful update/audit controls.
- Still needs uniqueness, reassignment and lifecycle rules.
- Must not become a field writable by a user or accepted from a client payload.

### Option C — shared employee identity independent of Firebase UID

Introduce a canonical employee entity and separate identity-link records, potentially supporting multiple identity providers or historical employment relationships.

Advantages:
- Separates a person's employment identity from their login identity.
- Better supports provider changes and multiple accounts/engagements.

Risks:
- More schema and lifecycle complexity.
- Requires a canonical employee identifier and governance process not present in the repository.

No option is selected by this document. Do not implement any of these paths until the schema owner and product owner approve the model.

## 4. Decisions required before implementation

| ID | Decision | Question to resolve |
|---|---|---|
| LINK-01 | Identity cardinality | Can one Firebase UID map to more than one employee/profile in one account? |
| LINK-02 | Employee cardinality | Can one employee have multiple Firebase identities, e.g. account recovery or provider migration? |
| LINK-03 | Canonical record | Is the profile document itself canonical on the backend, or is a separate employee entity required? |
| LINK-04 | Provisioning | Who can create the first binding, and what out-of-band verification proves the person/profile match? |
| LINK-05 | Reassignment | What approvals, reason codes, audit and cooling-off controls apply when a binding changes? |
| LINK-06 | Lifecycle | What happens on suspension, termination, leave, account archive and identity deletion? |
| LINK-07 | Scope | Is member access to one profile only, or also related shifts/absences; how are records linked to that profile? |
| LINK-08 | Manager semantics | Which operations can managers perform for staff at assigned sites/departments? |
| LINK-09 | Privacy | Which roles may read compensation fields, and should profile data be split into separate permission domains? |
| LINK-10 | Multi-account | How does a user choose among multiple active memberships without trusting a client-supplied account as authority? |

## 5. Required negative and positive test matrix

All fixtures must be synthetic and run against Firebase Auth/Firestore emulators or injected fake loaders.

1. Verified member resolves exactly their active binding and cannot choose another profile ID.
2. Member cannot enumerate bindings or profiles.
3. Missing binding, inactive binding, malformed binding and duplicate/conflicting binding all deny.
4. Binding UID mismatch and cross-account profile mismatch deny.
5. A profile archived or deleted after binding creation denies subsequent reads.
6. Revoked/disabled Firebase identity denies even if a binding remains active.
7. Reassignment invalidates the old association; stale revision and concurrent reassignment cannot both succeed.
8. Manager access follows the current canonical site/department relationship, including a department transfer.
9. Manager cannot access another account, unassigned site, or unrelated department.
10. Admin operations require the approved account-scoped permission; admin status supplied by the browser has no effect.
11. Profile, shift and absence endpoints independently re-check authorization; access to a profile does not silently grant unrelated records.
12. Payroll fields are not returned to roles lacking the explicit payroll permission.
13. Audit events record actor, target, action, reason, revision and server timestamp without copying payroll data or tokens.
14. Failure of identity, membership, binding, resource loader or audit transaction fails closed.
15. A member scoped to a site/department cannot read another employee's profile in that same organizational scope unless a separately approved permission and ownership relationship explicitly authorize it.

**Test-status clarification:** item 15 is a required future test case, not an implemented automated test in this repository. The current `resource-authorization.test.js` tests organizational scope boundaries, but its positive member case still authorizes a resource in the member's department without resolving an employee binding. Do not treat the matrix item as evidence that individual ownership isolation has been tested.

## 6. Implementation sequence after approval

1. Record decisions LINK-01 through LINK-10 and reconcile them with ORG-01 through ORG-10 in `dsm-organizational-schema-decision-register.md`.
2. Approve canonical backend profile/employee paths and the source of profile IDs.
3. Implement read-only canonical loaders in an isolated Functions module, initially against Firestore Emulator only.
4. Implement binding validation and pure authorization policy with comprehensive unit tests.
5. Implement privileged binding lifecycle operations with transactional audit and concurrency checks.
6. Add one protected read endpoint at a time; each endpoint verifies token revocation, membership, binding, resource state, role/scope and DTO allowlist.
7. Add emulator integration tests for all cases above and verify CI on the exact commit.
8. Only after separate review/approval may production Rules, client wiring, migration or deployment be considered.

## 7. Explicit non-authorization

This brief does not approve a Firestore path or schema, does not implement binding or endpoints, does not authorize changes to root `firestore.rules`, Firebase operational configuration, the production UI/composition root, or production data. It does not establish that local IndexedDB is private or tamper-resistant. The PR must remain open and Draft pending review.


## 8. Decisione registrata — modello A approvato

**Decisione:** approvato il modello A, binding separato e backend-owned tra UID Firebase verificato e profilo dipendente.

**Contratto logico adottato per il nucleo isolato:** `accounts/{accountId}/employeeBindings/{uid}`, con campi `uid`, `accountId`, `profileId`, `status`, `revision` e metadati temporali gestiti dal backend. Il modulo di policy non effettua direttamente I/O Firestore: riceve esclusivamente loader server-side iniettati. Nessun `profileId` fornito dal client viene accettato come selettore dell'identità personale.

**Semantica fail-closed implementata:** il binding deve corrispondere all'UID verificato e all'account della membership, avere stato `active`, `profileId` valido e revisione intera positiva; il loader del profilo deve confermare lo stesso account e profilo e lo stato attivo. Per questa prima policy il ruolo ammesso è `member` con `dsm:read:own-scope`. Manager e admin non ottengono accesso tramite questa funzione: i loro flussi organizzativi restano distinti.

**Limiti espliciti della decisione:** l'approvazione del modello A non approva ancora una fonte Firestore canonica per i profili, un flusso di provisioning/revoca/riassegnazione, cardinalità multiple UID↔dipendente, né API dati protette. I profili esistenti sono ancora locali in IndexedDB; pertanto non sono stati creati loader Firestore concreti, Rules, callable endpoint, migrazioni o collegamenti client. La funzione è un nucleo di policy testabile, non un'autorizzazione attualmente attiva in produzione.

**Test aggiunti:** binding valido; UID/account discordanti; binding assente/revocato/malformato/revisione invalida; profilo assente/inattivo/cross-account; ruolo/permesso non ammesso; errore loader; assenza di lookup del profilo dopo binding non valido; impossibilità di selezionare un profilo tramite input del chiamante.

Questa decisione sostituisce lo stato “candidate models — not selected” della sezione 3 e l'indicazione “do not implement until approved” della sezione 7 limitatamente al modulo puro e ai test descritti. Tutti i limiti e le non-autorizzazioni qui sopra restano validi.
