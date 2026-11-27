import test from 'node:test';
import assert from 'node:assert/strict';
import { createMailboxOAuthRefreshService } from '../src/membership/mailbox-oauth-refresh-service.js';

const response = (data) => ({ ok: true, headers: { get: () => 'application/json' }, text: async () => JSON.stringify(data) });
const valid = { access_token: 'synthetic-new-access-token-123', refresh_token: 'synthetic-rotated-refresh-token-123', expires_in: 3600, token_type: 'Bearer', scope: 'Mail.Read' };

test('refresh posts to provider-fixed endpoint and returns validated token material', async () => {
  let request;
  const service = createMailboxOAuthRefreshService({ fetchImpl: async (url, options) => { request = { url, options }; return response(valid); } });
  const result = await service.refresh({ provider: 'microsoft_graph', refreshToken: 'synthetic-refresh-token-12345', clientId: 'client-id-12345', clientSecret: 'synthetic-client-secret', tenant: 'organizations' });
  assert.equal(request.url, 'https://login.microsoftonline.com/organizations/oauth2/v2.0/token');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.redirect, 'error');
  assert.equal(new URLSearchParams(request.options.body).get('grant_type'), 'refresh_token');
  assert.equal(result.accessToken, valid.access_token);
  assert.equal(result.refreshToken, valid.refresh_token);
  assert.equal(result.tokenType, 'Bearer');
});

test('accepts omitted rotated refresh token and scope', async () => {
  const service = createMailboxOAuthRefreshService({ fetchImpl: async () => response({ access_token: 'synthetic-access-token-123', expires_in: 60, token_type: 'Bearer' }) });
  const result = await service.refresh({ provider: 'gmail_api', refreshToken: 'synthetic-refresh-token-12345', clientId: 'client-id-12345', clientSecret: 'synthetic-secret' });
  assert.equal(result.refreshToken, null);
  assert.equal(result.scope, null);
});

test('rejects invalid provider, tenant and malformed token response', async () => {
  const service = createMailboxOAuthRefreshService({ fetchImpl: async () => response({ access_token: 'short', expires_in: 0, token_type: 'Basic' }) });
  await assert.rejects(() => service.refresh({ provider: 'imap', refreshToken: 'synthetic-refresh-token-12345', clientId: 'client-id-12345', clientSecret: 'secret' }), { code: 'invalid-argument' });
  await assert.rejects(() => service.refresh({ provider: 'microsoft_graph', refreshToken: 'synthetic-refresh-token-12345', clientId: 'client-id-12345', clientSecret: 'secret', tenant: 'attacker.example' }), { code: 'invalid-argument' });
  await assert.rejects(() => service.refresh({ provider: 'gmail_api', refreshToken: 'synthetic-refresh-token-12345', clientId: 'client-id-12345', clientSecret: 'secret' }), { code: 'unavailable' });
});

test('masks transport errors', async () => {
  const service = createMailboxOAuthRefreshService({ fetchImpl: async () => { throw new Error('raw refresh secret'); } });
  await assert.rejects(() => service.refresh({ provider: 'gmail_api', refreshToken: 'synthetic-refresh-token-12345', clientId: 'client-id-12345', clientSecret: 'secret' }), /OAuth refresh request failed/);
});
