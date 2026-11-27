import test from "node:test";
import assert from "node:assert/strict";
import { createMailboxOAuthAuthorizationUrlBuilder } from "../src/membership/mailbox-oauth-authorization-url-builder.js";

const builder = createMailboxOAuthAuthorizationUrlBuilder();
const common = {
  clientId: "synthetic-client-id.apps.example.invalid",
  redirectUri: "https://app.example.invalid/mailbox/oauth/callback",
  state: "a".repeat(43),
  codeChallenge: "b".repeat(43)
};

test("Google URL uses fixed authorization endpoint, readonly scope, redirect and PKCE", () => {
  const url = new URL(builder.build({ ...common, provider: "gmail_api" }));
  assert.equal(url.origin, "https://accounts.google.com");
  assert.equal(url.pathname, "/o/oauth2/v2/auth");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("code_challenge"), common.codeChallenge);
  assert.equal(url.searchParams.get("redirect_uri"), common.redirectUri);
  assert.match(url.searchParams.get("scope"), /gmail\.readonly/);
  assert.doesNotMatch(url.searchParams.get("scope"), /gmail\.modify|gmail\.send/);
});

test("Microsoft URL uses allowlisted tenant selector and Mail.Read-only scope", () => {
  const url = new URL(builder.build({ ...common, provider: "microsoft_graph", tenant: "organizations" }));
  assert.equal(url.hostname, "login.microsoftonline.com");
  assert.equal(url.pathname, "/organizations/oauth2/v2.0/authorize");
  assert.match(url.searchParams.get("scope"), /Mail\.Read/);
  assert.doesNotMatch(url.searchParams.get("scope"), /Mail\.ReadWrite/);
});

test("rejects arbitrary provider, tenant, redirect and invalid PKCE inputs", () => {
  assert.throws(() => builder.build({ ...common, provider: "imap" }), e => e.code === "invalid-argument");
  assert.throws(() => builder.build({ ...common, provider: "microsoft_graph", tenant: "../../evil" }), e => e.code === "invalid-argument");
  assert.throws(() => builder.build({ ...common, redirectUri: "http://localhost/callback" }), e => e.code === "invalid-argument");
  assert.throws(() => builder.build({ ...common, redirectUri: "https://safe.example/callback?next=https://evil" }), e => e.code === "invalid-argument");
  assert.throws(() => builder.build({ ...common, state: "bad" }), e => e.code === "invalid-argument");
});
