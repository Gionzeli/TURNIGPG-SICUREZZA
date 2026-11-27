import test from 'node:test';
import assert from 'node:assert/strict';
import { createMailboxTokenLifecycleCoordinator } from '../src/membership/mailbox-token-lifecycle-coordinator.js';

const expired = { accessToken: 'synthetic-old-access-token', refreshToken: 'synthetic-refresh-token', expiresAt: 0, version: 'v1', scopes: ['Mail.Read'] };

test('returns current token when expiry is outside refresh skew', async () => {
 const coordinator = createMailboxTokenLifecycleCoordinator({
  vault: { loadSecret: async () => ({ ...expired, expiresAt: 5000000 }), storeSecret: async () => {} },
  refreshService: { refresh: async () => { throw new Error('should not refresh'); } }, now: () => 1000
 });
 const result = await coordinator.ensureFresh({ accountId:'acct', connectionId:'conn', provider:'gmail_api', secretRef:'opaque', clientId:'client-id-12345', clientSecret:'secret' });
 assert.equal(result.status,'active'); assert.equal(result.refreshed,false);
});

test('refreshes expired token and retains refresh token if provider omits rotation', async () => {
 let stored;
 const coordinator = createMailboxTokenLifecycleCoordinator({
  vault: { loadSecret: async () => expired, storeSecret: async ({secretRef,secretMaterial,expectedVersion}) => { stored={secretRef,secretMaterial,expectedVersion}; } },
  refreshService: { refresh: async () => ({ accessToken:'synthetic-new-access-token', refreshToken:null, expiresInSeconds:3600, scope:'Mail.Read' }) },
  now: () => 10000
 });
 const result = await coordinator.ensureFresh({accountId:'acct',connectionId:'conn',provider:'microsoft_graph',secretRef:'opaque',clientId:'client-id-12345',clientSecret:'secret',tenant:'organizations'});
 assert.equal(result.refreshed,true); assert.equal(stored.secretRef,'opaque'); assert.equal(stored.expectedVersion,'v1');
 assert.equal(stored.secretMaterial.refreshToken,expired.refreshToken);
 assert.equal(stored.secretMaterial.expiresAt,3610000);
});

test('deduplicates concurrent refreshes within one process', async () => {
 let refreshes=0, writes=0;
 const coordinator = createMailboxTokenLifecycleCoordinator({
  vault:{loadSecret:async()=>expired,storeSecret:async()=>{writes++;}},
  refreshService:{refresh:async()=>{refreshes++; await new Promise(resolve=>setImmediate(resolve)); return {accessToken:'synthetic-new-access-token',refreshToken:'synthetic-new-refresh-token',expiresInSeconds:3600,scope:'scope'};}},
  now:()=>5000
 });
 const args={accountId:'a',connectionId:'c',provider:'gmail_api',secretRef:'r',clientId:'client-id-12345',clientSecret:'secret'};
 const [a,b]=await Promise.all([coordinator.ensureFresh(args),coordinator.ensureFresh(args)]);
 assert.equal(refreshes,1); assert.equal(writes,1); assert.equal(a.refreshed,true); assert.deepEqual(a,b);
});

test('fails closed without refresh token and masks vault errors', async () => {
 const noRefresh=createMailboxTokenLifecycleCoordinator({vault:{loadSecret:async()=>({accessToken:'synthetic-access-token',expiresAt:0}),storeSecret:async()=>{}},refreshService:{refresh:async()=>{}},now:()=>1});
 await assert.rejects(()=>noRefresh.ensureFresh({accountId:'a',connectionId:'c',provider:'gmail_api',secretRef:'r',clientId:'client-id-12345',clientSecret:'secret'}),{code:'reauth-required'});
 const vaultFail=createMailboxTokenLifecycleCoordinator({vault:{loadSecret:async()=>{throw new Error('sensitive');},storeSecret:async()=>{}},refreshService:{refresh:async()=>{}},now:()=>1});
 await assert.rejects(()=>vaultFail.ensureFresh({accountId:'a',connectionId:'c',provider:'gmail_api',secretRef:'r',clientId:'client-id-12345',clientSecret:'secret'}),/Mailbox credential unavailable/);
});

