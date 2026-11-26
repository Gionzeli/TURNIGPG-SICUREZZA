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
  const destinationSiteId = "synthetic-site-b", thirdSiteId = "synthetic-site-c", departmentId = "synthetic-department";
  const account = db.doc(`accounts/${accountId}`);
  const source = db.doc(`accounts/${accountId}/sites/${sourceSiteId}`);
  const destination = db.doc(`accounts/${accountId}/sites/${destinationSiteId}`);
  const thirdSite = db.doc(`accounts/${accountId}/sites/${thirdSiteId}`);
  const department = db.doc(`accounts/${accountId}/departments/${departmentId}`);
  const audit = db.collection(`accounts/${accountId}/organizationAudit`);
  const loaders = createOrganizationFirestoreLoaders(db);
  const member = db.doc(`accounts/${accountId}/members/synthetic-admin`);
  try {
    await Promise.all([
      account.set({ accountId, status: "active", schemaVersion: 1, version: 1 }),
      member.set({ uid: "synthetic-admin", accountId, status: "active", validFrom: new Date(0), validUntil: null, role: "admin", scopeType: "account", scopeIds: [] }),
      source.set({ accountId, siteId: sourceSiteId, status: "active", version: 1 }),
      destination.set({ accountId, siteId: destinationSiteId, status: "active", version: 1 }),
      thirdSite.set({ accountId, siteId: thirdSiteId, status: "active", version: 1 }),
      department.set({ accountId, departmentId, siteId: sourceSiteId, status: "active", version: 1 })
    ]);
    assert.equal((await loaders.loadDepartment(accountId, sourceSiteId, departmentId)).departmentId, departmentId);
    assert.equal(await loaders.loadDepartment(accountId, destinationSiteId, departmentId), null);
    await account.set({ accountId, status: "active", version: 1 });
    assert.equal(await loaders.loadDepartment(accountId, sourceSiteId, departmentId), null);
    await account.set({ accountId, status: "active", schemaVersion: 1, version: 1 });
    const moved = await transferDepartment({
      db, accountId, departmentId, sourceSiteId, destinationSiteId,
      expectedVersion: 1, actorUid: "synthetic-admin", reasonCode: "org-transfer",
      now: () => 123456789
    });
    assert.equal(moved.version, 2);
    assert.equal((await loaders.loadDepartment(accountId, sourceSiteId, departmentId)), null);
    assert.equal((await loaders.loadDepartment(accountId, destinationSiteId, departmentId)).departmentId, departmentId);
    const event = await audit.doc(moved.auditEventId).get();
    assert.equal(event.data().action, "department.transferred");
    assert.equal(event.data().previousVersion, 1);
    await member.update({ role: "manager", scopeType: "site", scopeIds: [sourceSiteId] });
    await assert.rejects(transferDepartment({
      db, accountId, departmentId, sourceSiteId: destinationSiteId,
      destinationSiteId: sourceSiteId, expectedVersion: 2, actorUid: "synthetic-admin",
      reasonCode: "manager-out-of-scope", now: () => 123456790
    }), error => error.code === "permission-denied");
    await member.update({ role: "admin", scopeType: "account", scopeIds: [] });
    await assert.rejects(transferDepartment({
      db, accountId, departmentId, sourceSiteId: destinationSiteId,
      destinationSiteId: sourceSiteId, expectedVersion: 1, actorUid: "synthetic-admin",
      reasonCode: "stale-replay", now: () => 123456790
    }), error => error.code === "failed-precondition");
    const competing = await Promise.allSettled([
      transferDepartment({
        db, accountId, departmentId, sourceSiteId: destinationSiteId,
        destinationSiteId: sourceSiteId, expectedVersion: 2, actorUid: "synthetic-admin",
        reasonCode: "race-transfer-a", now: () => 123456791
      }),
      transferDepartment({
        db, accountId, departmentId, sourceSiteId: destinationSiteId,
        destinationSiteId: thirdSiteId, expectedVersion: 2, actorUid: "synthetic-admin",
        reasonCode: "race-transfer-b", now: () => 123456792
      })
    ]);
    assert.equal(competing.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(competing.filter(result => result.status === "rejected").length, 1);
    const current = (await department.get()).data();
    assert.equal(current.version, 3);
    const unusedSiteId = current.siteId === sourceSiteId ? thirdSiteId : sourceSiteId;
    const unusedSite = unusedSiteId === thirdSiteId ? thirdSite : source;
    await unusedSite.update({ status: "archived" });
    assert.equal(await loaders.loadSite(accountId, unusedSiteId), null);
    await assert.rejects(transferDepartment({
      db, accountId, departmentId, sourceSiteId: current.siteId,
      destinationSiteId: unusedSiteId, expectedVersion: 3, actorUid: "synthetic-admin",
      reasonCode: "archived-destination", now: () => 123456793
    }), error => error.code === "failed-precondition");
  } finally {
    const events = await audit.get();
    await Promise.all(events.docs.map(doc => doc.ref.delete()));
    await Promise.all([account.delete(), source.delete(), destination.delete(), thirdSite.delete(), department.delete(), member.delete()]);
    await deleteApp(app);
  }
});


