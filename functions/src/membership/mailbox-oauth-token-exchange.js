const TOKEN_ENDPOINTS = Object.freeze({
  gmail_api: "https://oauth2.googleapis.com/token",
  microsoft_graph: tenant => `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`
});
const TENANT_RE = /^(common|organizations|consumers|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const MAX_RESPONSE_BYTES = 32 * 1024;

function fail(code, message) { const e = new Error(message); e.code = code; throw e; }
function validateHttpsRedirect(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash) return false;
    return true;
  } catch { return false; }
}

/**
 * Server-only OAuth authorization-code exchange. Provider endpoint is fixed,
 * HTTP transport is injected, credentials must come from server configuration.
 * Returned token material is sensitive and must immediately be stored in a vault.
 */
export function createMailboxOAuthTokenExchange({ fetchImpl }) {
  if (typeof fetchImpl !== "function") throw new TypeError("Server HTTP transport is required.");
  return Object.freeze({
    async exchange({ provider, code, codeVerifier, clientId, clientSecret, redirectUri, tenant = "organizations" }) {
      if (!["gmail_api", "microsoft_graph"].includes(provider) ||
          typeof code !== "string" || code.length < 1 || code.length > 4096 ||
          typeof codeVerifier !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(codeVerifier) ||
          typeof clientId !== "string" || clientId.length < 8 || clientId.length > 256 ||
          /[\s]/.test(clientId) || typeof clientSecret !== "string" ||
          clientSecret.length < 1 || clientSecret.length > 4096 ||
          !validateHttpsRedirect(redirectUri) ||
          (provider === "microsoft_graph" && (typeof tenant !== "string" || !TENANT_RE.test(tenant)))) {
        fail("invalid-argument", "OAuth token exchange input is invalid.");
      }
      const endpoint = provider === "gmail_api"
        ? TOKEN_ENDPOINTS.gmail_api : TOKEN_ENDPOINTS.microsoft_graph(tenant);
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
        code_verifier: codeVerifier
      });
      let response;
      try {
        response = await fetchImpl(endpoint, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
          body: body.toString(),
          redirect: "error"
        });
      } catch {
        fail("unavailable", "OAuth token endpoint request failed.");
      }
      if (!response || !response.ok || typeof response.headers?.get !== "function" ||
          !/application\/json/i.test(response.headers.get("content-type") || "")) {
        fail("unavailable", "OAuth token endpoint returned an invalid response.");
      }
      let data;
      try {
        const text = await response.text();
        if (typeof text !== "string" || text.length > MAX_RESPONSE_BYTES) {
          fail("unavailable", "OAuth token response is too large.");
        }
        data = JSON.parse(text);
      } catch (error) {
        if (error?.code === "unavailable") throw error;
        fail("unavailable", "OAuth token response could not be parsed.");
      }
      if (!data || typeof data !== "object" || Array.isArray(data) ||
          typeof data.access_token !== "string" || data.access_token.length < 1 ||
          data.access_token.length > 16384 ||
          (data.refresh_token !== undefined &&
            (typeof data.refresh_token !== "string" || data.refresh_token.length > 16384)) ||
          (data.id_token !== undefined &&
            (typeof data.id_token !== "string" || data.id_token.length > 32768)) ||
          !Number.isSafeInteger(data.expires_in) || data.expires_in < 1 || data.expires_in > 86400 ||
          typeof data.token_type !== "string" || data.token_type.toLowerCase() !== "bearer" ||
          typeof data.scope !== "string" || data.scope.length > 4096) {
        fail("unavailable", "OAuth token response failed validation.");
      }
      // Do not log or serialize this object into callable responses. Server caller
      // must verify identity/scopes and vault it before persisting any metadata.
      return Object.freeze({
        accessToken: data.access_token,
        refreshToken: data.refresh_token ?? null,
        idToken: data.id_token ?? null,
        tokenType: "Bearer",
        expiresInSeconds: data.expires_in,
        scope: data.scope
      });
    }
  });
}
