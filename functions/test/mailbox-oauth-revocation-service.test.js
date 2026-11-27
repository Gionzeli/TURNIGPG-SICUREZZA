import test from 'node:test';
import assert from 'node:assert/strict';
import { createMailboxOAuthRevocationService } from '../src/membership/mailbox-oauth-revocation-service.js';
const okResponse = { ok: true, headers: { get: () => 'application/json' }, text: async () => '{}' };
test('Google revocation posts to fixed endpoint and reports confirmed remote revoke', async () => {
 let request;
 const service = createMailboxOAuthRevocationService({ fetchImpl: async (url, options) => { request = { url, options }; return okResponse; } });
 const result = await service.revoke({ provider: 'gmail_api', token: 'synthetic-access-token-123' });
 assert.equal(request.url, 'https://oauth2.googleapis.com/revoke');
 assert.equal(request.options.method, 'POST');
 assert.equal(request.options.redirect, 'error');
 assert.equal(new URLSearchParams(request.options.body).get('token'), 'synthetic-access-token-123');
 assert.equal(result.remoteRevocation, 'confirmed');
});
test('Microsoft does not claim remote token revocation support', async () => {
 let called = false;
 const service = createMailboxOAuthRevocationService({ fetchImpl: async () => { called = true; return okResponse; } });
 const result = await service.revoke({ provider: 'microsoft_graph', token: 'synthetic-access-token-123' });
 assert.equal(called, false);
 assert.equal(result.remoteRevocation, 'unsupported');
 assert.equal(result.localCleanupRequired, true);
});
test('rejects invalid input and masks transport errors', async () => {
 const service = createMailboxOAuthRevocationService({ fetchImpl: async () => { throw new Error('secret leak'); } });
 await assert.rejects(() => service.revoke({ provider: 'imap', token: 'synthetic-access-token-123' }), { code: 'invalid-argument' });
 await assert.rejects(() => service.revoke({ provider: 'gmail_api', token: 'synthetic-access-token-123' }), /remote revocation request failed/);
});
