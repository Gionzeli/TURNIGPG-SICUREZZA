import test from 'node:test';
import assert from 'node:assert/strict';
import { createMailboxCredentialVault } from '../src/membership/mailbox-credential-vault.js';

const valid = { accessToken: 'synthetic-access-token-123456', refreshToken: 'synthetic-refresh-token-123456', expiresAt: 9999999999999, scopes: ['Mail.Read'] };

test('stores credential only through injected backend and returns opaque reference', async () => {
  let stored;
  const vault = createMailboxCredentialVault({
    backend: { putSecret: async (record) => { stored = record; }, deleteSecret: async () => {} },
    now: () => 1234, createId: () => 'synthetic-secret-id-12345',
  });
  const ref = await vault.storeSecret({ accountId: 'acct', connectionId: 'conn', provider: 'microsoft_graph', secretMaterial: valid });
  assert.equal(ref, 'mailbox/acct/conn/synthetic-secret-id-12345');
  assert.equal(stored.payload.accessToken, valid.accessToken);
  assert.equal(stored.payload.refreshToken, valid.refreshToken);
  assert.equal(stored.labels.provider, 'microsoft_graph');
});

test('rejects invalid credential shapes and malformed secret IDs', async () => {
  const vault = createMailboxCredentialVault({
    backend: { putSecret: async () => {}, deleteSecret: async () => {} }, createId: () => 'bad',
  });
  await assert.rejects(() => vault.storeSecret({ accountId: 'a', connectionId: 'b', provider: 'imap', secretMaterial: valid }));
  await assert.rejects(() => vault.storeSecret({ accountId: 'a', connectionId: 'b', provider: 'gmail_api', secretMaterial: { accessToken: 'tiny' } }));
});

test('backend failures are masked and revoke is scoped to connection prefix', async () => {
  const vault = createMailboxCredentialVault({
    backend: { putSecret: async () => { throw new Error('provider token leaked in error'); }, deleteSecret: async () => { throw new Error('raw error'); } },
    createId: () => 'synthetic-secret-id-12345',
  });
  await assert.rejects(() => vault.storeSecret({ accountId: 'a', connectionId: 'b', provider: 'gmail_api', secretMaterial: valid }), /Credential vault unavailable/);
  await assert.rejects(() => vault.revokeSecret({ secretRef: 'mailbox/a/other/secret', accountId: 'a', connectionId: 'b' }));
  await assert.rejects(() => vault.revokeSecret({ secretRef: 'mailbox/a/b/secret', accountId: 'a', connectionId: 'b' }), /revocation failed/);
});
