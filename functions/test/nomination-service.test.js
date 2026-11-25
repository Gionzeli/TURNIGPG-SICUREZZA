import test from "node:test";
import assert from "node:assert/strict";
import { createAdminNomination, approveAdminNomination } from "../src/membership/nomination-service.js";

const admin = uid => ({ uid, accountId:"ac1", status:"active", role:"admin", scopeType:"account", scopeIds:[] });
function fakeDb(seed={}) {
  const store = new Map(Object.entries(seed));
  const db = {
    doc(path){ return {path}; },
    async runTransaction(fn){
      const pending=[];
      const tx={
        async get(ref){ return {exists:store.has(ref.path),data:()=>store.get(ref.path)}; },
        create(ref,data){ if(store.has(ref.path)) throw new Error("exists"); pending.push(["create",ref.path,data]); },
        set(ref,data){ pending.push(["set",ref.path,data]); },
        update(ref,data){ pending.push(["update",ref.path,data]); }
      };
      const result=await fn(tx);
      for(const [op,path,data] of pending){ if(op==="create"&&store.has(path)) throw new Error("exists"); if(op==="update"&&!store.has(path)) throw new Error("missing"); store.set(path,op==="update"?{...store.get(path),...data}:data); }
      return result;
    }
  };
  return {db,store};
}
const baseNom={targetUid:"newUser",role:"manager",scopeType:"site",scopeIds:["siteA"]};

test("creates pending nomination with active canonical admin only", async()=>{
  const {db,store}=fakeDb({"accounts/ac1/members/adminA":admin("adminA")});
  const result=await createAdminNomination({db,accountId:"ac1",actorUid:"adminA",nominationId:"n1",...baseNom,now:()=>123});
  assert.equal(result.status,"pending");
  assert.equal(store.get("accounts/ac1/adminNominations/n1").nominatedBy,"adminA");
});
test("rejects non-admin proposer and duplicate nomination id",async()=>{
  const {db,store}=fakeDb({"accounts/ac1/members/memberA":{uid:"memberA",accountId:"ac1",status:"active",role:"member",scopeType:"department",scopeIds:["d1"]}});
  await assert.rejects(createAdminNomination({db,accountId:"ac1",actorUid:"memberA",nominationId:"n1",...baseNom}),e=>e.code==="permission-denied");
  store.set("accounts/ac1/members/adminA",admin("adminA"));
  await createAdminNomination({db,accountId:"ac1",actorUid:"adminA",nominationId:"n1",...baseNom});
  await assert.rejects(createAdminNomination({db,accountId:"ac1",actorUid:"adminA",nominationId:"n1",...baseNom}),e=>e.code==="already-exists");
});
test("approval requires different active admin and atomically activates membership",async()=>{
  const {db,store}=fakeDb({"accounts/ac1/members/adminA":admin("adminA"),"accounts/ac1/members/adminB":admin("adminB")});
  await createAdminNomination({db,accountId:"ac1",actorUid:"adminA",nominationId:"n1",...baseNom});
  await assert.rejects(approveAdminNomination({db,accountId:"ac1",actorUid:"adminA",nominationId:"n1"}),e=>e.code==="permission-denied");
  const result=await approveAdminNomination({db,accountId:"ac1",actorUid:"adminB",nominationId:"n1",now:()=>456});
  assert.equal(result.status,"approved");
  assert.equal(store.get("accounts/ac1/members/newUser").status,"active");
  assert.equal(store.get("accounts/ac1/adminNominations/n1").status,"approved");
});
test("approval rejects malformed or stale nomination and does not write membership",async()=>{
  const {db,store}=fakeDb({"accounts/ac1/members/adminA":admin("adminA"),"accounts/ac1/members/adminB":admin("adminB"),"accounts/ac1/adminNominations/n2":{...baseNom,accountId:"ac1",nominationId:"n2",status:"cancelled",nominatedBy:"adminA"}});
  await assert.rejects(approveAdminNomination({db,accountId:"ac1",actorUid:"adminB",nominationId:"n2"}),e=>e.code==="failed-precondition");
  assert.equal(store.has("accounts/ac1/members/newUser"),false);
});
