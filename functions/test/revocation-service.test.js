import test from "node:test";
import assert from "node:assert/strict";
import { revokeMembership } from "../src/membership/revocation-service.js";

const admin = uid => ({uid,accountId:"ac1",status:"active",validFrom:new Date(0),validUntil:null,role:"admin",scopeType:"account",scopeIds:[]});
const member = uid => ({uid,accountId:"ac1",status:"active",validFrom:new Date(0),validUntil:null,role:"member",scopeType:"department",scopeIds:["d1"]});
function fakeDb(seed={}) {
  const store=new Map(Object.entries(seed));
  const db={
    doc(path){return {path};},
    collection(path){const query={path,filters:[],where(field,op,value){return {...this,filters:[...this.filters,[field,op,value]]};}};return query;},
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
        update(ref,data){writes.push(["update",ref.path,data]);},
        create(ref,data){writes.push(["create",ref.path,data]);}
      };
      const result=await fn(tx);
      for(const [op,path,data] of writes){
        if(op==="create"&&store.has(path)) throw new Error("already exists");
        store.set(path,op==="update"?{...store.get(path),...data}:data);
      }
      return result;
    }
  };
  return {db,store};
}
const request=(overrides={})=>({db:overrides.db,accountId:"ac1",actorUid:"adminA",targetUid:"m1",eventId:"evt1",now:()=>111,...overrides});

test("revokes active member and appends audit event atomically",async()=>{
  const {db,store}=fakeDb({"accounts/ac1/members/adminA":admin("adminA"),"accounts/ac1/members/m1":member("m1")});
  const out=await revokeMembership(request({db}));
  assert.equal(out.status,"revoked");
  assert.equal(store.get("accounts/ac1/members/m1").status,"revoked");
  assert.equal(store.get("accounts/ac1/members/m1").revokedBy,"adminA");
  assert.equal(store.get("accounts/ac1/members/m1").revokedAt,111);
  assert.deepEqual(store.get("accounts/ac1/membershipAudit/evt1"),{
    eventId:"evt1",type:"membership.revoked",accountId:"ac1",targetUid:"m1",targetRole:"member",actorUid:"adminA",occurredAt:111
  });
});
test("non-admin denied and invalid target rejected without writes",async()=>{
  const {db,store}=fakeDb({"accounts/ac1/members/m1":member("m1"),"accounts/ac1/members/m2":member("m2")});
  await assert.rejects(revokeMembership({...request({db,actorUid:"m1",targetUid:"m2"} )}),e=>e.code==="permission-denied");
  store.set("accounts/ac1/members/adminA",admin("adminA"));
  store.set("accounts/ac1/members/m2",{...member("m2"),status:"inactive"});
  await assert.rejects(revokeMembership(request({db,targetUid:"m2"})),e=>e.code==="failed-precondition");
  assert.equal(store.has("accounts/ac1/membershipAudit/evt1"),false);
});
test("last active canonical admin cannot be revoked",async()=>{
  const {db,store}=fakeDb({"accounts/ac1/members/adminA":admin("adminA")});
  await assert.rejects(revokeMembership(request({db,targetUid:"adminA"})),e=>e.code==="failed-precondition");
  assert.equal(store.get("accounts/ac1/members/adminA").status,"active");
});
test("admin can be revoked if another canonical active admin remains",async()=>{
  const {db,store}=fakeDb({"accounts/ac1/members/adminA":admin("adminA"),"accounts/ac1/members/adminB":admin("adminB")});
  await revokeMembership(request({db,actorUid:"adminB",targetUid:"adminA",eventId:"evt2",now:()=>222}));
  assert.equal(store.get("accounts/ac1/members/adminA").status,"revoked");
  assert.equal(store.get("accounts/ac1/members/adminB").status,"active");
});
test("admin-shaped document whose ID differs from its uid does not count as remaining admin", async () => {
  const { db } = fakeDb({
    "accounts/ac1/members/adminA": admin("adminA"),
    "accounts/ac1/members/ghostDocument": admin("ghostIdentity")
  });
  await assert.rejects(
    revokeMembership(request({ db, targetUid: "adminA" })),
    error => error.code === "failed-precondition"
  );
});
test("malformed active admin document does not count as remaining admin",async()=>{
  const {db}=fakeDb({"accounts/ac1/members/adminA":admin("adminA"),"accounts/ac1/members/badAdmin":{uid:"badAdmin",accountId:"ac1",status:"active",validFrom:new Date(0),validUntil:null,role:"admin",scopeType:"site",scopeIds:["s1"]}});
  await assert.rejects(revokeMembership(request({db,targetUid:"adminA"})),e=>e.code==="failed-precondition");
});
test("duplicate audit event ID is rejected",async()=>{
  const {db,store}=fakeDb({"accounts/ac1/members/adminA":admin("adminA"),"accounts/ac1/members/m1":member("m1"),"accounts/ac1/membershipAudit/evt1":{type:"other"}});
  await assert.rejects(revokeMembership(request({db})),e=>e.code==="already-exists");
  assert.equal(store.get("accounts/ac1/members/m1").status,"active");
});
test("invalid trusted clock rejects revocation without membership or audit writes", async () => {
  const { db, store } = fakeDb({
    "accounts/ac1/members/adminA": admin("adminA"),
    "accounts/ac1/members/m1": member("m1")
  });
  await assert.rejects(
    revokeMembership(request({ db, now: () => Number.NaN })),
    error => error.code === "failed-precondition" &&
      error.message === "Trusted clock returned an invalid revocation timestamp."
  );
  assert.equal(store.get("accounts/ac1/members/m1").status, "active");
  assert.equal(store.has("accounts/ac1/membershipAudit/evt1"), false);
});
test("rejects malformed selector",async()=>{
  const {db}=fakeDb();
  await assert.rejects(revokeMembership(request({db,eventId:"bad/id"})),e=>e.code==="invalid-argument");
});
function storeValue(){return undefined;}
