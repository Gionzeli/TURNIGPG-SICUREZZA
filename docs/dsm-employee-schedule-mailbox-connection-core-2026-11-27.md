# Mailbox connection lifecycle core — 2026-11-27

## Implemented in the isolated branch

The provider-neutral connection lifecycle core is in
`functions/src/membership/employee-schedule-mailbox-connection-service.js`.

It supports the two approved connection modes:

- **Personal mailbox:** authorization is resolved by an injected trusted-server
  callback. The resulting verified UID and canonical Employee ID are bound to
  the connection; the client cannot select another Employee.
- **Shared mailbox:** a separate injected authorization callback is required.
  It is intentionally distinct from schedule approval and does not grant the
  application administrator authority to approve an employee's shifts.

Supported provider identifiers are IMAP, Gmail API, Microsoft Graph and a
provider-specific API adapter. This is a provider-neutral boundary, not a
claim that all providers permit IMAP or expose the same OAuth scopes.

Credentials are passed only to the injected secret-vault adapter. The durable
connection record stores only an opaque secret reference, never access tokens,
refresh tokens, passwords or app passwords. The callable-facing result omits
the secret reference. If durable connection persistence fails after secret
creation, the service attempts to remove the orphaned secret.

Revocation first disables the durable connection (so polling must stop) and
then deletes the secret. The disable operation uses an expected version and
writes an audit event through the injected persistence adapter. If secret
deletion fails after disable, the connection remains revoked and secret
cleanup must be retried operationally.

## Security boundary and remaining work

This module is a tested core with injected dependencies. It is **not wired to
Firebase callable endpoints, Firestore, Google Secret Manager, KMS, OAuth,
IMAP, Gmail API, Microsoft Graph, a polling worker, or a user interface**.
No real credentials or inboxes were accessed. No production activation is
enabled.

Before wiring, the adapters must implement:

1. Revocation-checked Firebase identity verification.
2. Canonical Employee UID↔Employee binding for personal mode.
3. A separately approved canonical membership capability and scope for
   managing shared mailbox connections; do not infer it from a generic admin
   role or from shift-approval authority.
4. Secret Manager/KMS storage, rotation, deletion and least-privilege access.
5. Transactional Firestore persistence, version checks, audit records and
   provider subscription/polling shutdown.
6. Provider-specific OAuth consent, least-privilege scopes, callback state and
   PKCE where supported, webhook validation, token refresh and revocation.

All tests use synthetic identities and fixture secrets. The live schedule is
never mutated by mailbox connection or ingestion setup; only the employee's
separate approval workflow can apply a proposed schedule change.
