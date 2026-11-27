const PROVIDER_CONFIG = Object.freeze({
  gmail_api: {
    endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
    scopes: ["https://www.googleapis.com/auth/gmail.readonly", "openid", "email"]
  },
  microsoft_graph: {
    scopes: ["https://graph.microsoft.com/Mail.Read", "openid", "email", "profile", "offline_access"]
  }
});
const TENANT = /^(common|organizations|consumers|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

function invalid(message) {
  const error = new Error(message);
  error.code = "invalid-argument";
  throw error;
}
function safeHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" && url.password === "" ? url : null;
  } catch { return null; }
}

/**
 * Build fixed-provider OAuth consent URLs from trusted server configuration.
 * No arbitrary endpoints, scopes, redirect URLs, or tenant path segments
 * are accepted from request payloads.
 */
export function createMailboxOAuthAuthorizationUrlBuilder() {
  return Object.freeze({
    build({ provider, clientId, redirectUri, state, codeChallenge, tenant = "common" }) {
      const config = PROVIDER_CONFIG[provider];
      if (!config || typeof clientId !== "string" || clientId.length < 8 ||
          clientId.length > 256 || /[\s]/.test(clientId) ||
          typeof state !== "string" || !/^[A-Za-z0-9_-]{40,128}$/.test(state) ||
          typeof codeChallenge !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) {
        invalid("OAuth provider configuration or transaction values are invalid.");
      }
      const redirect = safeHttpsUrl(redirectUri);
      if (!redirect || redirect.hash || redirect.search) {
        invalid("OAuth redirect URI must be a configured HTTPS URL without query or fragment.");
      }
      let endpoint = config.endpoint;
      if (provider === "microsoft_graph") {
        if (typeof tenant !== "string" || !TENANT.test(tenant)) invalid("Invalid Microsoft tenant selector.");
        endpoint = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`;
      }
      const url = new URL(endpoint);
      url.searchParams.set("client_id", clientId);
      url.searchParams.set("redirect_uri", redirect.href);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("response_mode", "query");
      url.searchParams.set("scope", config.scopes.join(" "));
      url.searchParams.set("state", state);
      url.searchParams.set("code_challenge", codeChallenge);
      url.searchParams.set("code_challenge_method", "S256");
      if (provider === "gmail_api") url.searchParams.set("access_type", "offline");
      return url.href;
    }
  });
}
