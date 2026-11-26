import test from "node:test";
import assert from "node:assert/strict";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createOrganizationFirestoreLoaders } from "../src/membership/organization-firestore-loaders.js";
import { transferDepartment } from "../src/membership/department-transfer-service.js";

const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
test("Firestore Emulator: canonical organization lifecycle and department transfer are fail-closed and atomic", { skip: !enabled }, async () => {
  const app = initializeApp({ projectId: "demo-dsm-membership" }, "organization-schema-service");
  const db = getFirestore(app);
  const accountId = "synthetic-org-account", sourceSiteId = "synthetic-site-a";
  const destinationSiteId = "synthetic-site-b", departmentId = "synthetic-department";
  const account = db.doc(`accounts/${accountId}`);
  const source = db.doc(`accounts/${accountId}/sites/${sourceSiteId}`);
  const destination = db.doc(`accounts/${accountId}/sites/${destinationSiteId}`);
  const department = db.doc(`accounts/${accountId}/departments/${departmentId}`);
  const audit = db.collection(`accounts/${accountId}/organizationAudit`);
  const loaders = createOrganizationFirestoreLoaders(db);
  const authorizeActor = async (_tx, args) => {
    assert.equal(args.actorUid, "synthetic-admin");
    assert.equal(args.permission, "dsm:transfer:departments");
    assert.equal(args.sourceSiteId, sourceSiteId);
    assert.equal(args.destinationSiteId, destinationSiteId);
  };
  try {
    await Promise.all([
      account.set({ accountId, status: "active", schemaVersion: 1, version: 1 }),
      source.set({ accountId, siteId: sourceSiteId, status: "active", version: 1 }),
      destination.set({ accountId, siteId: destinationSiteId, status: "active", version: 1 }),
      department.set({ accountId, departmentId, siteId: sourceSiteId, status: "active", version: 1 })
    ]);
    assert.equal((await loaders.loadDepartment(accountId, sourceSiteId, departmentId)).departmentId, departmentId);
    assert.equal(await loaders.loadDepartment(accountId, destinationSiteId, departmentId), null);
    const moved = await transferDepartment({
      db, accountId, departmentId, sourceSiteId, destinationSiteId,
      expectedVersion: 1, actorUid: "synthetic-admin", reasonCode: "org-transfer",
      now: () => 123456789, authorizeActor
    });
    assert.equal(moved.version, 2);
    assert.equal((await loaders.loadDepartment(accountId, sourceSiteId, departmentId)), null);
    assert.equal((await loaders.loadDepartment(accountId, destinationSiteId, departmentId)).departmentId, departmentId);
    const event = await audit.doc(moved.auditEventId).get();
    assert.equal(event.data().action, "department.transferred");
    assert.equal(event.data().previousVersion, 1);
    await assert.rejects(transferDepartment({
      db, accountId, departmentId, sourceSiteId: destinationSiteId,
      destinationSiteId: sourceSiteId, expectedVersion: 1, actorUid: "synthetic-admin",
      reasonCode: "stale-replay", now: () => 123456790, authorizeActor
    }), error => error.code === "failed-precondition");
    await destination.update({ status: "archived" });
    assert.equal(await loaders.loadSite(accountId, destinationSiteId), null);
    await assert.rejects(transferDepartment({
      db, accountId, departmentId, sourceSiteId: destinationSiteId,
      destinationSiteId: sourceSiteId, expectedVersion: 2, actorUid: "synthetic-admin",
      reasonCode: "archived-source", now: () => 123456791, authorizeActor
    }), error => error.code === "failed-precondition");
  } finally {
    const events = await audit.get();
    await Promise.all(events.docs.map(doc => doc.ref.delete()));
    await Promise.all([account.delete(), source.delete(), destination.delete(), department.delete()]);
    await deleteApp(app);
  }
});
