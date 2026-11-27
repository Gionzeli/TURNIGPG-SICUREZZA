import { randomUUID } from "node:crypto";

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const PROVIDERS = new Set(["imap", "gmail_api", "microsoft_graph", "custom_api"]);
const MODES = new Set(["personal", "shared"]);

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}
function email(value) {
  if (typeof value !== "string" || value.length > 254) return null;
  const normalized = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : null;
}
function requireId(value, label) {
  if (typeof value !== "string" || !ID.test(value)) fail("invalid-argument", "Invalid " + label + ".");
  return value;
}
function normalizeSenders(values) {
  if (!Array.isArray(values) || values.length < 1 || values.length > 30) {
    fail("invalid-argument", "Between one and thirty approved sender addresses are required.");
  }
  const normalized = values.map(email);
  if (normalized.some(value => !value) || new Set(normalized).size !== normalized.length) {
    fail("invalid-argument", "Sender allowlist contains an invalid or duplicate address.");
  }
  return normalized.sort();
}

/**
 * Server-only mailbox connection lifecycle.
 * Provider adapters must verify authorization and produce the grant passed to
 * connect(). Raw credentials go directly to the injected secret vault and are
 * never returned or persisted in connection metadata.
 */
export function createMailboxConnectionService({
  authorizeActor, exchangeAuthorization, storeSecret, revokeSecret, disableRefresh,
  recordSecretCleanup, completeSecretCleanup, saveConnection, loadConnection, writeAudit,
  now = () => Date.now(),
  createConnectionId = () => randomUUID().replaceAll("-", "")
}) {
  for (const [name, fn] of Object.entries({
    authorizeActor, exchangeAuthorization, storeSecret, revokeSecret, disableRefresh,
    recordSecretCleanup, completeSecretCleanup, saveConnection, loadConnection, writeAudit
  })) if (typeof fn !== "function") throw new TypeError(name + " dependency is required.");

  async function cleanupSecret({ accountId, connectionId, secretRef, reason }) {
    // Persist the retry ticket before attempting remote deletion. A failed
    // provider/vault call therefore remains discoverable after process exit.
    await recordSecretCleanup({
      accountId, connectionId, secretRef, reason, timestamp: now()
    });
    await revokeSecret({ secretRef, accountId, connectionId });
    await completeSecretCleanup({ accountId, connectionId, timestamp: now() });
  }

  async function authorize({ accountId, actorUid, mode }) {
    const principal = await authorizeActor({ accountId, actorUid, mode });
    if (!principal || principal.accountId !== accountId || principal.uid !== actorUid ||
        principal.status !== "active") fail("permission-denied", "Active canonical membership is required.");
    if (mode === "personal") {
      if (principal.role !== "member" || !ID.test(principal.employeeId ?? "")) {
        fail("permission-denied", "Personal mailbox connections require an active Employee member.");
      }
    } else if (principal.permissions?.manageSharedMailboxConnections !== true) {
      fail("permission-denied", "Explicit shared-mailbox management permission is required.");
    }
    return principal;
  }

  return Object.freeze({
    async connect({ accountId, actorUid, mode, provider, allowedSenders, authorizationPayload }) {
      requireId(accountId, "account");
      requireId(actorUid, "actor");
      if (!MODES.has(mode) || !PROVIDERS.has(provider)) fail("invalid-argument", "Unsupported mailbox mode or provider.");
      const principal = await authorize({ accountId, actorUid, mode });
      const senders = normalizeSenders(allowedSenders);
      const connectionId = requireId(createConnectionId(), "connection");
      const grant = await exchangeAuthorization({
        accountId, connectionId, mode, provider, actorUid, authorizationPayload
      });
      const mailboxAddress = email(grant?.mailboxAddress);
      if (!grant || grant.provider !== provider || grant.mailboxVerified !== true ||
          !mailboxAddress || grant.secretMaterial == null) {
        fail("permission-denied", "Mailbox authorization or address verification failed.");
      }
      if (mode === "personal" && mailboxAddress !== email(principal.email)) {
        fail("permission-denied", "Personal mailbox must match the verified member email.");
      }
      const secretRef = await storeSecret({
        accountId, connectionId, provider, secretMaterial: grant.secretMaterial
      });
      if (typeof secretRef !== "string" || secretRef.length < 1 || secretRef.length > 512) {
        // A vault may have stored the credential before returning a malformed
        // reference. Attempt scoped cleanup when a non-empty reference exists;
        // never persist it as connection metadata.
        if (typeof secretRef === "string" && secretRef.length > 0) {
          try { await cleanupSecret({ accountId, connectionId, secretRef, reason: "invalid_secret_ref" }); } catch {}
        }
        fail("failed-precondition", "Credential vault did not return a valid secret reference; cleanup may require vault review.");
      }
      const timestamp = now();
      const connection = {
        accountId, connectionId, provider, mode, status: "active",
        mailboxAddress, allowedSenders: senders,
        ownerUid: mode === "personal" ? principal.uid : null,
        ownerEmployeeId: mode === "personal" ? principal.employeeId : null,
        createdByUid: principal.uid, createdAt: timestamp, updatedAt: timestamp,
        credentialSecretRef: secretRef,
        consent: { grantedByUid: principal.uid, grantedAt: timestamp, version: 1 }
      };
      try {
        await saveConnection({ accountId, connectionId, connection });
        await writeAudit({
          accountId, actorUid: principal.uid, action: "mailbox_connection_created",
          connectionId, mode, provider, timestamp
        });
      } catch (error) {
        // If metadata was saved but audit failed, disable ingestion before
        // attempting to revoke the credential. Never leave an active dead ref.
        try {
          await saveConnection({
            accountId, connectionId,
            connection: { ...connection, status: "revocation_pending", updatedAt: now() }
          });
        } catch {}
        try { await disableRefresh({ accountId, connectionId }); } catch {}
        try { await cleanupSecret({ accountId, connectionId, secretRef, reason: "connection_setup_failed" }); } catch {}
        throw error;
      }
      return { connectionId, mode, provider, status: "active", mailboxAddress, allowedSenders: senders };
    },

    async revoke({ accountId, actorUid, connectionId }) {
      requireId(accountId, "account");
      requireId(actorUid, "actor");
      requireId(connectionId, "connection");
      const connection = await loadConnection({ accountId, connectionId });
      if (!connection || connection.accountId !== accountId || connection.connectionId !== connectionId) {
        fail("not-found", "Mailbox connection not found.");
      }
      const principal = await authorize({ accountId, actorUid, mode: connection.mode });
      if (connection.mode === "personal" &&
          (connection.ownerUid !== principal.uid || connection.ownerEmployeeId !== principal.employeeId)) {
        fail("permission-denied", "Only the owning employee may revoke a personal mailbox.");
      }
      if (connection.status === "revoked") return { connectionId, status: "revoked" };
      const timestamp = now();
      const pending = { ...connection, status: "revocation_pending", updatedAt: timestamp };
      await saveConnection({ accountId, connectionId, connection: pending });
      await disableRefresh({ accountId, connectionId });
      if (typeof connection.credentialSecretRef !== "string" || !connection.credentialSecretRef) {
        fail("failed-precondition", "Credential reference is missing; manual vault review is required.");
      }
      await cleanupSecret({
        accountId, connectionId, secretRef: connection.credentialSecretRef,
        reason: "connection_revoked"
      });
      // Record revocation completion only after the refresh gate and vault
      // cleanup have both completed; long-running deletion must not produce a
      // misleading earlier revokedAt timestamp.
      const completedAt = now();
      const revoked = {
        ...pending, status: "revoked", credentialSecretRef: null,
        updatedAt: completedAt, revokedAt: completedAt
      };
      await saveConnection({ accountId, connectionId, connection: revoked });
      await writeAudit({
        accountId, actorUid: principal.uid, action: "mailbox_connection_revoked",
        connectionId, mode: connection.mode, provider: connection.provider,
        timestamp: completedAt
      });
      return { connectionId, status: "revoked" };
    }
  });
}
