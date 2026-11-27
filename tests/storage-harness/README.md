# Employee storage harness (synthetic model only)

Run from the repository root:

```sh
node --test tests/storage-harness/*.test.mjs
```

## Scope

This harness contains two deliberately small in-memory reference models:
- `FirestoreModel`: optimistic snapshot/revision transaction shape with commit conflict retry.
- `PostgresModel`: serialized transaction shape with uniqueness validation.

It exercises a narrow common invariant set: active UID↔Employee one-to-one binding within an account, exact idempotent retry, conflicting retry rejection, account namespace separation, and atomic rollback when the audit append fails.

## Critical limitation

These are **not Firestore or PostgreSQL adapters**. No Firebase SDK, SQL engine, emulator, cloud project, network, credentials, schema, collection, table, index, RLS, Security Rules, or production code is used. Both models implement simplified in-memory semantics. A passing result demonstrates only that the reference-model tests behave as expected; it does not establish the actual transaction, uniqueness, isolation, durability, query, contention, cost, or security properties of either database.

The extended pure domain model includes tests for half-open placement intervals, atomic transfer validation, historical shift context, placement-scoped authorization at the operation date, binding revocation, active Employee/organization checks, payroll deny-by-default, and manager absence DTO minimization. These are deterministic in-memory policy examples only; they do not simulate datastore transactions, query execution, persistence, pagination, crash recovery, or restart/reload. They now include illustrative manager delegation checks for operation-specific permissions and placement scope, separate payroll write/export permissions with synthetic audit entries, and a category-blind absence report projection. These remain simplified pure functions, not application authorization, datastore transactions, or proof against all indirect inference channels. Payroll write/export examples additionally require an explicit authorized Employee-ID scope alongside the exact operation permission, and the in-memory write stages its audit and data arrays before publishing them. Cross-account/cross-Employee negative cases are included; this still does not establish trusted scope derivation, trusted actor identity, or durable atomic audit in a real datastore.

No real identifiers or personal data are used. All identifiers are fixed synthetic labels.


Additional tests: `node --test tests/storage-harness/*.test.mjs` also exercises `domain-model.test.mjs`. The domain policy functions are deliberately separate from both datastore-shaped models so no test result can be mistaken for proof of Firestore/PostgreSQL behavior.


## Continuous integration

The dedicated GitHub Actions workflow runs this command on Node 20 when these harness files change in the feature branch or in a pull request targeting `main`:

```sh
node --test tests/storage-harness/*.test.mjs
```

It installs no project dependencies and does not start Firebase emulators or contact a datastore. A green workflow validates only these in-memory reference-model tests; it is not evidence for Firestore/PostgreSQL guarantees or application authorization.

Payroll examples now also require a synthetic Employee record to be explicitly active for read/write/export. Suspension, termination, archival, and unknown status are denied in the model; removing an operation permission simulates revocation. This is not server-enforced lifecycle or revocation.

### Payroll audit preparation

The synthetic payroll read and export examples now stage an audit entry (actor, exact permission, account, Employee, record count) before returning data. If the audit append cannot be staged, the operation throws and no payroll result is returned. The actor value remains a synthetic test input, not a trusted identity. This tests model fail-closed behavior only; it is not durable or server-side audit.


### Manager delegation expiry and revocation

The in-memory model now requires a valid explicit expiry timestamp for manager shift delegation and checks expiry against an explicit operation timestamp. Revocation is modeled as an audited change: audit staging must succeed before status is changed. Tests cover just-before expiry, at expiry, after expiry, immediate revocation, and audit staging failure. This is not wired into callable endpoints or a persistent authorization system.


### Manager organization-scope lifecycle

Manager shift authorization in the synthetic model now requires exactly one matching active organization scope for the account, site, and department. Missing, suspended, archived, unknown, or duplicate matching scope records deny access. This is a fail-closed reference-model check only; it does not establish canonical organization lifecycle enforcement in application services or Firebase Rules.


### Account/site/department lifecycle guard (synthetic)
The in-memory domain model now requires exactly one active account record and exactly one matching organizational record whose organization, site, and department statuses are all explicitly `active`. Missing, duplicate, suspended, archived, and unknown lifecycle values deny placement creation and protected employee/manager shift operations. These checks are illustrative test logic only; they do not add runtime enforcement or validate a real identity, database, Firestore Rules, or server API.


### Payroll account lifecycle and binding revocation audit
Payroll read/write/export examples now require exactly one account record with explicit `active` status in addition to the active Employee and operation-specific permission. Missing, duplicate, suspended, archived, or unknown account state denies all three operations without changing payroll or audit arrays. Binding revocation prepares its audit entry before changing binding status; a simulated audit-staging failure leaves the binding active. These are in-memory reference-model checks only, not trusted server authorization, durable audit, datastore atomicity, or production enforcement.


### Manager delegation revocation and transfer boundary (synthetic)
Additional domain tests exercise immediate manager-delegation revocation, fail-closed behavior when the revocation audit cannot be staged, and the transfer boundary: an old-site delegation can resolve only shifts whose date belongs to the old placement, not shifts on or after the new placement's effective date. A suspended Employee also denies the manager operation in this model. These tests do not implement automatic delegation lifecycle management or prove runtime authorization.


### Ambiguous manager delegations (synthetic)
Manager authorization in the reference model now denies when more than one active, unexpired delegation matches the same account, manager, Employee, site, department, and operation. It does not select an arbitrary matching grant. A focused test covers this duplicate-grant case. This is a harness policy example, not a runtime authorization change.


The duplicate-grant ambiguity case also distinguishes genuinely competing grants from irrelevant records: an expired matching grant and a current grant for a different operation do not invalidate one unique current grant for the requested operation. This is a regression check for the synthetic model only.


### Ambiguous Employee bindings (synthetic)
The Employee operation reference model now requires exactly one active binding for the account/UID/Employee tuple. Duplicate active matches deny access rather than selecting the first record; revoked historical duplicates do not count as active grants. This is an in-memory regression check only and does not implement or prove canonical binding uniqueness in a server or datastore.


### Bidirectional active Employee binding uniqueness (synthetic)
The reference model now requires exactly one active binding per UID and exactly one active UID per Employee, scoped to the same account. A UID linked to two Employees or an Employee linked to two UIDs is denied; an identical UID or Employee value in a different account does not create a cross-account collision. This is an in-memory policy regression test only, not persistent uniqueness or server-side enforcement.


### Duplicate canonical Employee records (synthetic)
The reference model denies operations when more than one active Employee record matches the same account and Employee identifier. The guard is applied to placement creation, employee-bound operations, manager shift access and payroll access. This detects ambiguous fixtures in memory only; it does not establish persistent uniqueness or concurrency safety.
