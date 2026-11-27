import test from 'node:test';
import assert from 'node:assert/strict';
import { createMailboxTokenLifecycleVaultAdapter } from '../src/membership/mailbox-token-lifecycle-vault-adapter.js';

const ref='mailbox/account_1/conn_1/abcdefghijklmnop';
const secret={accessToken:'synthetic-access-token-long',refreshToken:'synthetic-refresh-token-long',expiresAt:900000,scopes:['Mail.Read']};

test('loads version and atomically compare-and-swaps synthetic secret', async()=>{
 let record={payload:{...secret},version:'v1'}; const calls=[];
 const adapter=createMailboxTokenLifecycleVaultAdapter({backend:{
  readSecret:async({secretRef})=>{calls.push(['read',secretRef]);return record;},
  replaceSecret:async({secretRef,payload,expectedVersion})=>{
   calls.push(['replace',secretRef,expectedVersion]);
   if(record.version!==expectedVersion){const e=new Error('conflict');e.code='conflict';throw e;}
   record={payload,version:'v2'}; return {version:'v2'};
  }
 }});
 assert.deepEqual(await adapter.loadSecret({secretRef:ref}),{...secret,version:'v1'});
 const result=await adapter.storeSecret({secretRef:ref,secretMaterial:{...secret,accessToken:'synthetic-refreshed-access-token'},expectedVersion:'v1'});
 assert.equal(result.version,'v2'); assert.equal(record.payload.accessToken,'synthetic-refreshed-access-token');
 assert.equal(calls[1][2],'v1');
});

test('rejects malformed refs, versions and token material',async()=>{
 const adapter=createMailboxTokenLifecycleVaultAdapter({backend:{readSecret:async()=>({payload:secret,version:'v1'}),replaceSecret:async()=>({version:'v2'})}});
 await assert.rejects(()=>adapter.loadSecret({secretRef:'../../invalid'}));
 await assert.rejects(()=>adapter.storeSecret({secretRef:ref,secretMaterial:{accessToken:'short',expiresAt:100},expectedVersion:'v1'}));
 await assert.rejects(()=>adapter.storeSecret({secretRef:ref,secretMaterial:secret,expectedVersion:'bad version'}));
});

test('preserves compare-and-swap conflicts and masks backend failures',async()=>{
 const conflict=createMailboxTokenLifecycleVaultAdapter({backend:{
  readSecret:async()=>({payload:secret,version:'v1'}),
  replaceSecret:async()=>{const e=new Error('provider detail');e.code='conflict';throw e;}
 }});
 await assert.rejects(()=>conflict.storeSecret({secretRef:ref,secretMaterial:secret,expectedVersion:'v1'}),{code:'conflict'});
 const broken=createMailboxTokenLifecycleVaultAdapter({backend:{
  readSecret:async()=>{throw new Error('secret leak');},
  replaceSecret:async()=>{throw new Error('secret leak');}
 }});
 await assert.rejects(()=>broken.loadSecret({secretRef:ref}),/Mailbox credential unavailable/);
 await assert.rejects(()=>broken.storeSecret({secretRef:ref,secretMaterial:secret,expectedVersion:'v1'}),/Mailbox credential persistence failed/);
});
