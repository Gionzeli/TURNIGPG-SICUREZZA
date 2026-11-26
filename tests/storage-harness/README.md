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

The current model does not implement placement intervals, historical shift context, membership revocation, lifecycle, payroll DTOs, absence aggregation, pagination, query plans, crash recovery, or datastore restart/reload. Those require separately approved model extensions and, ultimately, tests against an explicitly approved isolated datastore environment.

No real identifiers or personal data are used. All identifiers are fixed synthetic labels.
