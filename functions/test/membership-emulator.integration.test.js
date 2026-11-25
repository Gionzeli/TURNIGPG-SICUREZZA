import test from "node:test";
import assert from "node:assert/strict";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createAdminNomination, approveAdminNomination, cancelAdminNomination } from "../src/membership/nomination-service.js";
import { revokeMembership } from "../src/membership/revocation-service.js";

const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const verifiedAdminIdentity = (uid, nowMs = Date.now()) => ({ uid, emailVerified: true, authTime: Math.floor(nowMs / 1000), secondFactor: "totp" });

test("Firestore Emulator: nomination approval, cancellation and membership revocation", { skip: !enabled }, async () => {
  const app = initializeApp({ projectId: "demo-dsm-membership" }, "membership-integration");
  const db = getFirestore(app);
  const accountId = "integration-account";
  const members = db.collection(`accounts/${accountId}/members`);
  const nominations = db.collection(`accounts/${accountId}/adminNominations`);
  const audit = db.collection(`accounts/${accountId}/membershipAudit`);

  async function clear(collection) {
    const snapshot = await collection.get();
    await Promise.all(snapshot.docs.map(doc => doc.ref.delete()));
  }

  try {
    await Promise.all([clear(members), clear(nominations), clear(audit)]);
    const admin = uid => ({
      uid, accountId, status: "active", role: "admin",
      scopeType: "account", scopeIds: []
    });
    await Promise.all([
      members.doc("adminA").set(admin("adminA")),
      members.doc("adminB").set(admin("adminB"))
    ]);

    await createAdminNomination({
      db, accountId, actorUid: "adminA", actorIdentity: verifiedAdminIdentity("adminA", 100), nominationId: "approve-1",
      targetUid: "manager1", role: "manager", scopeType: "site",
      scopeIds: ["site1"], now: () => 100
    });
    await approveAdminNomination({
      db, accountId, actorUid: "adminB", actorIdentity: verifiedAdminIdentity("adminB", 200), nominationId: "approve-1", now: () => 200
    });
    const approved = await nominations.doc("approve-1").get();
    const manager = await members.doc("manager1").get();
    assert.equal(approved.data().status, "approved");
    assert.equal(manager.data().status, "active");
    assert.equal(manager.data().approvedBy, "adminB");

    await createAdminNomination({
      db, accountId, actorUid: "adminA", actorIdentity: verifiedAdminIdentity("adminA", 300), nominationId: "cancel-1",
      targetUid: "member2", role: "member", scopeType: "department",
      scopeIds: ["dept1"], now: () => 300
    });
    await cancelAdminNomination({
      db, accountId, actorUid: "adminA", actorIdentity: verifiedAdminIdentity("adminA", 400), nominationId: "cancel-1",
      eventId: "audit-cancel-1", reason: "Synthetic integration cancellation",
      now: () => 400
    });
    const cancelled = await nominations.doc("cancel-1").get();
    const cancellationEvent = await audit.doc("audit-cancel-1").get();
    assert.equal(cancelled.data().status, "cancelled");
    assert.equal(cancellationEvent.data().type, "admin_nomination_cancelled");

    await revokeMembership({
      db, accountId, actorUid: "adminA", targetUid: "manager1",
      eventId: "audit-revoke-1", now: () => 500
    });
    const revoked = await members.doc("manager1").get();
    const revocationEvent = await audit.doc("audit-revoke-1").get();
    assert.equal(revoked.data().status, "revoked");
    assert.equal(revocationEvent.data().type, "membership.revoked");

    // Negative authorization: a regular member cannot administer memberships.
    await members.doc("memberActor").set({
      uid: "memberActor", accountId, status: "active", role: "member",
      scopeType: "department", scopeIds: ["dept1"]
    });
    await assert.rejects(
      revokeMembership({
        db, accountId, actorUid: "memberActor", targetUid: "memberActor",
        eventId: "audit-member-denied"
      }),
      error => error.code === "permission-denied"
    );
    await assert.rejects(
      createAdminNomination({
        db, accountId, actorUid: "memberActor", actorIdentity: verifiedAdminIdentity("memberActor"), nominationId: "member-nomination",
        targetUid: "member3", role: "member", scopeType: "department",
        scopeIds: ["dept1"]
      }),
      error => error.code === "permission-denied"
    );

    // Only the original proposer may cancel, even when another admin is active.
    await createAdminNomination({
      db, accountId, actorUid: "adminA", actorIdentity: verifiedAdminIdentity("adminA"), nominationId: "cancel-denied",
      targetUid: "member4", role: "member", scopeType: "department",
      scopeIds: ["dept1"]
    });
    await assert.rejects(
      cancelAdminNomination({
        db, accountId, actorUid: "adminB", actorIdentity: verifiedAdminIdentity("adminB"), nominationId: "cancel-denied",
        eventId: "audit-cancel-denied", reason: "Synthetic negative test"
      }),
      error => error.code === "permission-denied"
    );
    assert.equal((await nominations.doc("cancel-denied").get()).data().status, "pending");

    // Malformed admin-shaped documents must not bypass the last-admin guard.
    await members.doc("malformedAdmin").set({
      uid: "malformedAdmin", accountId, status: "active", role: "admin",
      scopeType: "site", scopeIds: ["site1"]
    });
    await revokeMembership({
      db, accountId, actorUid: "adminB", targetUid: "adminA",
      eventId: "audit-revoke-adminA", now: () => 600
    });
    // A document whose ID differs from its uid field is not a canonical admin.
    // It must not preserve the last-admin guard after adminA has been revoked.
    await members.doc("ghostDocument").set({
      uid: "ghostIdentity", accountId, status: "active", role: "admin",
      scopeType: "account", scopeIds: []
    });
    await assert.rejects(
      revokeMembership({
        db, accountId, actorUid: "adminB", targetUid: "adminB",
        eventId: "audit-revoke-last-admin", now: () => 700
      }),
      error => error.code === "failed-precondition"
    );
    assert.equal((await members.doc("adminB").get()).data().status, "active");
    assert.equal((await audit.doc("audit-revoke-last-admin").get()).exists, false);

    // Malformed pending nomination must not activate a membership.
    await nominations.doc("malformed-nomination").set({
      accountId, nominationId: "malformed-nomination", targetUid: "member5",
      role: "admin", scopeType: "site", scopeIds: ["site1"],
      status: "pending", nominatedBy: "adminA"
    });
    await assert.rejects(
      approveAdminNomination({
        db, accountId, actorUid: "adminB", actorIdentity: verifiedAdminIdentity("adminB"), nominationId: "malformed-nomination"
      }),
      error => error.code === "failed-precondition"
    );
    assert.equal((await nominations.doc("malformed-nomination").get()).data().status, "pending");
    assert.equal((await members.doc("member5").get()).exists, false);

    // Duplicate audit selectors reject cancellation and revocation without writes.
    await createAdminNomination({
      db, accountId, actorUid: "adminB", actorIdentity: verifiedAdminIdentity("adminB"), nominationId: "duplicate-audit-nomination",
      targetUid: "member6", role: "member", scopeType: "department",
      scopeIds: ["dept1"]
    });
    await audit.doc("audit-duplicate-cancel").set({ type: "pre-existing synthetic event" });
    await assert.rejects(
      cancelAdminNomination({
        db, accountId, actorUid: "adminB", actorIdentity: verifiedAdminIdentity("adminB"),
        nominationId: "duplicate-audit-nomination",
        eventId: "audit-duplicate-cancel", reason: "Synthetic duplicate event"
      }),
      error => error.code === "already-exists"
    );
    assert.equal((await nominations.doc("duplicate-audit-nomination").get()).data().status, "pending");

    await members.doc("member7").set({
      uid: "member7", accountId, status: "active", role: "member",
      scopeType: "department", scopeIds: ["dept1"]
    });
    await audit.doc("audit-duplicate-revoke").set({ type: "pre-existing synthetic event" });
    await assert.rejects(
      revokeMembership({
        db, accountId, actorUid: "adminB", targetUid: "member7",
        eventId: "audit-duplicate-revoke"
      }),
      error => error.code === "already-exists"
    );
    assert.equal((await members.doc("member7").get()).data().status, "active");

    // Concurrent approval attempts against one pending nomination: one winner only.
    const raceApprovalAccountId = "race-approval-account";
    const raceApprovalMembers = db.collection(`accounts/${raceApprovalAccountId}/members`);
    const raceApprovalNominations = db.collection(`accounts/${raceApprovalAccountId}/adminNominations`);
    await Promise.all([
      raceApprovalMembers.doc("raceApprovalProposer").set({ uid: "raceApprovalProposer", accountId: raceApprovalAccountId, status: "active", role: "admin", scopeType: "account", scopeIds: [] }),
      raceApprovalMembers.doc("raceApprovalAdminA").set({ uid: "raceApprovalAdminA", accountId: raceApprovalAccountId, status: "active", role: "admin", scopeType: "account", scopeIds: [] }),
      raceApprovalMembers.doc("raceApprovalAdminB").set({ uid: "raceApprovalAdminB", accountId: raceApprovalAccountId, status: "active", role: "admin", scopeType: "account", scopeIds: [] })
    ]);
    await createAdminNomination({
      db, accountId: raceApprovalAccountId, actorUid: "raceApprovalProposer", actorIdentity: verifiedAdminIdentity("raceApprovalProposer", 800), nominationId: "race-approval",
      targetUid: "raceTarget", role: "member", scopeType: "department",
      scopeIds: ["dept1"], now: () => 800
    });
    const approvalRace = await Promise.allSettled([
      approveAdminNomination({ db, accountId: raceApprovalAccountId, actorUid: "raceApprovalAdminA", actorIdentity: verifiedAdminIdentity("raceApprovalAdminA", 900), nominationId: "race-approval", now: () => 900 }),
      approveAdminNomination({ db, accountId: raceApprovalAccountId, actorUid: "raceApprovalAdminB", actorIdentity: verifiedAdminIdentity("raceApprovalAdminB", 900), nominationId: "race-approval", now: () => 900 })
    ]);
    assert.equal(approvalRace.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(approvalRace.filter(result => result.status === "rejected").length, 1);
    assert.equal((await raceApprovalMembers.doc("raceTarget").get()).data().status, "active");
    assert.equal((await raceApprovalNominations.doc("race-approval").get()).data().status, "approved");
    await Promise.all([clear(raceApprovalMembers), clear(raceApprovalNominations)]);

    // Cancellation and approval racing on one nomination: exactly one transition wins.
    const raceCancelAccountId = "race-cancel-account";
    const raceCancelMembers = db.collection("accounts/" + raceCancelAccountId + "/members");
    const raceCancelNominations = db.collection("accounts/" + raceCancelAccountId + "/adminNominations");
    const raceCancelAudit = db.collection("accounts/" + raceCancelAccountId + "/membershipAudit");
    await Promise.all([
      raceCancelMembers.doc("raceCancelProposer").set({ uid: "raceCancelProposer", accountId: raceCancelAccountId, status: "active", role: "admin", scopeType: "account", scopeIds: [] }),
      raceCancelMembers.doc("raceCancelApprover").set({ uid: "raceCancelApprover", accountId: raceCancelAccountId, status: "active", role: "admin", scopeType: "account", scopeIds: [] })
    ]);
    await createAdminNomination({
      db, accountId: raceCancelAccountId, actorUid: "raceCancelProposer", actorIdentity: verifiedAdminIdentity("raceCancelProposer", 1000), nominationId: "race-cancel-approval",
      targetUid: "raceCancelTarget", role: "member", scopeType: "department", scopeIds: ["dept1"], now: () => 1000
    });
    const cancelApprovalRace = await Promise.allSettled([
      cancelAdminNomination({ db, accountId: raceCancelAccountId, actorUid: "raceCancelProposer", actorIdentity: verifiedAdminIdentity("raceCancelProposer", 1100), nominationId: "race-cancel-approval", eventId: "race-cancel-event", reason: "Synthetic concurrent cancellation", now: () => 1100 }),
      approveAdminNomination({ db, accountId: raceCancelAccountId, actorUid: "raceCancelApprover", actorIdentity: verifiedAdminIdentity("raceCancelApprover", 1100), nominationId: "race-cancel-approval", now: () => 1100 })
    ]);
    assert.equal(cancelApprovalRace.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(cancelApprovalRace.filter(result => result.status === "rejected").length, 1);
    const finalRaceNomination = (await raceCancelNominations.doc("race-cancel-approval").get()).data();
    assert.ok(["cancelled", "approved"].includes(finalRaceNomination.status));
    const raceCancelTarget = await raceCancelMembers.doc("raceCancelTarget").get();
    const raceCancelEvent = await raceCancelAudit.doc("race-cancel-event").get();
    if (finalRaceNomination.status === "cancelled") {
      assert.equal(raceCancelTarget.exists, false);
      assert.equal(raceCancelEvent.exists, true);
    } else {
      assert.equal(raceCancelTarget.data().status, "active");
      assert.equal(raceCancelEvent.exists, false);
    }
    await Promise.all([clear(raceCancelMembers), clear(raceCancelNominations), clear(raceCancelAudit)]);

    // Approval racing with revocation of the approving admin must never
    // authorize using a membership that has already been revoked.
    const raceApprovalRevocationAccountId = "race-approval-revocation-account";
    const raceApprovalRevocationMembers = db.collection(`accounts/${raceApprovalRevocationAccountId}/members`);
    const raceApprovalRevocationNominations = db.collection(`accounts/${raceApprovalRevocationAccountId}/adminNominations`);
    await Promise.all([
      raceApprovalRevocationMembers.doc("raceApprovalRevocationProposer").set({ uid: "raceApprovalRevocationProposer", accountId: raceApprovalRevocationAccountId, status: "active", role: "admin", scopeType: "account", scopeIds: [] }),
      raceApprovalRevocationMembers.doc("raceApprovalRevocationApprover").set({ uid: "raceApprovalRevocationApprover", accountId: raceApprovalRevocationAccountId, status: "active", role: "admin", scopeType: "account", scopeIds: [] })
    ]);
    await createAdminNomination({
      db, accountId: raceApprovalRevocationAccountId, actorUid: "raceApprovalRevocationProposer", actorIdentity: verifiedAdminIdentity("raceApprovalRevocationProposer", 1200), nominationId: "race-approval-revocation",
      targetUid: "raceApprovalRevocationTarget", role: "member", scopeType: "department", scopeIds: ["dept1"], now: () => 1200
    });
    const approvalRevocationRace = await Promise.allSettled([
      approveAdminNomination({ db, accountId: raceApprovalRevocationAccountId, actorUid: "raceApprovalRevocationApprover", actorIdentity: verifiedAdminIdentity("raceApprovalRevocationApprover", 1300), nominationId: "race-approval-revocation", now: () => 1300 }),
      revokeMembership({ db, accountId: raceApprovalRevocationAccountId, actorUid: "raceApprovalRevocationProposer", targetUid: "raceApprovalRevocationApprover", eventId: "race-approval-revoke-event", now: () => 1300 })
    ]);
    assert.equal(approvalRevocationRace[1].status, "fulfilled");
    const approvalRevocationNomination = (await raceApprovalRevocationNominations.doc("race-approval-revocation").get()).data();
    const approvalRevocationTarget = await raceApprovalRevocationMembers.doc("raceApprovalRevocationTarget").get();
    assert.equal((await raceApprovalRevocationMembers.doc("raceApprovalRevocationApprover").get()).data().status, "revoked");
    if (approvalRevocationRace[0].status === "fulfilled") {
      assert.equal(approvalRevocationNomination.status, "approved");
      assert.equal(approvalRevocationTarget.data().status, "active");
    } else {
      assert.equal(approvalRevocationNomination.status, "pending");
      assert.equal(approvalRevocationTarget.exists, false);
      assert.equal(approvalRevocationRace[0].reason.code, "permission-denied");
    }
    await Promise.all([clear(raceApprovalRevocationMembers), clear(raceApprovalRevocationNominations), clear(db.collection(`accounts/${raceApprovalRevocationAccountId}/membershipAudit`))]);

    // A nomination cannot be approved after its proposer has been revoked.
    const revokedProposerAccountId = "revoked-proposer-account";
    const revokedProposerMembers = db.collection(`accounts/${revokedProposerAccountId}/members`);
    const revokedProposerNominations = db.collection(`accounts/${revokedProposerAccountId}/adminNominations`);
    await Promise.all([
      revokedProposerMembers.doc("revokedProposer").set({ uid: "revokedProposer", accountId: revokedProposerAccountId, status: "active", role: "admin", scopeType: "account", scopeIds: [] }),
      revokedProposerMembers.doc("revokedProposerApprover").set({ uid: "revokedProposerApprover", accountId: revokedProposerAccountId, status: "active", role: "admin", scopeType: "account", scopeIds: [] }),
      revokedProposerMembers.doc("revokedProposerRevoker").set({ uid: "revokedProposerRevoker", accountId: revokedProposerAccountId, status: "active", role: "admin", scopeType: "account", scopeIds: [] })
    ]);
    await createAdminNomination({
      db, accountId: revokedProposerAccountId, actorUid: "revokedProposer",
      actorIdentity: verifiedAdminIdentity("revokedProposer", 1400), nominationId: "revoked-proposer-nomination",
      targetUid: "revokedProposerTarget", role: "member", scopeType: "department", scopeIds: ["dept1"], now: () => 1400
    });
    await revokeMembership({
      db, accountId: revokedProposerAccountId, actorUid: "revokedProposerRevoker",
      targetUid: "revokedProposer", eventId: "revoked-proposer-event", now: () => 1450
    });
    await assert.rejects(
      approveAdminNomination({
        db, accountId: revokedProposerAccountId, actorUid: "revokedProposerApprover",
        actorIdentity: verifiedAdminIdentity("revokedProposerApprover", 1500),
        nominationId: "revoked-proposer-nomination", now: () => 1500
      }),
      error => error.code === "failed-precondition"
    );
    assert.equal((await revokedProposerNominations.doc("revoked-proposer-nomination").get()).data().status, "pending");
    assert.equal((await revokedProposerMembers.doc("revokedProposerTarget").get()).exists, false);
    await Promise.all([
      clear(revokedProposerMembers), clear(revokedProposerNominations),
      clear(db.collection(`accounts/${revokedProposerAccountId}/membershipAudit`))
    ]);

    // Concurrent mutual admin revocations must not leave the account without an admin.
    const raceAccountId = "race-account";
    const raceMembers = db.collection(`accounts/${raceAccountId}/members`);
    const raceAudit = db.collection(`accounts/${raceAccountId}/membershipAudit`);
    await Promise.all([
      raceMembers.doc("raceAdminA").set({ uid: "raceAdminA", accountId: raceAccountId, status: "active", role: "admin", scopeType: "account", scopeIds: [] }),
      raceMembers.doc("raceAdminB").set({ uid: "raceAdminB", accountId: raceAccountId, status: "active", role: "admin", scopeType: "account", scopeIds: [] })
    ]);
    const revocationRace = await Promise.allSettled([
      revokeMembership({ db, accountId: raceAccountId, actorUid: "raceAdminA", targetUid: "raceAdminB", eventId: "race-revoke-a", now: () => 1000 }),
      revokeMembership({ db, accountId: raceAccountId, actorUid: "raceAdminB", targetUid: "raceAdminA", eventId: "race-revoke-b", now: () => 1000 })
    ]);
    assert.equal(revocationRace.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(revocationRace.filter(result => result.status === "rejected").length, 1);
    const remainingRaceAdmins = await raceMembers.where("role", "==", "admin").where("status", "==", "active").get();
    assert.equal(remainingRaceAdmins.docs.length, 1);
    await Promise.all([clear(raceMembers), clear(raceAudit)]);
  } finally {
    await Promise.all([clear(members), clear(nominations), clear(audit)]);
    await deleteApp(app);
  }
});
