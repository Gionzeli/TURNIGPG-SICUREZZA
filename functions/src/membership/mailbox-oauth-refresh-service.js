const REFRESH_ENDPOINTS = Object.freeze({
  gmail_api: "https://oauth2.googleapis.com/token",
  microsoft_graph: tenant => `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`
});
const TENANT_RE = /^(common|organizations|consumers|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const MAX_RESPONSE_BYTES = 32 * 1024;

function fail(code, message) { const error = new Error(message); error.code = code; throw error; }

/**
 * Server-only OAuth refresh. Endpoint, redirect behavior, and HTTP method are fixed.
 * Callers must store rotated refresh tokens immediately and retain the prior
 * refresh token when the provider omits a replacement.
 */
export function createMailboxOAuthRefreshService({ fetchImpl }) {
  if (typeof fetchImpl !== "function") throw new TypeError("Server HTTP transport is required.");
  return Object.freeze({
    async refresh({ provider, refreshToken, clientId, clientSecret, tenant = "organizations" }) {
      if (!["gmail_api", "microsoft_graph"].includes(provider) ||
          typeof refreshToken !== "string" || refreshToken.length < 16 || refreshToken.length > 16384 ||
          typeof clientId !== "string" || clientId.length < 8 || clientId.length > 256 || /[\s]/.test(clientId) ||
          typeof clientSecret !== "string" || clientSecret.length < 1 || clientSecret.length > 4096 ||
          (provider === "microsoft_graph" && (typeof tenant !== "string" || !TENANT_RE.test(tenant)))) {
        fail("invalid-argument", "OAuth refresh input is invalid.");
      }
      const endpoint = provider === "gmail_api" ? REFRESH_ENDPOINTS.gmail_api : REFRESH_ENDPOINTS.microsoft_graph(tenant);
      const body = new URLSearchParams({
        grant_type: "refresh_token", refresh_token: refreshToken,
        client_id: clientId, client_secret: clientSecret
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
        fail("unavailable", "OAuth refresh request failed.");
      }
      if (!response || !response.ok || typeof response.headers?.get !== "function" ||
          !/application\/json/i.test(response.headers.get("content-type") || "")) {
        fail("unavailable", "OAuth refresh endpoint returned an invalid response.");
      }
      let data;
      try {
        const text = await response.text();
        if (typeof text !== "string" || text.length > MAX_RESPONSE_BYTES) fail("unavailable", "OAuth refresh response is too large.");
        data = JSON.parse(text);
      } catch (error) {
        if (error?.code === "unavailable") throw error;
        fail("unavailable", "OAuth refresh response could not be parsed.");
      }
      if (!data || typeof data !== "object" || Array.isArray(data) ||
          typeof data.access_token !== "string" || data.access_token.length < 16 || data.access_token.length > 16384 ||
          (data.refresh_token !== undefined && (typeof data.refresh_token !== "string" ||
            data.refresh_token.length < 16 || data.refresh_token.length > 16384)) ||
          !Number.isSafeInteger(data.expires_in) || data.expires_in < 1 || data.expires_in > 86400 ||
          typeof data.token_type !== "string" || data.token_type.toLowerCase() !== "bearer" ||
          (data.scope !== undefined && (typeof data.scope !== "string" || data.scope.length > 4096))) {
        fail("unavailable", "OAuth refresh response failed validation.");
      }
      return Object.freeze({
        accessToken: data.access_token,
        refreshToken: data.refresh_token ?? null,
        expiresInSeconds: data.expires_in,
        scope: data.scope ?? null,
        tokenType: "Bearer"
      });
    }
  });
}
