# Mailbox polling lease-renewal hardening — 2026-11-28

The scheduled polling worker now renews its account/connection-scoped fenced lease before provider fetching, before each message ingestion, after each message ingestion, and before the cursor checkpoint (the last renewal is the post-message renewal). The Firestore adapter delegates renewal to the established lease service using the same owner ID and fencing token.

Renewal results must retain owner and fencing token and contain a safe expiry later than the renewal timestamp. Any renewal failure or malformed/expired proof stops processing and prevents cursor advancement. The original lease is still used for best-effort release because release ownership is keyed by owner and fencing token; the renewed proof is passed to the checkpoint transaction.

This narrows stale-worker windows but is not a continuous heartbeat: a single slow provider or ingestion operation can still exceed the lease TTL. Ingestion must remain idempotent and independently fail closed, and checkpoint transaction still verifies a live lease. No real provider, credentials, or Firebase environment were used. Tests are synthetic and not executed in this environment.
