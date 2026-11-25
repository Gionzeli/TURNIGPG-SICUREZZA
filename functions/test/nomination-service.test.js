import test from "node:test";
import assert from "node:assert/strict";
import { createAdminNomination, approveAdminNomination, cancelAdminNomination } from "../src/membership/nomination-service.js";

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
const stepUp = (uid, now = Date.now(), secondFactor = "totp") => ({ uid, emailVerified: true, authTime: Math.floor(now / 1000), secondFactor });

test("creates pending nomination with active canonical admin only", async()=>{
  const {db,store}=fakeDb({"accounts/ac1/members/adminA":admin("adminA")});
  const result=await createAdminNomination({db,accountId:"ac1",actorUid:"adminA",actorIdentity:stepUp("adminA",123),nominationId:"n1",...baseNom,now:()=>123});
  assert.equal(result.status,"pending");
  assert.equal(store.get("accounts/ac1/adminNominations/n1").nominatedBy,"adminA");
});
test("rejects non-admin proposer and duplicate nomination id",async()=>{
  const {db,store}=fakeDb({"accounts/ac1/members/memberA":{uid:"memberA",accountId:"ac1",status:"active",role:"member",scopeType:"department",scopeIds:["d1"]}});
  await assert.rejects(createAdminNomination({db,accountId:"ac1",actorUid:"memberA",actorIdentity:stepUp("memberA"),nominationId:"n1",...baseNom}),e=>e.code==="permission-denied");
  store.set("accounts/ac1/members/adminA",admin("adminA"));
  await createAdminNomination({db,accountId:"ac1",actorUid:"adminA",actorIdentity:stepUp("adminA"),nominationId:"n1",...baseNom});
  await assert.rejects(createAdminNomination({db,accountId:"ac1",actorUid:"adminA",actorIdentity:stepUp("adminA"),nominationId:"n1",...baseNom}),e=>e.code==="already-exists");
});
test("approval requires different active admin and atomically activates membership",async()=>{
  const {db,store}=fakeDb({"accounts/ac1/members/adminA":admin("adminA"),"accounts/ac1/members/adminB":admin("adminB")});
  await createAdminNomination({db,accountId:"ac1",actorUid:"adminA",actorIdentity:stepUp("adminA",123),nominationId:"n1",...baseNom,now:()=>123});
  await assert.rejects(approveAdminNomination({db,accountId:"ac1",actorUid:"adminA",actorIdentity:stepUp("adminA",123),nominationId:"n1",now:()=>123}),e=>e.code==="permission-denied");
  const result=await approveAdminNomination({db,accountId:"ac1",actorUid:"adminB",actorIdentity:stepUp("adminB",456),nominationId:"n1",now:()=>456});
  assert.equal(result.status,"approved");
  assert.equal(store.get("accounts/ac1/members/newUser").status,"active");
  assert.equal(store.get("accounts/ac1/adminNominations/n1").status,"approved");
});
test("approval rejects malformed or stale nomination and does not write membership",async()=>{
  const {db,store}=fakeDb({"accounts/ac1/members/adminA":admin("adminA"),"accounts/ac1/members/adminB":admin("adminB"),"accounts/ac1/adminNominations/n2":{...baseNom,accountId:"ac1",nominationId:"n2",status:"cancelled",nominatedBy:"adminA"}});
  await assert.rejects(approveAdminNomination({db,accountId:"ac1",actorUid:"adminB",actorIdentity:stepUp("adminB"),nominationId:"n2"}),e=>e.code==="failed-precondition");
  assert.equal(store.has("accounts/ac1/members/newUser"),false);
});

test("proposing active admin can cancel pending nomination with atomic audit",async()=>{
  const {db,store}=fakeDb({"accounts/ac1/members/adminA":admin("adminA")});
  await createAdminNomination({db,accountId:"ac1",actorUid:"adminA",actorIdentity:stepUp("adminA"),nominationId:"n3",...baseNom});
  const result=await cancelAdminNomination({db,accountId:"ac1",actorUid:"adminA",actorIdentity:stepUp("adminA",789),nominationId:"n3",eventId:"evt3",reason:"No longer needed",now:()=>789});
  const nomination=store.get("accounts/ac1/adminNominations/n3");
  const audit=store.get("accounts/ac1/membershipAudit/evt3");
  assert.equal(result.status,"cancelled");
  assert.equal(nomination.status,"cancelled");
  assert.equal(nomination.cancelledBy,"adminA");
  assert.equal(nomination.cancellationReason,"No longer needed");
  assert.equal(audit.type,"admin_nomination_cancelled");
  assert.equal(audit.reason,"No longer needed");
});
test("cancellation requires the same verified recent MFA identity as the actor", async () => {
  const nominationId = "cancel-step-up";
  const seed = {
    "accounts/ac1/members/adminA": admin("adminA"),
    [`accounts/ac1/adminNominations/${nominationId}`]: {
      ...baseNom, accountId: "ac1", nominationId, status: "pending", nominatedBy: "adminA"
    }
  };
  const {db,store} = fakeDb(seed);
  const common = {
    db, accountId: "ac1", actorUid: "adminA", nominationId,
    eventId: "cancel-step-up-event", reason: "Synthetic negative case", now: () => 10_000
  };
  await assert.rejects(cancelAdminNomination({
    ...common,
    actorIdentity: { uid: "adminA", emailVerified: true, authTime: 10, secondFactor: null }
  }), error => error.code === "permission-denied");
  await assert.rejects(cancelAdminNomination({
    ...common,
    actorIdentity: stepUp("different-admin", 10_000)
  }), error => error.code === "permission-denied");
  assert.equal(store.get(`accounts/ac1/adminNominations/${nominationId}`).status, "pending");
  assert.equal(store.has("accounts/ac1/membershipAudit/cancel-step-up-event"), false);
});

