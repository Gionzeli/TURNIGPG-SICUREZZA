import test from "node:test";
import assert from "node:assert/strict";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createManagerAbsenceAvailabilityService } from "../src/membership/employee-absence-availability-service.js";
const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
test("Firestore Emulator: manager absence view returns date availability only and filters out-of-scope placements", { skip: !enabled }, async () => {
  const app = initializeApp({ projectId: "demo-dsm-membership" }, "employee-absence-availability");
  const db = getFirestore(app), accountId = "synthetic-absence-account", employeeId = "employee-1";
  const account = db.doc("accounts/" + accountId);
  const records = db.collection("accounts/" + accountId + "/employeeAbsences");
  const audit = db.collection("accounts/" + accountId + "/employeeAudit");
  let authorizationMode = "allow";
  const service = createManagerAbsenceAvailabilityService({
    db, now: () => 5000,
    authorizeManagerAvailability: async (_tx, args) => {
      assert.equal(args.permission, "absence:read:availability");
      assert.equal(args.operation, "read-availability");
      assert.equal(args.actorUid, "manager-1");
      if (authorizationMode === "deny") return { employeeId, placementIds: [] };
      if (authorizationMode === "wrong-employee") return { employeeId: "another-employee", placementIds: ["placement-in-scope"] };
      return { employeeId, placementIds: ["placement-in-scope"] };
    }
  });
  try {
    await account.set({ accountId, status: "active" });
    authorizationMode = "deny";
    await assert.rejects(service.read({ accountId, actorUid: "manager-1", actorIdentity: { uid: "manager-1" }, employeeId, startDate: "2026-02-01", endDate: "2026-02-02", eventId: "denied-1" }), e => e.code === "permission-denied");
    assert.equal((await audit.doc("absence-availability-denied-1").get()).exists, false);
    authorizationMode = "wrong-employee";
    await assert.rejects(service.read({ accountId, actorUid: "manager-1", actorIdentity: { uid: "manager-1" }, employeeId, startDate: "2026-02-01", endDate: "2026-02-02", eventId: "wrong-employee-1" }), e => e.code === "permission-denied");
    assert.equal((await audit.doc("absence-availability-wrong-employee-1").get()).exists, false);
    authorizationMode = "allow";
    await Promise.all([
      records.doc("absence-health").set({ accountId, employeeId, placementId: "placement-in-scope", status: "active", kind: "malattia", startDate: "2026-02-01", endDate: "2026-02-03", reason: "synthetic-diagnosis", notes: "synthetic-private-note", documentPath: "private/medical.pdf" }),
      records.doc("absence-vacation").set({ accountId, employeeId, placementId: "placement-in-scope", status: "active", kind: "ferie", startDate: "2026-02-05", endDate: "2026-02-07" }),
      records.doc("absence-outside").set({ accountId, employeeId, placementId: "placement-out-of-scope", status: "active", kind: "permesso", startDate: "2026-02-02", endDate: "2026-02-04" })
    ]);
    const result = await service.read({ accountId, actorUid: "manager-1", actorIdentity: { uid: "manager-1" }, employeeId, startDate: "2026-02-02", endDate: "2026-02-06", eventId: "read-1" });
    assert.deepEqual(result.availability, [
      { unavailable: true, startDate: "2026-02-02", endDate: "2026-02-03" },
      { unavailable: true, startDate: "2026-02-05", endDate: "2026-02-06" }
    ]);
    const serialized = JSON.stringify(result);
    for (const secret of ["malattia", "ferie", "permesso", "synthetic-diagnosis", "synthetic-private-note", "medical.pdf", "placement-in-scope"]) assert.equal(serialized.includes(secret), false);
    const auditSnap = (await audit.doc("absence-availability-read-1").get()).data();
    assert.equal(auditSnap.type, "employee.absence.availability.read");
    assert.equal(JSON.stringify(auditSnap).includes("malattia"), false);
    assert.equal(JSON.stringify(auditSnap).includes("synthetic-diagnosis"), false);
    await assert.rejects(service.read({ accountId, actorUid: "manager-1", actorIdentity: { uid: "manager-1" }, employeeId, startDate: "2026-02-02", endDate: "2026-02-06", eventId: "read-1" }), e => e.code === "already-exists");
  } finally {
    const snapshots = await Promise.all([records.get(), audit.get()]);
    await Promise.all(snapshots.flatMap(s => s.docs.map(d => d.ref.delete())));
    await account.delete();
    await deleteApp(app);
  }
});