test('uses distributed lease before refresh and renews before persisting rotated credentials',async()=>{
 const events=[];
 const coordinator=createMailboxTokenLifecycleCoordinator({
  vault:{loadSecret:async()=>expired,storeSecret:async args=>{events.push(['store',args.expectedVersion,args.leaseProof]);}},
  refreshService:{refresh:async()=>{events.push(['refresh']);return {accessToken:'synthetic-new-access-token',refreshToken:'synthetic-new-refresh-token',expiresInSeconds:3600};}},
  leaseService:{
   acquire:async args=>{events.push(['acquire',args.ttlMs]);return {ownerId:'owner_identifier_123',fencingToken:4,expiresAt:200000};},
   renew:async args=>{events.push(['renew',args.lease.fencingToken]);return {...args.lease,expiresAt:300000};},
   release:async args=>{events.push(['release',args.lease.fencingToken]);return true;}
  },
  now:()=>5000
 });
 const result=await coordinator.ensureFresh({accountId:'acct',connectionId:'conn',provider:'gmail_api',secretRef:'opaque',clientId:'client-id-12345',clientSecret:'secret'});
 assert.equal(result.refreshed,true);
 assert.deepEqual(events.map(x=>x[0]),['acquire','refresh','renew','store','release']);
 assert.deepEqual(events.find(x=>x[0]==='store')[2],{ownerId:'owner_identifier_123',fencingToken:4});
});

test('does not persist refreshed credentials when revocation invalidates the lease before commit',async()=>{
 let writes=0, releases=0;
 const coordinator=createMailboxTokenLifecycleCoordinator({
  vault:{loadSecret:async()=>expired,storeSecret:async()=>{writes++;}},
  refreshService:{refresh:async()=>({accessToken:'synthetic-new-access-token',refreshToken:'synthetic-new-refresh-token',expiresInSeconds:3600})},
  leaseService:{
   acquire:async()=>({ownerId:'owner_identifier_revocation',fencingToken:7,expiresAt:200000}),
   renew:async()=>{const error=new Error('revocation gate set');error.code='lease-lost';throw error;},
   release:async()=>{releases++;return true;}
  },
  now:()=>5000
 });
 await assert.rejects(()=>coordinator.ensureFresh({
  accountId:'acct',connectionId:'conn',provider:'gmail_api',secretRef:'opaque',
  clientId:'client-id-12345',clientSecret:'secret'
 }),{code:'unavailable'});
 assert.equal(writes,0);
 assert.equal(releases,1);
});

test('fails closed on invalid or overflowing token lifecycle clocks before vault access', async () => {
  for (const clock of [() => Number.NaN, () => -1, () => Number.MAX_SAFE_INTEGER]) {
    let reads = 0, refreshes = 0, writes = 0;
    const coordinator = createMailboxTokenLifecycleCoordinator({
      vault: {
        loadSecret: async () => { reads++; return expired; },
        storeSecret: async () => { writes++; }
      },
      refreshService: { refresh: async () => { refreshes++; return {
        accessToken: 'synthetic-new-access-token', refreshToken: 'synthetic-new-refresh-token', expiresInSeconds: 3600
      }; } },
      now: clock
    });
    await assert.rejects(() => coordinator.ensureFresh({
      accountId: 'acct', connectionId: 'conn', provider: 'gmail_api', secretRef: 'opaque',
      clientId: 'client-id-12345', clientSecret: 'secret'
    }), { code: 'unavailable' });
    assert.equal(reads, 0);
    assert.equal(refreshes, 0);
    assert.equal(writes, 0);
  }
});

test('rechecks freshness after a slow vault read instead of using a stale initial clock', async () => {
  let clockReads = 0, refreshes = 0;
  const coordinator = createMailboxTokenLifecycleCoordinator({
    vault: {
      loadSecret: async () => ({ ...expired, expiresAt: 301001 }),
      storeSecret: async () => {}
    },
    refreshService: { refresh: async () => { refreshes++; return {
      accessToken: 'synthetic-new-access-token', refreshToken: null, expiresInSeconds: 3600
    }; } },
    now: () => (++clockReads === 1 ? 1000 : 2000)
  });
  const result = await coordinator.ensureFresh({
    accountId: 'acct', connectionId: 'conn', provider: 'gmail_api', secretRef: 'opaque',
    clientId: 'client-id-12345', clientSecret: 'secret'
  });
  assert.equal(result.refreshed, true);
  assert.equal(refreshes, 1);
});

test('does not persist refreshed tokens if the clock becomes invalid after provider response', async () => {
  let clockReads = 0, writes = 0;
  const coordinator = createMailboxTokenLifecycleCoordinator({
    vault: { loadSecret: async () => expired, storeSecret: async () => { writes++; } },
    refreshService: { refresh: async () => ({
      accessToken: 'synthetic-new-access-token', refreshToken: null, expiresInSeconds: 3600
    }) },
    now: () => (++clockReads === 1 ? 1000 : Number.NaN)
  });
  await assert.rejects(() => coordinator.ensureFresh({
    accountId: 'acct', connectionId: 'conn', provider: 'gmail_api', secretRef: 'opaque',
    clientId: 'client-id-12345', clientSecret: 'secret'
  }), { code: 'unavailable' });
  assert.equal(writes, 0);
});
