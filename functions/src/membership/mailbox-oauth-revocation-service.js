const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const MAX_RESPONSE_BYTES = 8 * 1024;

/** Server-only provider revocation boundary. Microsoft Graph does not expose a
 * general user OAuth-token revoke endpoint to ordinary delegated clients; this
 * service therefore reports remote revocation as unsupported for that provider.
 * Always disable the local connection and delete its vault secret first. */
export function createMailboxOAuthRevocationService({ fetchImpl }) {
  if (typeof fetchImpl !== "function") throw new TypeError("Server HTTP transport is required.");
  return Object.freeze({
    async revoke({ provider, token }) {
      if (!["gmail_api", "microsoft_graph"].includes(provider) ||
          typeof token !== "string" || token.length < 16 || token.length > 16384) {
        const error = new Error("OAuth revocation input is invalid."); error.code = "invalid-argument"; throw error;
      }
      if (provider === "microsoft_graph") {
        return Object.freeze({ provider, remoteRevocation: "unsupported", localCleanupRequired: true });
      }
      let response;
      try {
        response = await fetchImpl(GOOGLE_REVOKE_URL, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
          body: new URLSearchParams({ token }).toString(),
          redirect: "error"
        });
      } catch {
        const error = new Error("OAuth remote revocation request failed."); error.code = "unavailable"; throw error;
      }
      if (!response || !response.ok || typeof response.headers?.get !== "function") {
        const error = new Error("OAuth remote revocation failed."); error.code = "unavailable"; throw error;
      }
      const contentType = response.headers.get("content-type") || "";
      if (contentType && !/application\/json|text\/plain/i.test(contentType)) {
        const error = new Error("OAuth revocation response failed validation."); error.code = "unavailable"; throw error;
      }
      if (typeof response.text === "function") {
        let body;
        try { body = await response.text(); } catch { body = ""; }
        if (typeof body !== "string" || body.length > MAX_RESPONSE_BYTES) {
          const error = new Error("OAuth revocation response failed validation."); error.code = "unavailable"; throw error;
        }
      }
      return Object.freeze({ provider, remoteRevocation: "confirmed", localCleanupRequired: true });
    }
  });
}
