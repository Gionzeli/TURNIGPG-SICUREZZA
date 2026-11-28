const ID = /^[A-Za-z0-9_-]{1,128}$/;
const PROVIDERS = new Set(["imap", "gmail_api", "microsoft_graph", "custom_api"]);

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

/**
 * Provider-neutral scheduled ingestion orchestrator.
 * Provider adapters fetch normalized messages only; ingestion remains the
 * authority for sender authentication, PDF scanning, parsing and proposals.
 * A cursor advances only after every fetched message has been processed.
 */
export function createMailboxScheduleIngestionWorker({
  listDueConnections, loadConnection, acquireLease, renewLease, releaseLease,
  providerAdapters, ingestMessage, saveCheckpoint, now = () => Date.now()
}) {
  for (const [name, fn] of Object.entries({
    listDueConnections, loadConnection, acquireLease, renewLease, releaseLease,
    ingestMessage, saveCheckpoint
  })) if (typeof fn !== "function") throw new TypeError(name + " dependency is required.");
  if (!providerAdapters || typeof providerAdapters !== "object") {
    throw new TypeError("Provider adapters are required.");
  }
  return Object.freeze({
    async run({ accountId, limit = 20 } = {}) {
      if (!ID.test(accountId ?? "") || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
        fail("invalid-argument", "Invalid account or worker batch limit.");
      }
      const due = await listDueConnections({ accountId, limit });
      if (!Array.isArray(due) || due.length > limit) fail("failed-precondition", "Mailbox due-list is invalid.");
      const results = [];
      const seen = new Set();
      for (const candidate of due) {
        if (!candidate || candidate.accountId !== accountId ||
            !ID.test(candidate.connectionId ?? "") || seen.has(candidate.connectionId) ||
            (candidate.cursor != null && (typeof candidate.cursor !== "string" || candidate.cursor.length > 2048))) {
          fail("failed-precondition", "Mailbox due-list contains an invalid or duplicate connection.");
        }
        seen.add(candidate.connectionId);
      }
      for (const candidate of due) {
        const connectionId = candidate.connectionId;
        const lease = await acquireLease({ accountId, connectionId, timestamp: now() });
        if (!lease || lease.acquired !== true) {
          results.push({ connectionId, status: "skipped_locked" });
          continue;
        }
        try {
          const renewalTime = now();
          let activeLease = await renewLease({ accountId, connectionId, lease, timestamp: renewalTime });
          if (!activeLease || activeLease.ownerId !== lease.ownerId || activeLease.fencingToken !== lease.fencingToken || !Number.isSafeInteger(activeLease.expiresAt) || activeLease.expiresAt <= renewalTime) fail("failed-precondition", "Mailbox lease renewal failed.");
          const connection = await loadConnection({ accountId, connectionId });
          if (!connection || connection.accountId !== accountId ||
              connection.connectionId !== connectionId || connection.status !== "active" ||
              !PROVIDERS.has(connection.provider)) {
            results.push({ connectionId, status: "skipped_inactive" });
            continue;
          }
          const adapter = providerAdapters[connection.provider];
          if (!adapter || typeof adapter.fetchMessages !== "function") {
            results.push({ connectionId, status: "provider_unavailable" });
            continue;
          }
          const fetchRenewalTime = now();
          activeLease = await renewLease({ accountId, connectionId, lease: activeLease, timestamp: fetchRenewalTime });
          if (!activeLease || activeLease.ownerId !== lease.ownerId || activeLease.fencingToken !== lease.fencingToken || !Number.isSafeInteger(activeLease.expiresAt) || activeLease.expiresAt <= fetchRenewalTime) fail("failed-precondition", "Mailbox lease renewal failed.");
          const batch = await adapter.fetchMessages({
            accountId, connectionId, connection, cursor: candidate.cursor ?? null, limit: 50
          });
          if (!batch || !Array.isArray(batch.messages) || batch.messages.length > 50 ||
              typeof batch.nextCursor !== "string" || batch.nextCursor.length > 2048) {
            fail("failed-precondition", "Provider returned an invalid mailbox batch.");
          }
          let messageCount = 0;
          let attachmentCount = 0;
          for (const item of batch.messages) {
            if (!item || !item.message || !Array.isArray(item.attachments)) {
              fail("failed-precondition", "Provider returned an invalid normalized message.");
            }
            const messageRenewalTime = now();
            activeLease = await renewLease({ accountId, connectionId, lease: activeLease, timestamp: messageRenewalTime });
            if (!activeLease || activeLease.ownerId !== lease.ownerId || activeLease.fencingToken !== lease.fencingToken || !Number.isSafeInteger(activeLease.expiresAt) || activeLease.expiresAt <= messageRenewalTime) fail("failed-precondition", "Mailbox lease renewal failed.");
            const outcomes = await ingestMessage({
              accountId, connectionId, message: item.message, attachments: item.attachments
            });
            if (!Array.isArray(outcomes)) fail("failed-precondition", "Ingestion returned an invalid result.");
            const postMessageRenewalTime = now();
            activeLease = await renewLease({ accountId, connectionId, lease: activeLease, timestamp: postMessageRenewalTime });
            if (!activeLease || activeLease.ownerId !== lease.ownerId || activeLease.fencingToken !== lease.fencingToken || !Number.isSafeInteger(activeLease.expiresAt) || activeLease.expiresAt <= postMessageRenewalTime) fail("failed-precondition", "Mailbox lease renewal failed.");
            messageCount++;
            attachmentCount += item.attachments.length;
          }
          const current = await loadConnection({ accountId, connectionId });
          if (!current || current.status !== "active" ||
              current.accountId !== accountId || current.connectionId !== connectionId) {
            results.push({ connectionId, status: "revoked_during_batch", messageCount });
            continue;
          }
          await saveCheckpoint({
            accountId, connectionId, expectedCursor: candidate.cursor ?? null,
            nextCursor: batch.nextCursor, lease: activeLease, timestamp: now()
          });
          results.push({ connectionId, status: "processed", messageCount, attachmentCount });
        } catch {
          results.push({ connectionId, status: "retry_required" });
        } finally {
          try { await releaseLease({ accountId, connectionId, lease }); } catch { /* lease expiry is recovery */ }
        }
      }
      return results;
    }
  });
}
