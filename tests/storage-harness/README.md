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
