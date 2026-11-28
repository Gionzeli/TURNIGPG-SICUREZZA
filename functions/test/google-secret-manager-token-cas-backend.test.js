import test from 'node:test';
import assert from 'node:assert/strict';
import { createGoogleSecretManagerTokenCasBackend } from '../src/membership/google-secret-manager-token-cas-backend.js';

function fixture() {
  const versions = new Map([['1', { accessToken:'synthetic-access-token-0001', refreshToken:'synthetic-refresh-token-0001', expiresAt:900000 }]]);
  let activeVersion = '1';
  let nextVersion = 2;
  const secretManager = {
    accessSecretVersion: async ({name}) => {
      const version = name.split('/').at(-1);
      const payload = versions.get(version);
      if (!payload) throw new Error('not found');
      return [{payload:{data:Buffer.from(JSON.stringify(payload))}}];
    },
    addSecretVersion: async ({parent,payload}) => {
      const version = String(nextVersion++);
      versions.set(version, JSON.parse(Buffer.from(payload.data).toString('utf8')));
      return [{name: parent + '/versions/' + version}];
    }
  };
  const pointerRef = {
    get: async () => ({exists:true,data:()=>({version:activeVersion})})
  };
  const firestore = {
    runTransaction: async callback => {
      const pending=[];
      const transaction = {
        get: async ref => ref.get(),
        update: (ref, value) => pending.push(value)
      };
      await callback(transaction);
      if (pending.length) activeVersion = pending[0].version;
    }
  };
  const backend = createGoogleSecretManagerTokenCasBackend({
    secretManager, firestore,
    secretNameForRef: () => 'projects/test-project/secrets/mailbox-test',
    pointerRefForRef: () => pointerRef,
    requireLeaseProof: false
  });
  return {backend,versions,get activeVersion(){return activeVersion;}};
}

const ref='mailbox/account_1/conn_1/abcdefghijklmnop';
test('reads Secret Manager version selected by Firestore pointer and advances pointer with CAS',async()=>{
  const f=fixture();
  const first=await f.backend.readSecret({secretRef:ref});
  assert.equal(first.version,'1');
  const next=await f.backend.replaceSecret({
    secretRef:ref,
    payload:{accessToken:'synthetic-access-token-0002',refreshToken:'synthetic-refresh-token-0002',expiresAt:990000},
    expectedVersion:'1'
  });
  assert.equal(next.version,'2');
  assert.equal(f.activeVersion,'2');
  assert.equal((await f.backend.readSecret({secretRef:ref})).payload.accessToken,'synthetic-access-token-0002');
});

test('rejects stale pointer writers without moving the active pointer',async()=>{
  const f=fixture();
  await f.backend.replaceSecret({
    secretRef:ref,
    payload:{accessToken:'synthetic-access-token-0002',refreshToken:'synthetic-refresh-token-0002',expiresAt:990000},
    expectedVersion:'1'
  });
  await assert.rejects(()=>f.backend.replaceSecret({
    secretRef:ref,
    payload:{accessToken:'synthetic-access-token-0003',refreshToken:'synthetic-refresh-token-0003',expiresAt:999000},
    expectedVersion:'1'
  }),{code:'conflict'});
  assert.equal(f.activeVersion,'2');
  // Secret Manager versions are immutable: the losing write may leave an orphan.
  assert.equal(f.versions.size,3);
});

test('rejects malformed references and untrusted resource mappings',async()=>{
  const f=fixture();
  await assert.rejects(()=>f.backend.readSecret({secretRef:'../../secret'}),/secret backend read failed/);
  const bad=createGoogleSecretManagerTokenCasBackend({
    secretManager:{accessSecretVersion:async()=>[],addSecretVersion:async()=>[]},
    firestore:{runTransaction:async()=>{}},
    secretNameForRef:()=> 'https://attacker.invalid/secret',
    pointerRefForRef:()=>({get:async()=>({})}),
    requireLeaseProof:false
  });
  await assert.rejects(()=>bad.replaceSecret({secretRef:ref,payload:{},expectedVersion:'1'}),/invalid trusted resource mapping/);
});

