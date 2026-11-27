import test from "node:test";
import assert from "node:assert/strict";
import { createEmployeeShiftCallableHandlers } from "../src/membership/employee-shift-callable-handlers.js";

test("Employee shift callables reject unknown selector and identity fields before token lookup", async () => {
  let verificationCalls = 0;
  const db = {
    doc: () => ({}),
    collection: () => ({ doc: () => ({ id: "synthetic-generated-id" }) })
  };
  const handlers = createEmployeeShiftCallableHandlers({
    db,
    verifyToken: async () => {
      verificationCalls++;
      return { uid: "synthetic-uid", email_verified: true };
    }
  });
  const request = data => ({
    rawRequest: { headers: { authorization: "Bearer synthetic-token" } },
    data
  });

  const invalidRequests = [
    () => handlers.listOwn(request({ accountId: "account-1", fromDate: "2026-06-01", toDate: "2026-06-30", employeeId: "other-employee" })),
    () => handlers.create(request({ accountId: "account-1", data: { date: "2026-06-01", type: "turno" }, employeeId: "other-employee" })),
    () => handlers.update(request({ accountId: "account-1", shiftId: "shift-1", expectedRevision: 1, changes: { hours: 8 }, ownerUid: "other-user" })),
    () => handlers.delete(request({ accountId: "account-1", shiftId: "shift-1", expectedRevision: 1, actorUid: "other-user" }))
  ];
  for (const invoke of invalidRequests) {
    await assert.rejects(invoke(), error => error.code === "invalid-argument");
  }
  assert.equal(verificationCalls, 0);
});

test("Employee shift list rejects malformed or reversed date ranges", async () => {
  let verificationCalls = 0;
  const db = {
    doc: () => ({}),
    collection: () => ({ doc: () => ({ id: "synthetic-generated-id" }) })
  };
  const handlers = createEmployeeShiftCallableHandlers({
    db,
    verifyToken: async () => {
      verificationCalls++;
      return { uid: "synthetic-uid", email_verified: true };
    }
  });
  const request = data => ({
    rawRequest: { headers: { authorization: "Bearer synthetic-token" } },
    data
  });

  for (const [fromDate, toDate] of [
    ["2026-02-30", "2026-03-01"],
    ["2026-06-10", "2026-06-01"],
    ["2026-6-01", "2026-06-30"]
  ]) {
    await assert.rejects(
      handlers.listOwn(request({ accountId: "account-1", fromDate, toDate })),
      error => error.code === "invalid-argument"
    );
  }
  assert.equal(verificationCalls, 3);
});