test("another active admin cannot cancel a nomination they did not propose",async()=>{
  const {db}=fakeDb({"accounts/ac1/members/adminA":admin("adminA"),"accounts/ac1/members/adminB":admin("adminB"),"accounts/ac1/adminNominations/n3":{...baseNom,accountId:"ac1",nominationId:"n3",status:"pending",nominatedBy:"adminA"}});
  await assert.rejects(cancelAdminNomination({db,accountId:"ac1",actorUid:"adminB",actorIdentity:stepUp("adminB"),nominationId:"n3",eventId:"evt3",reason:"Cancel"}),e=>e.code==="permission-denied");
});
test("cancellation rejects invalid reason, non-pending and duplicate audit event",async()=>{
  const seed={"accounts/ac1/members/adminA":admin("adminA"),"accounts/ac1/adminNominations/n3":{...baseNom,accountId:"ac1",nominationId:"n3",status:"pending",nominatedBy:"adminA"}};
  const first=fakeDb(seed);
  await assert.rejects(cancelAdminNomination({db:first.db,accountId:"ac1",actorUid:"adminA",actorIdentity:stepUp("adminA"),nominationId:"n3",eventId:"evt3",reason:"   "}),e=>e.code==="invalid-argument");
  const duplicate=fakeDb({...seed,"accounts/ac1/membershipAudit/evt3":{type:"existing"}});
  await assert.rejects(cancelAdminNomination({db:duplicate.db,accountId:"ac1",actorUid:"adminA",actorIdentity:stepUp("adminA"),nominationId:"n3",eventId:"evt3",reason:"Cancel"}),e=>e.code==="already-exists");
  const closed=fakeDb({...seed,"accounts/ac1/adminNominations/n3":{...seed["accounts/ac1/adminNominations/n3"],status:"approved"}});
  await assert.rejects(cancelAdminNomination({db:closed.db,accountId:"ac1",actorUid:"adminA",actorIdentity:stepUp("adminA"),nominationId:"n3",eventId:"evt4",reason:"Cancel"}),e=>e.code==="failed-precondition");
  assert.equal(closed.store.get("accounts/ac1/adminNominations/n3").status,"approved");
});

test("creation computes a fixed 24-hour expiry from the trusted clock", async()=>{
  const {db,store}=fakeDb({"accounts/ac1/members/adminA":admin("adminA")});
  const result = await createAdminNomination({
    db, accountId:"ac1", actorUid:"adminA", actorIdentity:stepUp("adminA",100),
    nominationId:"fixed-expiry", ...baseNom, expiresAt:1, now:()=>100
  });
  assert.equal(result.createdAt,100);
  assert.equal(result.expiresAt,100 + 24 * 60 * 60 * 1000);
  assert.equal(store.get("accounts/ac1/adminNominations/fixed-expiry").expiresAt, result.expiresAt);
});

test("approval rejects mismatched canonical selectors and expired nominations without writes", async()=>{
  const seed={
    "accounts/ac1/members/adminA":admin("adminA"),
    "accounts/ac1/members/adminB":admin("adminB"),
    "accounts/ac1/adminNominations/wrong-account":{...baseNom,accountId:"other",nominationId:"wrong-account",status:"pending",nominatedBy:"adminA",createdAt:1000,expiresAt:1000+24*60*60*1000},
    "accounts/ac1/adminNominations/wrong-id":{...baseNom,accountId:"ac1",nominationId:"different-id",status:"pending",nominatedBy:"adminA",createdAt:1000,expiresAt:1000+24*60*60*1000},
    "accounts/ac1/adminNominations/expired":{...baseNom,accountId:"ac1",nominationId:"expired",status:"pending",nominatedBy:"adminA",createdAt:100,expiresAt:500}
  };
  const {db,store}=fakeDb(seed);
  for (const nominationId of ["wrong-account","wrong-id","expired"]) {
    await assert.rejects(
      approveAdminNomination({db,accountId:"ac1",actorUid:"adminB",actorIdentity:stepUp("adminB",1000),nominationId,now:()=>1000}),
      e=>e.code==="failed-precondition"
    );
    assert.equal(store.has("accounts/ac1/members/newUser"),false);
    assert.equal(store.get(`accounts/ac1/adminNominations/${nominationId}`).status,"pending");
  }
});

