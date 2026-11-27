import test from "node:test";
import assert from "node:assert/strict";
import { createMailboxOAuthTokenExchange } from "../src/membership/mailbox-oauth-token-exchange.js";

const input = {
  provider: "gmail_api", code: "synthetic-auth-code",
  codeVerifier: "v".repeat(43), clientId: "synthetic-client-id",
  clientSecret: "synthetic-server-secret",
  redirectUri: "https://app.example.invalid/oauth/callback"
};
function response(body, ok = true, type = "application/json") {
  return { ok, headers: { get: name => name.toLowerCase() === "content-type" ? type : null },
    text: async () => JSON.stringify(body) };
}

test("uses fixed Google token endpoint, POST form and PKCE; never returns to client by itself", async () => {
  let captured;
  const exchange = createMailboxOAuthTokenExchange({ fetchImpl: async (url, options) => {
    captured = { url, options };
    return response({ access_token: "synthetic-access", refresh_token: "synthetic-refresh",
      id_token: "synthetic-id-token", expires_in: 3600, token_type: "Bearer", scope: "gmail.readonly" });
  }});
  const tokens = await exchange.exchange(input);
  assert.equal(captured.url, "https://oauth2.googleapis.com/token");
  assert.equal(captured.options.method, "POST");
  const params = new URLSearchParams(captured.options.body);
  assert.equal(params.get("code_verifier"), input.codeVerifier);
  assert.equal(params.get("client_secret"), input.clientSecret);
  assert.equal(tokens.accessToken, "synthetic-access");
  assert.equal(tokens.refreshToken, "synthetic-refresh");
  assert.equal(tokens.scope, "gmail.readonly");
});

test("Microsoft uses fixed tenant endpoint and validates token response", async () => {
  let endpoint;
  const exchange = createMailboxOAuthTokenExchange({ fetchImpl: async url => {
    endpoint = url;
    return response({ access_token: "a", expires_in: 3600, token_type: "Bearer", scope: "Mail.Read" });
  }});
  const tokens = await exchange.exchange({ ...input, provider: "microsoft_graph", tenant: "organizations" });
  assert.equal(endpoint, "https://login.microsoftonline.com/organizations/oauth2/v2.0/token");
  assert.equal(tokens.refreshToken, null);
});

test("invalid provider, redirect and transport failures fail closed without raw errors", async () => {
  const exchange = createMailboxOAuthTokenExchange({ fetchImpl: async () => { throw new Error("secret error details"); } });
  await assert.rejects(exchange.exchange({ ...input, provider: "imap" }), e => e.code === "invalid-argument");
  await assert.rejects(exchange.exchange({ ...input, redirectUri: "http://evil.invalid/cb" }), e => e.code === "invalid-argument");
  await assert.rejects(exchange.exchange(input), e => e.code === "unavailable" && !e.message.includes("secret error"));
});

test("rejects malformed token fields and non-JSON responses", async () => {
  const bad = createMailboxOAuthTokenExchange({ fetchImpl: async () => response({ access_token: "x" }) });
  await assert.rejects(bad.exchange(input), e => e.code === "unavailable");
  const html = createMailboxOAuthTokenExchange({ fetchImpl: async () => response({}, true, "text/html") });
  await assert.rejects(html.exchange(input), e => e.code === "unavailable");
});
