const MAX_TOKEN = 16_384;
const PROVIDERS = new Set(["gmail_api", "microsoft_graph"]);
function validMaterial(v) {
  return v && typeof v === "object" && typeof v.accessToken === "string" &&
    v.accessToken.length >= 16 && v.accessToken.length <= MAX_TOKEN &&
    (v.refreshToken == null || (typeof v.refreshToken === "string" && v.refreshToken.length >= 16 && v.refreshToken.length <= MAX_TOKEN)) &&
    Number.isSafeInteger(v.expiresAt) && v.expiresAt > 0;
}
/**
 * Adapter for the lifecycle coordinator. Backend must provide readSecret and
 * replaceSecret, both scoped to an opaque ref and protected server-side.
 * replaceSecret must atomically replace/version secret payload at the same ref.
 */
export function createMailboxTokenLifecycleVaultAdapter({ backend }) {
  if (!backend || typeof backend.readSecret !== "function" || typeof backend.replaceSecret !== "function") {
    throw new TypeError("Secure lifecycle secret backend is required.");
  }
  return Object.freeze({
    async loadSecret({ secretRef }) {
      if (typeof secretRef !== "string" || !/^mailbox\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9_-]{16,128}$/.test(secretRef)) {
        throw new Error("Mailbox credential unavailable.");
      }
      let payload;
      try { payload = await backend.readSecret({ secretRef }); } catch { throw new Error("Mailbox credential unavailable."); }
      if (!validMaterial(payload)) throw new Error("Mailbox credential unavailable.");
      return Object.freeze({ accessToken: payload.accessToken, refreshToken: payload.refreshToken, expiresAt: payload.expiresAt, scopes: Array.isArray(payload.scopes) ? payload.scopes.slice(0,20) : undefined });
    },
    async storeSecret({ secretRef, secretMaterial }) {
      if (typeof secretRef !== "string" || !/^mailbox\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9_-]{16,128}$/.test(secretRef) ||
          !validMaterial(secretMaterial) || (secretMaterial.scopes !== undefined && (!Array.isArray(secretMaterial.scopes) || secretMaterial.scopes.length > 20 || !secretMaterial.scopes.every(s => typeof s === "string" && s.length <= 256)))) {
        throw new Error("Credential vault rejected the request.");
      }
      const payload = { accessToken: secretMaterial.accessToken, refreshToken: secretMaterial.refreshToken, expiresAt: secretMaterial.expiresAt, ...(secretMaterial.scopes ? { scopes: [...new Set(secretMaterial.scopes)] } : {}) };
      try { await backend.replaceSecret({ secretRef, payload }); } catch { throw new Error("Mailbox credential persistence failed."); }
    }
  });
}
