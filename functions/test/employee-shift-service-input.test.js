import test from "node:test";
import assert from "node:assert/strict";
import { createEmployeeShiftService } from "../src/membership/employee-shift-service.js";

test("Employee shift service rejects unknown update fields before Firestore access", async () => {
  let docCalls = 0;
  let transactionCalls = 0;
  let authorizationCalls = 0;
  const db = {
    doc() { docCalls++; return {}; },
    runTransaction() { transactionCalls++; throw new Error("transaction must not start"); }
  };
  const service = createEmployeeShiftService({
    db,
    authorizeActor: async () => { authorizationCalls++; throw new Error("authorization must not run"); },
    loadPlacementAt: async () => null
  });

  await assert.rejects(
    service.update({
      accountId: "account-1",
      actorUid: "member-1",
      actorIdentity: { uid: "member-1" },
      shiftId: "shift-1",
      eventId: "event-1",
      expectedRevision: 1,
      changes: { hours: 8, employeeId: "other-employee" }
    }),
    error => error.code === "invalid-argument"
  );
  await assert.rejects(
    service.update({
      accountId: "account-1",
      actorUid: "member-1",
      actorIdentity: { uid: "member-1" },
      shiftId: "shift-1",
      eventId: "event-2",
      expectedRevision: 1,
      changes: { date: "2026-06-02" }
    }),
    error => error.code === "invalid-argument"
  );

  assert.equal(docCalls, 0);
  assert.equal(transactionCalls, 0);
  assert.equal(authorizationCalls, 0);
});

test("Employee shift service rejects unknown create fields before Firestore access", async () => {
  let docCalls = 0;
  let transactionCalls = 0;
  const db = {
    doc() { docCalls++; return {}; },
    runTransaction() { transactionCalls++; throw new Error("transaction must not start"); }
  };
  const service = createEmployeeShiftService({
    db,
    authorizeActor: async () => { throw new Error("authorization must not run"); },
    loadPlacementAt: async () => null
  });

  await assert.rejects(
    service.create({
      accountId: "account-1",
      actorUid: "member-1",
      actorIdentity: { uid: "member-1" },
      shiftId: "shift-1",
      eventId: "event-1",
      data: { date: "2026-06-02", type: "turno", employeeId: "other-employee" }
    }),
    error => error.code === "invalid-argument"
  );
  assert.equal(docCalls, 0);
  assert.equal(transactionCalls, 0);
});
