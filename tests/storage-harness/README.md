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

The extended pure domain model includes tests for half-open placement intervals, atomic transfer validation, historical shift context, placement-scoped authorization at the operation date, binding revocation, active Employee/organization checks, payroll deny-by-default, and manager absence DTO minimization. These are deterministic in-memory policy examples only; they do not simulate datastore transactions, query execution, persistence, pagination, crash recovery, or restart/reload. They now include illustrative manager delegation checks for operation-specific permissions and placement scope, separate payroll write/export permissions with synthetic audit entries, and a category-blind absence report projection. These remain simplified pure functions, not application authorization, datastore transactions, or proof against all indirect inference channels.

No real identifiers or personal data are used. All identifiers are fixed synthetic labels.


Additional tests: `node --test tests/storage-harness/*.test.mjs` also exercises `domain-model.test.mjs`. The domain policy functions are deliberately separate from both datastore-shaped models so no test result can be mistaken for proof of Firestore/PostgreSQL behavior.


## Continuous integration

The dedicated GitHub Actions workflow runs this command on Node 20 when these harness files change in the feature branch or in a pull request targeting `main`:

```sh
node --test tests/storage-harness/*.test.mjs
```

It installs no project dependencies and does not start Firebase emulators or contact a datastore. A green workflow validates only these in-memory reference-model tests; it is not evidence for Firestore/PostgreSQL guarantees or application authorization.
