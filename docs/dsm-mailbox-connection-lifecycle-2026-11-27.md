# Mailbox connection lifecycle — server-side boundary

This module adds a provider-neutral lifecycle boundary for personal and shared schedule mailboxes. It is deliberately not wired to a callable, scheduled worker, real provider, Firebase project, or production secret store.

## Authorization and ownership

- A personal connection requires an active canonical member principal with an Employee binding. The provider-verified mailbox address must match that member's verified canonical email. The connection records both the owner UID and Employee ID; only that owner can revoke it.
- A shared connection requires the explicit server-resolved `manageSharedMailboxConnections` permission. Being an application administrator or being able to approve shifts does not itself grant this permission. Shared connections have no personal Employee owner.
- Both modes require an explicit sender allowlist. Sender authentication and mailbox ownership verification remain distinct checks performed by the provider adapter and ingestion pipeline.

## Credential handling

- Provider adapters (IMAP/OAuth/API) are injected server-side. The authorization payload and resulting credential material must never be accepted by a browser-facing callable or written to Firestore.
- The credential material is passed directly to an injected secret-vault adapter. Persistent connection metadata contains only an opaque `credentialSecretRef`; the returned DTO never contains it.
- If connection persistence fails after vault storage, the service attempts to revoke the newly stored secret.
- Revocation first changes status to `revocation_pending`, which is not eligible for ingestion. The vault credential is revoked before the connection becomes `revoked`. A vault outage leaves the connection fail-closed in `revocation_pending` for retry/reconciliation.
- The production adapter must use Secret Manager/KMS or an equivalent vault, with least-privilege access, rotation, audit, and deletion/revocation. No secret reference should be readable by browser clients.

## Not yet implemented

No Gmail, Microsoft Graph, generic OAuth, IMAP/IDLE, polling, or custom-provider adapter is connected. No OAuth consent screen/callback/PKCE state, IMAP credential verification, Firestore persistence adapter, Secret Manager adapter, background worker, email subscription/webhook, parser/OCR, UI, or production activation is included. Provider support must be validated per provider; IMAP may be disabled or require app passwords/OAuth. This service is exercised only with synthetic unit fixtures.

## Firestore adapter boundary

A server-only Admin-SDK adapter now persists connection metadata at
`accounts/{accountId}/mailboxConnections/{connectionId}` and immutable audit
events below `mailboxConnectionAudit`. It validates metadata, prevents changes
to the owner/provider/mailbox/sender allowlist after creation, and permits only
the monotonic lifecycle `active → revocation_pending → revoked`. The vault
reference is cleared only in the final revoked state. The existing catch-all
Firestore Rules deny client reads and writes to this canonical subtree.

The adapter is unit-tested with an in-memory Firestore-shaped fixture. It is
not instantiated by `functions/src/index.js`, and no callable or real
Firestore operation invokes it yet. It does not make provider authorization or
secret storage available; those adapters remain absent.
