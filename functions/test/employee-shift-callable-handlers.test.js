import test from "node:test";
import assert from "node:assert/strict";
import { createEmployeeShiftCallableHandlers } from "../src/membership/employee-shift-callable-handlers.js";

test("Direct employee shift mutations are disabled pending personal approval workflow", async () => {
  const handlers = createEmployeeShiftCallableHandlers({
    db: { doc: () => ({}) },
    verifyToken: async () => { throw new Error("Must not verify identity for disabled mutation endpoint."); }
  });
  for (const operation of ["create", "update", "delete"]) {
    await assert.rejects(handlers[operation]({ data: {} }), error => error.code === "failed-precondition");
  }
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
