const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const MICROSOFT_ME_URL = 'https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName';

function normalizeEmail(value) {
  if (typeof value !== 'string' || value.length > 320) return null;
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

async function readJsonBounded(response, maxBytes = 16_384) {
  if (!response || !response.ok || typeof response.text !== 'function') throw new Error('Mailbox identity verification failed');
  const text = await response.text();
  if (typeof text !== 'string' || text.length > maxBytes) throw new Error('Mailbox identity verification failed');
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('Mailbox identity verification failed'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Mailbox identity verification failed');
  return data;
}

/** Fixed-endpoint identity verification; access tokens stay server-side. */
export async function verifyMailboxOwnerIdentity({ provider, accessToken, expectedEmail, fetchImpl }) {
  const email = normalizeEmail(expectedEmail);
  if (!email || typeof accessToken !== 'string' || accessToken.length < 16 || accessToken.length > 16_000 || typeof fetchImpl !== 'function') {
    throw new Error('Mailbox identity verification failed');
  }
  const endpoint = provider === 'gmail_api' ? GOOGLE_USERINFO_URL :
    provider === 'microsoft_graph' ? MICROSOFT_ME_URL : null;
  if (!endpoint) throw new Error('Unsupported mailbox provider');
  const response = await fetchImpl(endpoint, {
    method: 'GET', headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }, redirect: 'error',
  });
  const profile = await readJsonBounded(response);
  if (provider === 'gmail_api') {
    const providerEmail = normalizeEmail(profile.email);
    if (typeof profile.sub !== 'string' || !profile.sub || profile.sub.length > 256 ||
        profile.email_verified !== true || providerEmail !== email) throw new Error('Mailbox identity verification failed');
    return Object.freeze({ provider, providerUserId: profile.sub, verifiedEmail: providerEmail });
  }
  const providerUserId = profile.id;
  const providerEmail = normalizeEmail(profile.mail) || normalizeEmail(profile.userPrincipalName);
  if (typeof providerUserId !== 'string' || !providerUserId || providerUserId.length > 256 || !providerEmail || providerEmail !== email) {
    throw new Error('Mailbox identity verification failed');
  }
  return Object.freeze({ provider, providerUserId, verifiedEmail: providerEmail });
}
