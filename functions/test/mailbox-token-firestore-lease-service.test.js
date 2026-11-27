import test from 'node:test';
import assert from 'node:assert/strict';
import { createMailboxTokenFirestoreLeaseService } from '../src/membership/mailbox-token-firestore-lease-service.js';

function fixture() {
  let record=null, clock=10_000, owner=0, queue=Promise.resolve();
  const ref={get:async()=>({exists:record!==null,data:()=>record||{}})};
  const firestore={runTransaction:async callback=>{
    const run=queue.then(async()=>{
      const pending=[];
      const tx={
        get:async target=>target.get(),
        create:(_ref,value)=>pending.push(['create',value]),
        update:(_ref,value)=>pending.push(['update',value])
      };
      const result=await callback(tx);
      for(const [kind,value] of pending) record=kind==='create'?{...value}:{...record,...value};
      return result;
    });
    queue=run.catch(()=>{});
    return run;
  }};
  const service=createMailboxTokenFirestoreLeaseService({
    firestore,leaseRefForConnection:()=>ref,now:()=>clock,
    createOwnerId:()=>('owner_identifier_'+(++owner))
  });
  return {service,advance:ms=>{clock+=ms;},set record(value){record=value;},get record(){return record;}};
}

const scope={accountId:'account_1',connectionId:'connection_1'};
test('only one active owner acquires a mailbox lease; fencing increases after expiry',async()=>{
 const f=fixture();
 const first=await f.service.acquire({...scope,ttlMs:5000});
 await assert.rejects(()=>f.service.acquire({...scope,ttlMs:5000}),{code:'lease-held'});
 f.advance(5001);
 const second=await f.service.acquire({...scope,ttlMs:5000});
 assert.equal(second.fencingToken,first.fencingToken+1);
 assert.equal(await f.service.release({...scope,lease:first}),false);
 assert.equal(f.record.ownerId,second.ownerId);
});

test('renews only the current unexpired fencing token',async()=>{
 const f=fixture();
 const lease=await f.service.acquire({...scope,ttlMs:5000});
 f.advance(1000);
 const renewed=await f.service.renew({...scope,lease,ttlMs:7000});
 assert.equal(renewed.expiresAt,18000);
 assert.equal(f.record.expiresAt,18000);
 await assert.rejects(()=>f.service.renew({...scope,lease:{...lease,fencingToken:99}}),{code:'lease-lost'});
});

test('release is owner- and fencing-token-scoped',async()=>{
 const f=fixture();
 const lease=await f.service.acquire({...scope});
 assert.equal(await f.service.release({...scope,lease:{...lease,ownerId:'another_owner_identifier'}}),false);
 assert.equal(await f.service.release({...scope,lease}),true);
 assert.equal(f.record.ownerId,null);
});

test('validates scope and bounded lease duration',async()=>{
 const f=fixture();
 await assert.rejects(()=>f.service.acquire({accountId:'../bad',connectionId:'conn'}),{code:'invalid-argument'});
 await assert.rejects(()=>f.service.acquire({...scope,ttlMs:999999}),{code:'invalid-argument'});
});


test('rejects malformed persisted lease state instead of resetting fencing',async()=>{
 let record={ownerId:null,fencingToken:-1,expiresAt:0};
 const ref={get:async()=>({exists:true,data:()=>record})};
 const firestore={runTransaction:async callback=>callback({
  get:async()=>({exists:true,data:()=>record}),
  update:(_ref,value)=>{record={...record,...value};}
 })};
 const service=createMailboxTokenFirestoreLeaseService({
  firestore,leaseRefForConnection:()=>ref,now:()=>1000,
  createOwnerId:()=> 'owner_identifier_malformed'
 });
 await assert.rejects(()=>service.acquire({...scope}),{code:'unavailable'});
});

test('rejects invalid clock values',async()=>{
 const ref={get:async()=>({exists:false,data:()=>({})})};
 const firestore={runTransaction:async callback=>callback({get:async()=>({exists:false,data:()=>({})}),create:()=>{}})};
 const service=createMailboxTokenFirestoreLeaseService({
  firestore,leaseRefForConnection:()=>ref,now:()=>Number.NaN,
  createOwnerId:()=> 'owner_identifier_clock'
 });
 await assert.rejects(()=>service.acquire({...scope}),{code:'unavailable'});
});

test('disable atomically fences active refresh and blocks acquire and renew',async()=>{
 const f=fixture();
 const lease=await f.service.acquire({...scope,ttlMs:5000});
 const disabled=await f.service.disable(scope);
 assert.equal(disabled.status,'revocation_pending');
 assert.equal(f.record.revocationPending,true);
 await assert.rejects(()=>f.service.acquire({...scope}),{code:'failed-precondition'});
 await assert.rejects(()=>f.service.renew({...scope,lease}),{code:'lease-lost'});
 assert.equal(await f.service.release({...scope,lease}),true);
 assert.equal(f.record.revocationPending,true);
});

test('disable creates a permanent fail-closed gate when no lease record exists',async()=>{
 const f=fixture();
 await f.service.disable(scope);
 assert.equal(f.record.revocationPending,true);
 assert.equal(f.record.fencingToken,0);
 await assert.rejects(()=>f.service.acquire({...scope}),{code:'failed-precondition'});
});


test('cleanup gate assertion succeeds only after durable revocation disable',async()=>{
 const f=fixture();
 await assert.rejects(()=>f.service.assertRevocationPending(scope),{code:'failed-precondition'});
 await f.service.disable(scope);
 assert.deepEqual(await f.service.assertRevocationPending(scope),{status:'revocation_pending'});
});


test('cleanup gate assertion rejects malformed persisted fencing and expiry values',async()=>{
 const f=fixture();
 f.record={ownerId:null,fencingToken:-1,expiresAt:0,revocationPending:true};
 await assert.rejects(()=>f.service.assertRevocationPending(scope),{code:'failed-precondition'});
 f.record={ownerId:null,fencingToken:0,expiresAt:-1,revocationPending:true};
 await assert.rejects(()=>f.service.assertRevocationPending(scope),{code:'failed-precondition'});
 f.record={ownerId:null,fencingToken:0,expiresAt:0,revocationPending:true};
 assert.deepEqual(await f.service.assertRevocationPending(scope),{status:'revocation_pending'});
});
