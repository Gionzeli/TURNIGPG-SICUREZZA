const MAX_TOKEN = 16_384;
const REF_RE = /^mailbox\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9_-]{16,128}$/;
function validMaterial(v) {
  return v && typeof v === "object" && typeof v.accessToken === "string" &&
    v.accessToken.length >= 16 && v.accessToken.length <= MAX_TOKEN &&
    (v.refreshToken == null || (typeof v.refreshToken === "string" && v.refreshToken.length >= 16 && v.refreshToken.length <= MAX_TOKEN)) &&
    Number.isSafeInteger(v.expiresAt) && v.expiresAt > 0;
}
function validVersion(v) { return typeof v === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(v); }
/**
 * CAS adapter. readSecret returns {payload, version}; replaceSecret MUST perform
 * an atomic compare-and-swap against expectedVersion and return {version}.
 * A mismatch must reject with code=conflict. Never implement this as read-then-write.
 */
export function createMailboxTokenLifecycleVaultAdapter({ backend }) {
  if (!backend || typeof backend.readSecret !== "function" || typeof backend.replaceSecret !== "function") {
    throw new TypeError("Secure lifecycle secret backend is required.");
  }
  return Object.freeze({
    async loadSecret({ secretRef }) {
      if (typeof secretRef !== "string" || !REF_RE.test(secretRef)) throw new Error("Mailbox credential unavailable.");
      let record;
      try { record = await backend.readSecret({ secretRef }); } catch { throw new Error("Mailbox credential unavailable."); }
      if (!record || !validMaterial(record.payload) || !validVersion(record.version)) throw new Error("Mailbox credential unavailable.");
      return Object.freeze({
        accessToken: record.payload.accessToken, refreshToken: record.payload.refreshToken,
        expiresAt: record.payload.expiresAt, scopes: Array.isArray(record.payload.scopes) ? record.payload.scopes.slice(0,20) : undefined,
        version: record.version
      });
    },
    async storeSecret({ secretRef, secretMaterial, expectedVersion, leaseProof }) {
      if (typeof secretRef !== "string" || !REF_RE.test(secretRef) || !validVersion(expectedVersion) ||
          !validMaterial(secretMaterial) || (secretMaterial.scopes !== undefined &&
          (!Array.isArray(secretMaterial.scopes) || secretMaterial.scopes.length > 20 ||
          !secretMaterial.scopes.every(s => typeof s === "string" && s.length <= 256)))) {
        throw new Error("Credential vault rejected the request.");
      }
      const payload = {
        accessToken: secretMaterial.accessToken, refreshToken: secretMaterial.refreshToken,
        expiresAt: secretMaterial.expiresAt,
        ...(secretMaterial.scopes ? { scopes: [...new Set(secretMaterial.scopes)] } : {})
      };
      try {
        const result = await backend.replaceSecret({ secretRef, payload, expectedVersion, ...(leaseProof ? { leaseProof } : {}) });
        if (!result || !validVersion(result.version) || result.version === expectedVersion) throw new Error("invalid version result");
        return Object.freeze({ version: result.version });
      } catch (error) {
        if (error?.code === "conflict") {
          const conflict = new Error("Mailbox credential version conflict."); conflict.code = "conflict"; throw conflict;
        }
        throw new Error("Mailbox credential persistence failed.");
      }
    }
  });
}