test("Firestore Emulator: organization create/archive generates IDs and enforces active dependencies", { skip: !enabled }, async () => {
  const app = initializeApp({ projectId: "demo-dsm-membership" }, "organization-mutations-service");
  const db = getFirestore(app);
  const accountId = "synthetic-org-mutation-account";
  const account = db.doc(`accounts/${accountId}`);
  const members = db.collection(`accounts/${accountId}/members`);
  const sites = db.collection(`accounts/${accountId}/sites`);
  const departments = db.collection(`accounts/${accountId}/departments`);
  const audits = db.collection(`accounts/${accountId}/organizationAudit`);
  const employeePlacements = db.collection(`accounts/${accountId}/employees/employee-1/placements`);
  const { createSite, createDepartment, archiveDepartment, archiveSite } =
    await import("../src/membership/organization-mutation-service.js");
  try {
    await Promise.all([
      account.set({ accountId, status: "active", schemaVersion: 1, version: 1 }),
      members.doc("synthetic-admin").set({
        uid: "synthetic-admin", accountId, status: "active", validFrom: new Date(0),
        validUntil: null, role: "admin", scopeType: "account", scopeIds: []
      })
    ]);
    const createdSite = await createSite({
      db, accountId, actorUid: "synthetic-admin", displayName: "Synthetic site",
      reasonCode: "initial-setup", now: () => 1000
    });
    assert.match(createdSite.siteId, /^[A-Za-z0-9_-]{20}$/);
    const siteDoc = await sites.doc(createdSite.siteId).get();
    assert.equal(siteDoc.data().status, "active");
    assert.equal(siteDoc.data().version, 1);
    const createdDepartment = await createDepartment({
      db, accountId, actorUid: "synthetic-admin", siteId: createdSite.siteId,
      displayName: "Synthetic department", reasonCode: "initial-setup", now: () => 1100
    });
    assert.match(createdDepartment.departmentId, /^[A-Za-z0-9_-]{20}$/);
    assert.notEqual(createdDepartment.departmentId, "client-selected-id");
    await assert.rejects(archiveSite({
      db, accountId, actorUid: "synthetic-admin", siteId: createdSite.siteId,
      reasonCode: "site-close", now: () => 1200
    }), error => error.code === "failed-precondition");

    await employeePlacements.doc("placement-current").set({
      accountId, employeeId: "employee-1", placementId: "placement-current",
      siteId: createdSite.siteId, departmentId: createdDepartment.departmentId,
      validFrom: "2026-01-01", validUntil: null, revision: 1
    });
    await assert.rejects(archiveDepartment({
      db, accountId, actorUid: "synthetic-admin", departmentId: createdDepartment.departmentId,
      reasonCode: "dept-close", now: () => 1300
    }), error => error.code === "failed-precondition");
    await employeePlacements.doc("placement-current").delete();

    await members.doc("synthetic-member").set({
      uid: "synthetic-member", accountId, status: "active", validFrom: new Date(0),
      validUntil: null, role: "member", scopeType: "department", scopeIds: [createdDepartment.departmentId]
    });
    await assert.rejects(archiveDepartment({
      db, accountId, actorUid: "synthetic-admin", departmentId: createdDepartment.departmentId,
      reasonCode: "dept-close", now: () => 1400
    }), error => error.code === "failed-precondition");
    await members.doc("synthetic-member").update({ status: "revoked" });
    const archivedDepartment = await archiveDepartment({
      db, accountId, actorUid: "synthetic-admin", departmentId: createdDepartment.departmentId,
      reasonCode: "dept-close", now: () => 1500
    });
    assert.equal(archivedDepartment.status, "archived");

    await members.doc("synthetic-manager").set({
      uid: "synthetic-manager", accountId, status: "active", validFrom: new Date(0),
      validUntil: null, role: "manager", scopeType: "site", scopeIds: [createdSite.siteId]
    });
    await assert.rejects(archiveSite({
      db, accountId, actorUid: "synthetic-admin", siteId: createdSite.siteId,
      reasonCode: "site-close", now: () => 1600
    }), error => error.code === "failed-precondition");
    await members.doc("synthetic-manager").update({ status: "revoked" });
    const archivedSite = await archiveSite({
      db, accountId, actorUid: "synthetic-admin", siteId: createdSite.siteId,
      reasonCode: "site-close", now: () => 1700
    });
    assert.equal(archivedSite.status, "archived");
    const auditActions = (await audits.get()).docs.map(doc => doc.data().action).sort();
    assert.deepEqual(auditActions, [
      "department.archived", "department.created", "site.archived", "site.created"
    ]);
  } finally {
    const [auditDocs, departmentDocs, siteDocs, placementDocs, memberDocs] = await Promise.all([
      audits.get(), departments.get(), sites.get(), employeePlacements.get(), members.get()
    ]);
    await Promise.all([
      ...auditDocs.docs, ...departmentDocs.docs, ...siteDocs.docs,
      ...placementDocs.docs, ...memberDocs.docs
    ].map(doc => doc.ref.delete()));
    await account.delete();
    await deleteApp(app);
  }
});
