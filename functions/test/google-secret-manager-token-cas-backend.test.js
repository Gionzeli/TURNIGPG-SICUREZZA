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
    pointerRefForRef: () => pointerRef
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
    pointerRefForRef:()=>({get:async()=>({})})
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

