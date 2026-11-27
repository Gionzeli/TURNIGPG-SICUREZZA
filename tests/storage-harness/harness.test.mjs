import test from "node:test";
import assert from "node:assert/strict";
import { FirestoreModel, PostgresModel, bind, assertStateInvariants } from "./harness.mjs";

const adapters = [
  ["Firestore optimistic-transaction model", () => new FirestoreModel()],
  ["PostgreSQL serializable-transaction model", () => new PostgresModel()]
];

for (const [name, make] of adapters) {
  test(`${name}: concurrent one-UID-to-two-Employees keeps one active binding`, async () => {
    const db = make();
    const results = await Promise.allSettled([
      bind(db, { accountId: "acct-a", uid: "uid-1", employeeId: "emp-1" }),
      bind(db, { accountId: "acct-a", uid: "uid-1", employeeId: "emp-2" })
    ]);
    assert.equal(results.filter(x => x.status === "fulfilled" && x.value === "created").length, 1);
    assert.equal(db.snapshot().bindings.filter(x => x.status === "active").length, 1);
    assertStateInvariants(db.snapshot());
  });

  test(`${name}: concurrent two-UIDs-to-one-Employee keeps one active binding`, async () => {
    const db = make();
    const results = await Promise.allSettled([
      bind(db, { accountId: "acct-a", uid: "uid-1", employeeId: "emp-1" }),
      bind(db, { accountId: "acct-a", uid: "uid-2", employeeId: "emp-1" })
    ]);
    assert.equal(results.filter(x => x.status === "fulfilled" && x.value === "created").length, 1);
    assert.equal(db.snapshot().bindings.filter(x => x.status === "active").length, 1);
    assertStateInvariants(db.snapshot());
  });

  test(`${name}: exact retry is idempotent; conflicting reuse is denied`, async () => {
    const db = make();
    const command = { accountId: "acct-a", uid: "uid-1", employeeId: "emp-1" };
    assert.equal(await bind(db, command), "created");
    assert.equal(await bind(db, command), "idempotent");
    await assert.rejects(bind(db, { ...command, employeeId: "emp-2" }), { code: "conflict" });
    assert.equal(db.snapshot().bindings.length, 1);
    assert.equal(db.snapshot().audit.length, 1);
  });

  test(`${name}: account boundary permits same UID/Employee keys in another account`, async () => {
    const db = make();
    await bind(db, { accountId: "acct-a", uid: "uid-1", employeeId: "emp-1" });
    await bind(db, { accountId: "acct-b", uid: "uid-1", employeeId: "emp-1" });
    assert.equal(db.snapshot().bindings.length, 2);
    assertStateInvariants(db.snapshot());
  });

  test(`${name}: audit failure rolls back the binding mutation`, async () => {
    const db = make();
    await assert.rejects(bind(db, {
      accountId: "acct-a", uid: "uid-1", employeeId: "emp-1", auditFailure: true
    }), { code: "audit-failed" });
    assert.deepEqual(db.snapshot().bindings, []);
    assert.deepEqual(db.snapshot().audit, []);
  });
}
