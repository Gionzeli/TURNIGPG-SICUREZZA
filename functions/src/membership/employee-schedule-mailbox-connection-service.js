const ID = /^[A-Za-z0-9_-]{1,128}$/;
const PROVIDERS = new Set(["imap", "gmail_api", "microsoft_graph", "custom_api"]);
const MODES = new Set(["personal", "shared"]);
const fail = (code, message) => { const error = new Error(message); error.code = code; throw error; };
const validId = value => typeof value === "string" && ID.test(value);
const cleanEmail = value => typeof value === "string" && value.length <= 254 &&
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) ? value.trim().toLowerCase() : null;

/**
 * Provider-neutral mailbox connection lifecycle.
 * Credentials are handed directly to a trusted vault adapter and never enter
 * Firestore config, callable responses, browser state, or audit records.
 * Authorization callbacks must resolve canonical membership/Employee scope
 * from a verified server identity; client-supplied role and Employee IDs are ignored.
 */
export function createEmployeeScheduleMailboxConnectionService({
  authorizePersonalConnection,
  authorizeSharedConnection,
  loadConnection,
  saveConnection,
  disableConnection,
  storeSecret,
  deleteSecret,
  createConnectionId,
  now = () => Date.now()
} = {}) {
  const deps = { authorizePersonalConnection, authorizeSharedConnection, loadConnection,
    saveConnection, disableConnection, storeSecret, deleteSecret, createConnectionId, now };
  for (const [name, fn] of Object.entries(deps)) if (typeof fn !== "function") {
    throw new TypeError(name + " dependency is required.");
  }

  return Object.freeze({
    async connect({ accountId, actor, mode, provider, mailboxAddress, allowedSenders, credential }) {
      if (!validId(accountId) || !actor || typeof actor.uid !== "string" ||
          !MODES.has(mode) || !PROVIDERS.has(provider) || !cleanEmail(mailboxAddress) ||
          !Array.isArray(allowedSenders) || allowedSenders.length < 1 || allowedSenders.length > 20 ||
          allowedSenders.some(value => !cleanEmail(value)) ||
          !credential || typeof credential !== "object" || Array.isArray(credential)) {
        fail("invalid-argument", "Invalid mailbox connection request.");
      }
      const authorization = mode === "personal"
        ? await authorizePersonalConnection({ accountId, actor })
        : await authorizeSharedConnection({ accountId, actor });
      if (!authorization || authorization.authorized !== true ||
          (mode === "personal" && (!validId(authorization.employeeId) ||
            authorization.uid !== actor.uid))) {
        fail("permission-denied", "Verified mailbox owner or authorized shared-mailbox manager required.");
      }

      const connectionId = createConnectionId();
      if (!validId(connectionId)) fail("internal", "Connection identifier generation failed.");
      const secretRef = await storeSecret({
        accountId, connectionId, provider, credential
      });
      if (typeof secretRef !== "string" || secretRef.length < 1 || secretRef.length > 512 ||
          /[\r\n]/.test(secretRef)) {
        fail("failed-precondition", "Credential vault did not return a valid secret reference.");
      }
      const createdAt = now();
      const record = Object.freeze({
        accountId, connectionId, mode, provider,
        mailboxAddress: cleanEmail(mailboxAddress),
        allowedSenders: [...new Set(allowedSenders.map(cleanEmail))],
        status: "active", secretRef,
        ...(mode === "personal" ? { ownerUid: actor.uid, ownerEmployeeId: authorization.employeeId } : {}),
        createdAt, updatedAt: createdAt, version: 1
      });
      try {
        await saveConnection({ accountId, connectionId, record,
          audit: { type: "mailbox.connection.created", actorUid: actor.uid, mode, provider, occurredAt: createdAt } });
      } catch (error) {
        await deleteSecret({ secretRef, accountId, connectionId });
        throw error;
      }
      return Object.freeze({ connectionId, mode, provider, mailboxAddress: record.mailboxAddress,
        status: "active", createdAt });
    },

    async revoke({ accountId, connectionId, actor }) {
      if (!validId(accountId) || !validId(connectionId) || !actor || typeof actor.uid !== "string") {
        fail("invalid-argument", "Invalid mailbox revocation request.");
      }
      const record = await loadConnection({ accountId, connectionId });
      if (!record || record.accountId !== accountId || record.connectionId !== connectionId) {
        fail("not-found", "Mailbox connection not found.");
      }
      if (record.status !== "active" || typeof record.secretRef !== "string") {
        fail("failed-precondition", "Mailbox connection is not active.");
      }
      if (record.mode === "personal") {
        const authorization = await authorizePersonalConnection({ accountId, actor });
        if (!authorization || authorization.authorized !== true ||
            authorization.uid !== actor.uid || authorization.employeeId !== record.ownerEmployeeId ||
            record.ownerUid !== actor.uid) {
          fail("permission-denied", "Only the connected employee can revoke this personal mailbox.");
        }
      } else if (record.mode === "shared") {
        const authorization = await authorizeSharedConnection({ accountId, actor });
        if (!authorization || authorization.authorized !== true) {
          fail("permission-denied", "Authorized shared-mailbox manager required to revoke this connection.");
        }
      } else {
        fail("failed-precondition", "Mailbox connection mode is invalid.");
      }
      const revokedAt = now();
      // Disable durable polling first. Secret deletion is subsequent and retryable.
      await disableConnection({ accountId, connectionId, expectedVersion: record.version,
        patch: { status: "revoked", revokedAt, updatedAt: revokedAt, version: record.version + 1 },
        audit: { type: "mailbox.connection.revoked", actorUid: actor.uid, occurredAt: revokedAt } });
      await deleteSecret({ secretRef: record.secretRef, accountId, connectionId });
      return Object.freeze({ connectionId, status: "revoked", revokedAt });
    }
  });
}
