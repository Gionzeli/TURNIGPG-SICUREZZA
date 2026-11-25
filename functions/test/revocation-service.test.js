import test from "node:test";
import assert from "node:assert/strict";
import { revokeMembership } from "../src/membership/revocation-service.js";

const admin = uid => ({uid,accountId:"ac1",status:"active",role:"admin",scopeType:"account",scopeIds:[]});
const member = uid => ({uid,accountId:"ac1",status:"active",role:"member",scopeType:"department",scopeIds:["d1"]});
function fakeDb(seed={}) {
  const store=new Map(Object.entries(seed));
  const db={
    doc(path){return {path};},
    collection(path){return {where(...args){return {path,filters:[...(this.filters||[]),args]};},filters:[]};},
    async runTransaction(fn){
      const writes=[];
      const tx={
        async get(ref){
          if(ref.filters){
            const docs=[...store.entries()].filter(([p,v])=>p.startsWith(ref.path+"/")&&ref.filters.every(([field,op,val])=>op==="=="&&v[field]===val)).map(([path,data])=>({id:path.split("/").pop(),data:()=>data,ref:{path}}));
            return {docs};
          }
          return {exists:store.has(ref.path),data:()=>store.get(ref.path)};
        },
        update(ref,data){writes.push([ref.path,data]);}
      };
      const result=await fn(tx);
      for(const [path,data] of writes)store.set(path,{...store.get(path),...data});
      return result;
    }
  };
  return {db,store};
}
test("admin revokes active member and writes revocation metadata",async()=>{
  const {db,store}=fakeDb({"accounts/ac1/members/adminA":admin("adminA"),"accounts/ac1/members/m1":member("m1")});
  const out=await revokeMembership({db,accountId:"ac1",actorUid:"adminA",targetUid:"m1",now:()=>111});
  assert.equal(out.status,"revoked");
  assert.equal(store.get("accounts/ac1/members/m1").status,"revoked");
  assert.equal(store.get("accounts/ac1/members/m1").revokedBy,"adminA");
  assert.equal(store.get("accounts/ac1/members/m1").revokedAt,111);
});
test("non-admin denied; inactive and malformed target rejected without writes",async()=>{
  const {db,store}=fakeDb({"accounts/ac1/members/m1":member("m1"),"accounts/ac1/members/m2":member("m2")});
  await assert.rejects(revokeMembership({db,accountId:"ac1",actorUid:"m1",targetUid:"m2"}),e=>e.code==="permission-denied");
  store.set("accounts/ac1/members/adminA",admin("adminA"));
  store.set("accounts/ac1/members/m2",{...member("m2"),status:"inactive"});
  await assert.rejects(revokeMembership({db,accountId:"ac1",actorUid:"adminA",targetUid:"m2"}),e=>e.code==="failed-precondition");
  assert.equal(store.get("accounts/ac1/members/m2").status,"inactive");
});
test("last active admin cannot be revoked",async()=>{
  const {db,store}=fakeDb({"accounts/ac1/members/adminA":admin("adminA")});
  await assert.rejects(revokeMembership({db,accountId:"ac1",actorUid:"adminA",targetUid:"adminA"}),e=>e.code==="failed-precondition");
  assert.equal(store.get("accounts/ac1/members/adminA").status,"active");
});
test("admin can be revoked if another active admin remains",async()=>{
  const {db,store}=fakeDb({"accounts/ac1/members/adminA":admin("adminA"),"accounts/ac1/members/adminB":admin("adminB")});
  await revokeMembership({db,accountId:"ac1",actorUid:"adminB",targetUid:"adminA",now:()=>222});
  assert.equal(store.get("accounts/ac1/members/adminA").status,"revoked");
  assert.equal(store.get("accounts/ac1/members/adminB").status,"active");
});
test("rejects malformed selector",async()=>{
  const {db}=fakeDb();
  await assert.rejects(revokeMembership({db,accountId:"bad/id",actorUid:"adminA",targetUid:"m1"}),e=>e.code==="invalid-argument");
});
