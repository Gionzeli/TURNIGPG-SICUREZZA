const ALLOWED = new Set(["gmail_api", "microsoft_graph"]);
const REFRESH_SKEW_MS = 5 * 60 * 1000;

/** Orchestrates token refresh using injected vault/provider adapters.
 * The lock is process-local only; production must use distributed per-connection
 * locking or transactional leases to prevent refresh-token rotation races. */
export function createMailboxTokenLifecycleCoordinator({ vault, refreshService, now = () => Date.now() }) {
  if (!vault || typeof vault.loadSecret !== "function" || typeof vault.storeSecret !== "function" ||
      !refreshService || typeof refreshService.refresh !== "function") {
    throw new TypeError("Mailbox token lifecycle dependencies are required.");
  }
  const inFlight = new Map();
  return Object.freeze({
    async ensureFresh({ accountId, connectionId, provider, secretRef, clientId, clientSecret, tenant }) {
      if (!accountId || !connectionId || !secretRef || !ALLOWED.has(provider)) {
        const error = new Error("Token lifecycle input is invalid."); error.code = "invalid-argument"; throw error;
      }
      const lockKey = `${accountId}/${connectionId}`;
      if (inFlight.has(lockKey)) return inFlight.get(lockKey);
      const operation = (async () => {
        let stored;
        try { stored = await vault.loadSecret({ secretRef }); } catch {
          const error = new Error("Mailbox credential unavailable."); error.code = "reauth-required"; throw error;
        }
        if (!stored || typeof stored.accessToken !== "string" || stored.accessToken.length < 16) {
          const error = new Error("Mailbox credential unavailable."); error.code = "reauth-required"; throw error;
        }
        const expiry = stored.expiresAt;
        if (Number.isSafeInteger(expiry) && expiry > now() + REFRESH_SKEW_MS) {
          return Object.freeze({ status: "active", accessToken: stored.accessToken, expiresAt: expiry, refreshed: false });
        }
        if (typeof stored.refreshToken !== "string" || stored.refreshToken.length < 16) {
          const error = new Error("Mailbox requires reauthentication."); error.code = "reauth-required"; throw error;
        }
        let fresh;
        try {
          fresh = await refreshService.refresh({ provider, refreshToken: stored.refreshToken, clientId, clientSecret, tenant });
        } catch (error) {
          if (error?.code === "invalid-argument") throw error;
          const e = new Error("Mailbox requires reauthentication or retry."); e.code = error?.code === "unavailable" ? "unavailable" : "reauth-required"; throw e;
        }
        const newExpiry = now() + fresh.expiresInSeconds * 1000;
        const nextSecret = {
          accessToken: fresh.accessToken,
          refreshToken: fresh.refreshToken || stored.refreshToken,
          expiresAt: newExpiry,
          scopes: fresh.scope ? fresh.scope.split(" ").filter(Boolean) : stored.scopes
        };
        try { await vault.storeSecret({ secretRef, secretMaterial: nextSecret, expectedVersion: stored.version }); } catch {
          const error = new Error("Mailbox credential persistence failed."); error.code = "unavailable"; throw error;
        }
        return Object.freeze({ status: "active", accessToken: fresh.accessToken, expiresAt: newExpiry, refreshed: true });
      })();
      inFlight.set(lockKey, operation);
      try { return await operation; } finally { if (inFlight.get(lockKey) === operation) inFlight.delete(lockKey); }
    }
  });
}
