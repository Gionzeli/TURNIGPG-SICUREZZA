import { randomUUID } from "node:crypto";

const PROVIDERS = new Set(["gmail_api", "microsoft_graph"]);
const MAX_TOKEN = 16_000;

function isAlreadyAbsent(error) {
  const code = error?.code ?? error?.status ?? error?.statusCode;
  return code === "not-found" || code === "NOT_FOUND" || code === "404" ||
    code === 404 || code === 5 || code === "5";
}

/**
 * Adapter boundary for a server-side secret manager (e.g. cloud secret vault).
 * backend.putSecret and backend.deleteSecret must be implemented with secure
 * storage, access controls, encryption, and provider-specific lifecycle policy.
 * This module never writes credential material to Firestore.
 */
export function createMailboxCredentialVault({ backend, now = () => Date.now(), createId = () => randomUUID() }) {
  if (!backend || typeof backend.putSecret !== "function" || typeof backend.deleteSecret !== "function") {
    throw new TypeError("Secure secret backend is required");
  }

  return Object.freeze({
    async storeSecret({ accountId, connectionId, provider, secretMaterial }) {
      if (typeof accountId !== "string" || !accountId || typeof connectionId !== "string" || !connectionId ||
          !PROVIDERS.has(provider) || !secretMaterial || typeof secretMaterial !== "object ||
          typeof secretMaterial.accessToken !== "string" || secretMaterial.accessToken.length < 16 ||
          secretMaterial.accessToken.length > MAX_TOKEN ||
          (secretMaterial.refreshToken != null && (typeof secretMaterial.refreshToken !== "string" ||
            secretMaterial.refreshToken.length < 16 || secretMaterial.refreshToken.length > MAX_TOKEN))) {
        throw new Error("Credential vault rejected the request");
      }
      const secretId = createId();
      if (typeof secretId !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(secretId)) {
        throw new Error("Credential vault unavailable");
      }
      const secretRef = `mailbox/${accountId}/${connectionId}/${secretId}`;
      const payload = {
        provider,
        accessToken: secretMaterial.accessToken,
        ...(secretMaterial.refreshToken ? { refreshToken: secretMaterial.refreshToken } : {}),
        ...(Number.isSafeInteger(secretMaterial.expiresAt) && secretMaterial.expiresAt > now()
          ? { expiresAt: secretMaterial.expiresAt } : {}),
        ...(Array.isArray(secretMaterial.scopes) && secretMaterial.scopes.length <= 20 &&
          secretMaterial.scopes.every(s => typeof s === "string" && s.length <= 256)
          ? { scopes: [...new Set(secretMaterial.scopes)] } : {}),
        createdAt: now(),
      };
      try {
        await backend.putSecret({ secretRef, payload, labels: { provider, accountId, connectionId } });
      } catch {
        throw new Error("Credential vault unavailable");
      }
      return secretRef;
    },

    async revokeSecret({ secretRef, accountId, connectionId }) {
      if (typeof secretRef !== "string" || !secretRef.startsWith(`mailbox/${accountId}/${connectionId}/`)) {
        throw new Error("Credential vault rejected the request");
      }
      try {
        await backend.deleteSecret({ secretRef });
      } catch (error) {
        if (isAlreadyAbsent(error)) return;
        throw new Error("Credential vault revocation failed");
      }
    },
  });
}