test("approval rejects an invalid trusted clock without changing nomination or membership", async()=> {
  const nominationId = "invalid-clock";
  const nomination = {
    ...baseNom,
    accountId: "ac1",
    nominationId,
    status: "pending",
    nominatedBy: "adminA",
    expiresAt: 5000
  };
  const {db,store}=fakeDb({
    "accounts/ac1/members/adminA": admin("adminA"),
    "accounts/ac1/members/adminB": admin("adminB"),
    [`accounts/ac1/adminNominations/${nominationId}`]: nomination
  });

  await assert.rejects(
    approveAdminNomination({
      db,
      accountId: "ac1",
      actorUid: "adminB",
      actorIdentity: stepUp("adminB", 0),
      nominationId,
      now: () => Number.NaN
    }),
    error => error.code === "failed-precondition" &&
      error.message === "Trusted clock returned an invalid authorization timestamp."
  );

  assert.equal(store.has("accounts/ac1/members/newUser"), false);
  assert.deepEqual(
    store.get(`accounts/ac1/adminNominations/${nominationId}`),
    nomination
  );
});

test("nomination proposer and approver fail closed without recent supported MFA", async () => {
  const {db,store}=fakeDb({
    "accounts/ac1/members/adminA":admin("adminA"),
    "accounts/ac1/members/adminB":admin("adminB"),
    "accounts/ac1/adminNominations/no-mfa":{
      ...baseNom,accountId:"ac1",nominationId:"no-mfa",status:"pending",
      nominatedBy:"adminA",expiresAt:Date.now()+60_000
    }
  });
  await assert.rejects(createAdminNomination({
    db,accountId:"ac1",actorUid:"adminA",
    actorIdentity:{uid:"adminA",emailVerified:true,authTime:Math.floor(Date.now()/1000),secondFactor:null},
    nominationId:"blocked-proposal",...baseNom
  }), error=>error.code==="permission-denied");
  await assert.rejects(approveAdminNomination({
    db,accountId:"ac1",actorUid:"adminB",
    actorIdentity:{uid:"adminB",emailVerified:true,authTime:Math.floor(Date.now()/1000)-301,secondFactor:"phone"},
    nominationId:"no-mfa"
  }), error=>error.code==="permission-denied");
  assert.equal(store.has("accounts/ac1/members/newUser"),false);
  assert.equal(store.get("accounts/ac1/adminNominations/no-mfa").status,"pending");
});

test("unknown MFA factor and future auth_time are rejected", async () => {
  const {db}=fakeDb({"accounts/ac1/members/adminA":admin("adminA")});
  await assert.rejects(createAdminNomination({
    db,accountId:"ac1",actorUid:"adminA",
    actorIdentity:stepUp("adminA",Date.now(),"unknown-factor"),
    nominationId:"unknown-factor",...baseNom
  }), error=>error.code==="permission-denied");
  await assert.rejects(createAdminNomination({
    db,accountId:"ac1",actorUid:"adminA",
    actorIdentity:{uid:"adminA",emailVerified:true,authTime:Math.floor(Date.now()/1000)+1,secondFactor:"totp"},
    nominationId:"future-auth",...baseNom
  }), error=>error.code==="permission-denied");
});


test("approval rejects nominations whose stored lifetime exceeds 24 hours", async () => {
  const createdAt = 1_000;
  const nominationId = "overlong-expiry";
  const nomination = {
    ...baseNom, accountId: "ac1", nominationId, status: "pending",
    nominatedBy: "adminA", createdAt,
    expiresAt: createdAt + 24 * 60 * 60 * 1000 + 1
  };
  const {db,store}=fakeDb({
    "accounts/ac1/members/adminA": admin("adminA"),
    "accounts/ac1/members/adminB": admin("adminB"),
    [`accounts/ac1/adminNominations/${nominationId}`]: nomination
  });
  await assert.rejects(
    approveAdminNomination({
      db, accountId: "ac1", actorUid: "adminB",
      actorIdentity: stepUp("adminB", 2_000), nominationId, now: () => 2_000
    }),
    error => error.code === "failed-precondition"
  );
  assert.equal(store.has("accounts/ac1/members/newUser"), false);
  assert.deepEqual(store.get(`accounts/ac1/adminNominations/${nominationId}`), nomination);
});