test('fences Secret Manager pointer update against the live Firestore lease in the same transaction',async()=>{
 const versions=new Map([['1',{accessToken:'synthetic-access-token-0001',refreshToken:'synthetic-refresh-token-0001',expiresAt:900000}]]);
 let activeVersion='1';
 let lease={ownerId:'owner_identifier_123',fencingToken:7,expiresAt:50000};
 let clock=10000;
 const pointerRef={get:async()=>({exists:true,data:()=>({version:activeVersion})})};
 const leaseRef={get:async()=>({exists:true,data:()=>lease})};
 const firestore={runTransaction:async callback=>{
  const writes=[];
  const tx={get:async ref=>ref.get(),update:(ref,value)=>writes.push([ref,value])};
  await callback(tx);
  for(const [ref,value] of writes) {
   if(ref===pointerRef) activeVersion=value.version;
   if(ref===leaseRef) lease={...lease,...value};
  }
 }};
 let next=2;
 const secretManager={
  addSecretVersion:async({parent,payload})=>{
   const version=String(next++);
   versions.set(version,JSON.parse(Buffer.from(payload.data).toString('utf8')));
   return [{name:parent+'/versions/'+version}];
  },
  accessSecretVersion:async({name})=>[{payload:{data:Buffer.from(JSON.stringify(versions.get(name.split('/').at(-1))))}}]
 };
 const backend=createGoogleSecretManagerTokenCasBackend({
  secretManager,firestore,now:()=>clock,
  secretNameForRef:()=> 'projects/test-project/secrets/mailbox-test',
  pointerRefForRef:()=>pointerRef,
  leaseRefForConnection:()=>leaseRef
 });
 const proof={ownerId:lease.ownerId,fencingToken:lease.fencingToken};
 const result=await backend.replaceSecret({
  secretRef:ref,payload:{accessToken:'synthetic-access-token-0002',refreshToken:'synthetic-refresh-token-0002',expiresAt:990000},
  expectedVersion:'1',leaseProof:proof
 });
 assert.equal(result.version,'2');
 assert.equal(activeVersion,'2');
 // A successor takes over the lease; the stale owner's otherwise-current CAS must fail.
 lease={ownerId:'successor_owner_identifier',fencingToken:8,expiresAt:60000};
 await assert.rejects(()=>backend.replaceSecret({
  secretRef:ref,payload:{accessToken:'synthetic-access-token-0003',refreshToken:'synthetic-refresh-token-0003',expiresAt:999000},
  expectedVersion:'2',leaseProof:proof
 }),{code:'conflict'});
 assert.equal(activeVersion,'2');
});


test('requires a lease proof by default',async()=>{
 const secretManager={accessSecretVersion:async()=>[],addSecretVersion:async()=>[{name:'projects/test-project/secrets/x/versions/2'}]};
 const pointerRef={get:async()=>({exists:true,data:()=>({version:'1'})})};
 const backend=createGoogleSecretManagerTokenCasBackend({
  secretManager,firestore:{runTransaction:async()=>{}},
  secretNameForRef:()=> 'projects/test-project/secrets/x',
  pointerRefForRef:()=>pointerRef,
  leaseRefForConnection:()=>({get:async()=>({exists:true,data:()=>({})})})
 });
 await assert.rejects(()=>backend.replaceSecret({
  secretRef:ref,payload:{},expectedVersion:'1'
 }),{code:'failed-precondition'});
});


test('CAS rejects malformed revocation marker and negative or unsafe lease expiry', async () => {
 for (const patch of [
  {revocationPending:'false'},
  {expiresAt:-1},
  {expiresAt:Number.MAX_SAFE_INTEGER+1}
 ]) {
  let activeVersion='1';
  let lease={ownerId:'owner_identifier_123',fencingToken:7,expiresAt:50000};
  const pointerRef={get:async()=>({exists:true,data:()=>({version:activeVersion})})};
  const leaseRef={get:async()=>({exists:true,data:()=>lease})};
  const firestore={runTransaction:async callback=>{
   const writes=[];
   const tx={get:async ref=>ref.get(),update:(ref,value)=>writes.push([ref,value])};
   await callback(tx);
   for(const [ref,value] of writes) if(ref===pointerRef) activeVersion=value.version;
  }};
  let next=2;
  const secretManager={
   addSecretVersion:async({parent})=>[{name:parent+'/versions/'+(next++)}],
   accessSecretVersion:async()=>[]
  };
  const backend=createGoogleSecretManagerTokenCasBackend({
   secretManager,firestore,now:()=>10000,
   secretNameForRef:()=> 'projects/test-project/secrets/mailbox-test',
   pointerRefForRef:()=>pointerRef,leaseRefForConnection:()=>leaseRef
  });
  lease={...lease,...patch};
  await assert.rejects(()=>backend.replaceSecret({
   secretRef:ref,payload:{accessToken:'synthetic-access-token-0002'},expectedVersion:'1',
   leaseProof:{ownerId:'owner_identifier_123',fencingToken:7}
  }),{code:'conflict'});
  assert.equal(activeVersion,'1');
 }
});
