import test from 'node:test';
import assert from 'node:assert/strict';
import { createMailboxTokenLifecycleVaultAdapter } from '../src/membership/mailbox-token-lifecycle-vault-adapter.js';

const ref='mailbox/account_1/conn_1/abcdefghijklmnop';
const secret={accessToken:'synthetic-access-token-long',refreshToken:'synthetic-refresh-token-long',expiresAt:900000,scopes:['Mail.Read']};

test('reads and atomically replaces synthetic secret payload by opaque ref', async()=>{
 let payload={...secret}; const calls=[];
 const adapter=createMailboxTokenLifecycleVaultAdapter({backend:{
  readSecret:async({secretRef})=>{calls.push(['read',secretRef]);return payload;},
  replaceSecret:async({secretRef,payload:next})=>{calls.push(['replace',secretRef]);payload=next;}
 }});
 assert.deepEqual(await adapter.loadSecret({secretRef:ref}),secret);
 await adapter.storeSecret({secretRef:ref,secretMaterial:{...secret,accessToken:'synthetic-refreshed-access-token'}});
 assert.equal(payload.accessToken,'synthetic-refreshed-access-token'); assert.equal(calls.length,2);
});

test('rejects malformed refs and invalid token material',async()=>{
 const adapter=createMailboxTokenLifecycleVaultAdapter({backend:{readSecret:async()=>secret,replaceSecret:async()=>{}}});
 await assert.rejects(()=>adapter.loadSecret({secretRef:'../../invalid'}));
 await assert.rejects(()=>adapter.storeSecret({secretRef:ref,secretMaterial:{accessToken:'short',expiresAt:100}}));
});

test('masks backend errors',async()=>{
 const adapter=createMailboxTokenLifecycleVaultAdapter({backend:{readSecret:async()=>{throw new Error('secret leak');},replaceSecret:async()=>{throw new Error('secret leak');}}});
 await assert.rejects(()=>adapter.loadSecret({secretRef:ref}),/Mailbox credential unavailable/);
 await assert.rejects(()=>adapter.storeSecret({secretRef:ref,secretMaterial:secret}),/Mailbox credential persistence failed/);
});
