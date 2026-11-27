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

## Personal actor authorization adapter

A separate server-side resolver now reloads the active Firebase Auth user,
canonical account and membership, and both reciprocal UID↔Employee binding
documents in one Firestore transaction. It also verifies the Employee lifecycle
record. It rejects disabled or unverified Auth users, inactive/expired
membership, stale or mismatched reciprocal bindings, and every shared-mode
request. The callable layer must still verify the incoming Firebase ID token
with revocation checking before invoking the mailbox service; the resolver
does not accept a client-supplied Employee ID.

This resolver is not yet wired into a callable. No provider authorization
payload is accepted from the browser, and no mailbox connection is enabled.

## OAuth transaction and PKCE core (synthetic-only)

A new server-only transaction coordinator provides OAuth state binding and PKCE S256 primitives for Gmail API and Microsoft Graph provider flows. It stores the verifier server-side through an injected persistence adapter, returns only state and challenge to the caller, and consumes transactions atomically by hashed state. Transactions are bound to account, actor UID and provider, expire after ten minutes, and are single-use. Unit tests use synthetic state storage only.


This is not a provider integration: redirect URI validation, OAuth client configuration, consent screens, callback HTTP handling, provider token exchange, encrypted vault storage, and Firebase callable wiring remain to be implemented and security-reviewed. The transaction store contract requires atomic consume/delete; no real provider or Firebase service has been accessed.

## Firestore OAuth transaction storage (server-only, synthetic tests)

A concrete Admin-SDK adapter for the PKCE transaction store now uses a Firestore transaction to read and delete a state-hash document atomically. Document IDs are SHA-256 state hashes; raw OAuth state is never persisted. The adapter validates record shape, provider allowlist, verifier format, and the fixed ten-minute lifetime. Expired/malformed transactions are deleted on consumption and fail closed. This adapter is not wired to Firebase or a callable; provider callback and configuration remain absent.

## Fixed OAuth authorization URL builder

Added a pure builder for Gmail and Microsoft authorization URLs. Endpoints and scopes are fixed in code (Gmail readonly; Microsoft Mail.Read), with PKCE S256 and a constrained Microsoft tenant selector. The redirect URI must be supplied by trusted server configuration and registered exactly with the provider; this builder validates HTTPS and rejects query/fragment but is not itself an allowlist and must never receive a client-controlled redirect. It is not callable-wired or connected to provider clients.

## Server-side authorization-code token exchange (synthetic tests)

Added a provider-fixed OAuth authorization-code exchange helper using injected server HTTP transport. It posts form data to fixed Google or Microsoft endpoints, uses the stored PKCE verifier, disables redirects, validates JSON/token fields and response size, and masks transport errors. It returns sensitive token material only to trusted server code; callers must verify identity/scopes and store credentials in the vault immediately. No HTTP requests are performed by tests (mock transport only). It is not wired to callables, real provider credentials, or a vault.

## OAuth mailbox owner identity verifier (synthetic-only)

Added `functions/src/membership/mailbox-owner-identity-verifier.js` to verify provider token identity before connection metadata is persisted.

- Google: fixed OpenID UserInfo endpoint; requires stable subject, `email_verified === true`, and normalized canonical email match.
- Microsoft: fixed Graph `/me` endpoint; requires provider user ID and matching `mail` or fallback `userPrincipalName`.
- Fixed URLs only, injected server transport, redirects rejected, bounded response text, generic errors, and token-free return shape.
- Normalization lowercases only; no plus-tag or dot normalization.
- Synthetic tests use mocked responses only.

Not integrated with callback/callable, vault, or live providers. Microsoft UPN may not represent primary SMTP; production policy for canonical mailbox matching still needs review. Caller must revalidate actor/membership and store tokens in a server vault immediately.

## Credential vault adapter boundary (synthetic-only)

Added `functions/src/membership/mailbox-credential-vault.js`, a server-side adapter contract for a secure secret backend. It accepts validated Google/Microsoft OAuth token material, generates a scoped opaque secret reference, and passes secret payload only to injected `backend.putSecret`. Revocation calls injected `deleteSecret` only for a secret ref matching the account/connection prefix. Backend errors are masked. Metadata remains separate; this adapter is not a concrete Secret Manager/KMS integration.

Synthetic tests use an in-memory stub only. No live tokens, vault credentials, Firebase or cloud calls were used. Production requires a real managed vault implementation, IAM least-privilege, audit/retention controls, provider refresh/revocation policy, and a reviewed recovery path.


## OAuth refresh helper (synthetic-only)

Added `functions/src/membership/mailbox-oauth-refresh-service.js`. It refreshes access tokens through fixed Google or Microsoft endpoints, using an injected server HTTP transport and rejecting redirects. Provider and tenant are allowlisted; response size and token fields are validated, and provider error details are masked. The return shape includes an optional rotated refresh token: the trusted caller must store any replacement immediately and retain the prior refresh token if none is returned. Refresh operations must be serialized per mailbox connection to avoid rotation races. Unit fixtures are synthetic/mock only. This helper is not wired to OAuth credentials, a vault, Firebase callable, polling worker, or real provider accounts. Tests are authored but not executed in this environment.
