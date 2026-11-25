import test from "node:test";
import assert from "node:assert/strict";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createAdminNomination, approveAdminNomination, cancelAdminNomination } from "../src/membership/nomination-service.js";
import { revokeMembership } from "../src/membership/revocation-service.js";

const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

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
      db, accountId, actorUid: "adminA", nominationId: "approve-1",
      targetUid: "manager1", role: "manager", scopeType: "site",
      scopeIds: ["site1"], now: () => 100
    });
    await approveAdminNomination({
      db, accountId, actorUid: "adminB", nominationId: "approve-1", now: () => 200
    });
    const approved = await nominations.doc("approve-1").get();
    const manager = await members.doc("manager1").get();
    assert.equal(approved.data().status, "approved");
    assert.equal(manager.data().status, "active");
    assert.equal(manager.data().approvedBy, "adminB");

    await createAdminNomination({
      db, accountId, actorUid: "adminA", nominationId: "cancel-1",
      targetUid: "member2", role: "member", scopeType: "department",
      scopeIds: ["dept1"], now: () => 300
    });
    await cancelAdminNomination({
      db, accountId, actorUid: "adminA", nominationId: "cancel-1",
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
  } finally {
    await Promise.all([clear(members), clear(nominations), clear(audit)]);
    await deleteApp(app);
  }
});
