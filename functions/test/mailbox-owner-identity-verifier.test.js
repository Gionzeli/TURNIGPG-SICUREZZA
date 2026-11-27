import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyMailboxOwnerIdentity } from '../src/membership/mailbox-owner-identity-verifier.js';

const token = 'synthetic-access-token-123456';
const fakeResponse = (data, ok = true) => ({ ok, text: async () => JSON.stringify(data) });

test('Google requires verified email and exact normalized canonical match', async () => {
  const result = await verifyMailboxOwnerIdentity({
    provider: 'gmail_api', accessToken: token, expectedEmail: 'Person@Example.com',
    fetchImpl: async (url, opts) => {
      assert.equal(url, 'https://openidconnect.googleapis.com/v1/userinfo');
      assert.equal(opts.redirect, 'error');
      assert.equal(opts.headers.Authorization, `Bearer ${token}`);
      return fakeResponse({ sub: 'synthetic-google-sub', email: 'person@example.com', email_verified: true });
    },
  });
  assert.deepEqual(result, { provider: 'gmail_api', providerUserId: 'synthetic-google-sub', verifiedEmail: 'person@example.com' });
});

test('Google rejects unverified and mismatched email', async () => {
  for (const profile of [
    { sub: 'sub', email: 'person@example.com', email_verified: false },
    { sub: 'sub', email: 'else@example.com', email_verified: true },
  ]) {
    await assert.rejects(() => verifyMailboxOwnerIdentity({
      provider: 'gmail_api', accessToken: token, expectedEmail: 'person@example.com',
      fetchImpl: async () => fakeResponse(profile),
    }));
  }
});

test('Microsoft uses fixed Graph endpoint and UPN fallback', async () => {
  const result = await verifyMailboxOwnerIdentity({
    provider: 'microsoft_graph', accessToken: token, expectedEmail: 'user@example.com',
    fetchImpl: async (url) => {
      assert.equal(url, 'https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName');
      return fakeResponse({ id: 'synthetic-ms-id', mail: null, userPrincipalName: 'USER@example.com' });
    },
  });
  assert.equal(result.providerUserId, 'synthetic-ms-id');
  assert.equal(result.verifiedEmail, 'user@example.com');
});

test('Microsoft rejects mismatch, missing id/email, and HTTP failure', async () => {
  const invalid = [
    { id: 'id', mail: 'other@example.com', userPrincipalName: 'other@example.com' },
    { id: '', mail: 'user@example.com' },
    { id: 'id', mail: null, userPrincipalName: null },
  ];
  for (const profile of invalid) await assert.rejects(() => verifyMailboxOwnerIdentity({
    provider: 'microsoft_graph', accessToken: token, expectedEmail: 'user@example.com',
    fetchImpl: async () => fakeResponse(profile),
  }));
  await assert.rejects(() => verifyMailboxOwnerIdentity({
    provider: 'microsoft_graph', accessToken: token, expectedEmail: 'user@example.com',
    fetchImpl: async () => fakeResponse({}, false),
  }));
});

test('unsupported providers and invalid inputs fail closed', async () => {
  await assert.rejects(() => verifyMailboxOwnerIdentity({
    provider: 'imap', accessToken: token, expectedEmail: 'user@example.com', fetchImpl: async () => fakeResponse({}),
  }));
  await assert.rejects(() => verifyMailboxOwnerIdentity({
    provider: 'gmail_api', accessToken: 'short', expectedEmail: 'user@example.com', fetchImpl: async () => fakeResponse({}),
  }));
});
