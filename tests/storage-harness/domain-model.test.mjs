import test from "node:test";
import assert from "node:assert/strict";
import {
  createDomainFixture, addPlacement, placementAt, addHistoricalShift,
  transferEmployee, revokeBinding, authorizeNewOperation, payrollView, managerAbsenceView,
  authorizeManagerShift, writePayrollRecord, exportPayroll, managerAbsenceReport
} from "./domain-model.mjs";

function placedFixture() {
  const s = createDomainFixture();
  addPlacement(s, { accountId:"acct-a", employeeId:"emp-1", siteId:"site-1", departmentId:"dept-1", start:"2026-01-01" });
  return s;
}

test("placement intervals are half-open, non-overlapping, and transfers preserve history", () => {
  const s = placedFixture();
  const old = addHistoricalShift(s, { accountId:"acct-a", employeeId:"emp-1", shiftId:"shift-old", date:"2026-05-31" });
  transferEmployee(s, { accountId:"acct-a", employeeId:"emp-1", siteId:"site-2", departmentId:"dept-2", effectiveDate:"2026-06-01" });
  const next = addHistoricalShift(s, { accountId:"acct-a", employeeId:"emp-1", shiftId:"shift-new", date:"2026-06-01" });
  assert.equal(old.siteId, "site-1");
  assert.equal(next.siteId, "site-2");
  assert.equal(s.shifts[0].departmentId, "dept-1");
  assert.throws(() => addPlacement(s, {
    accountId:"acct-a", employeeId:"emp-1", siteId:"site-1", departmentId:"dept-1",
    start:"2026-05-01", end:"2026-07-01"
  }), { code:"placement-overlap" });
});

test("missing or ambiguous historical placement fails closed", () => {
  const s = createDomainFixture();
  assert.throws(() => placementAt(s, "acct-a", "emp-1", "2026-01-01"), { code:"placement-missing-or-ambiguous" });
  s.placements.push(
    { accountId:"acct-a", employeeId:"emp-1", siteId:"site-1", departmentId:"dept-1", start:"2026-01-01", end:null },
    { accountId:"acct-a", employeeId:"emp-1", siteId:"site-2", departmentId:"dept-2", start:"2026-01-01", end:null }
  );
  assert.throws(() => placementAt(s, "acct-a", "emp-1", "2026-02-01"), { code:"placement-missing-or-ambiguous" });
});

test("revocation blocks subsequent protected operations", () => {
  const s = placedFixture();
  const args = { accountId:"acct-a", uid:"uid-1", employeeId:"emp-1", siteId:"site-1", departmentId:"dept-1", date:"2026-02-01" };
  assert.equal(authorizeNewOperation(s, args), true);
  revokeBinding(s, "acct-a", "uid-1");
  assert.throws(() => authorizeNewOperation(s, args), { code:"permission-denied" });
  assert.equal(s.audit.at(-1).actor, "synthetic-server-actor");
});

test("inactive Employee or organization blocks new operations", () => {
  const s = placedFixture();
  s.employees[0].status = "suspended";
  assert.throws(() => authorizeNewOperation(s, {
    accountId:"acct-a", uid:"uid-1", employeeId:"emp-1", siteId:"site-1", departmentId:"dept-1", date:"2026-02-01"
  }), { code:"permission-denied" });
  s.employees[0].status = "active";
  s.org[0].status = "archived";
  assert.throws(() => authorizeNewOperation(s, {
    accountId:"acct-a", uid:"uid-1", employeeId:"emp-1", siteId:"site-1", departmentId:"dept-1", date:"2026-02-01"
  }), { code:"permission-denied" });
});

test("payroll is deny-by-default and requires the exact read permission", () => {
  const s = createDomainFixture();
  s.payroll.push({ accountId:"acct-a", employeeId:"emp-1", period:"2026-01", amount:123.45 });
  assert.throws(() => payrollView(s, { accountId:"acct-a", employeeId:"emp-1", permissions:["manager"] }), { code:"permission-denied" });
  assert.deepEqual(payrollView(s, { accountId:"acct-a", employeeId:"emp-1", permissions:["payroll:read"] }),
    [{ period:"2026-01", amount:123.45 }]);
});

test("manager absence view omits health category, reason, and notes", () => {
  const s = createDomainFixture();
  s.absences.push({ accountId:"acct-a", employeeId:"emp-1", start:"2026-02-01", end:"2026-02-03",
    kind:"malattia", reason:"synthetic-private-reason", notes:"synthetic-private-note" });
  const view = managerAbsenceView(s, { accountId:"acct-a", employeeId:"emp-1" });
  assert.deepEqual(view, [{ unavailable:true, start:"2026-02-01", end:"2026-02-03" }]);
  assert.equal(JSON.stringify(view).includes("malattia"), false);
  assert.equal(JSON.stringify(view).includes("synthetic-private"), false);
});

test("failed transfer leaves the existing placement interval unchanged", () => {
  const s = placedFixture();
  const before = structuredClone(s.placements);
  assert.throws(() => transferEmployee(s, {
    accountId:"acct-a", employeeId:"emp-1", siteId:"missing-site",
    departmentId:"missing-dept", effectiveDate:"2026-06-01"
  }), { code:"org-not-active" });
  assert.deepEqual(s.placements, before);
});

test("operation scope must match the Employee placement at the operation date", () => {
  const s = placedFixture();
  assert.throws(() => authorizeNewOperation(s, {
    accountId:"acct-a", uid:"uid-1", employeeId:"emp-1",
    siteId:"site-2", departmentId:"dept-2", date:"2026-03-01"
  }), { code:"permission-denied" });
  transferEmployee(s, {
    accountId:"acct-a", employeeId:"emp-1", siteId:"site-2",
    departmentId:"dept-2", effectiveDate:"2026-06-01"
  });
  assert.equal(authorizeNewOperation(s, {
    accountId:"acct-a", uid:"uid-1", employeeId:"emp-1",
    siteId:"site-1", departmentId:"dept-1", date:"2026-05-31"
  }), true);
  assert.equal(authorizeNewOperation(s, {
    accountId:"acct-a", uid:"uid-1", employeeId:"emp-1",
    siteId:"site-2", departmentId:"dept-2", date:"2026-06-01"
  }), true);
  assert.throws(() => authorizeNewOperation(s, {
    accountId:"acct-a", uid:"uid-1", employeeId:"emp-1",
    siteId:"site-1", departmentId:"dept-1", date:"2026-06-01"
  }), { code:"permission-denied" });
});


test("manager delegation is operation-specific and placement-scoped", () => {
  const s = placedFixture();
  s.delegations.push({ accountId:"acct-a", managerUid:"manager-1", employeeId:"emp-1",
    siteId:"site-1", departmentId:"dept-1", status:"active",
    permissions:["shift:read", "shift:update"] });
  const baseArgs = { accountId:"acct-a", managerUid:"manager-1", employeeId:"emp-1",
    siteId:"site-1", departmentId:"dept-1", date:"2026-02-01" };
  assert.equal(authorizeManagerShift(s, { ...baseArgs, operation:"read" }), true);
  assert.equal(authorizeManagerShift(s, { ...baseArgs, operation:"update" }), true);
  assert.throws(() => authorizeManagerShift(s, { ...baseArgs, operation:"delete" }), { code:"permission-denied" });
  assert.throws(() => authorizeManagerShift(s, { ...baseArgs, operation:"create", siteId:"site-2", departmentId:"dept-2" }), { code:"permission-denied" });
  assert.throws(() => authorizeManagerShift(s, { ...baseArgs, operation:"admin" }), { code:"permission-denied" });
  s.delegations[0].status = "revoked";
  assert.throws(() => authorizeManagerShift(s, { ...baseArgs, operation:"read" }), { code:"permission-denied" });
});

test("payroll write and export are separate explicit permissions and are audited", () => {
  const s = createDomainFixture();
  const baseArgs = { accountId:"acct-a", employeeId:"emp-1", recordId:"pay-1",
    period:"2026-01", amount:123.45, actorUid:"manager-1" };
  assert.throws(() => writePayrollRecord(s, { ...baseArgs, permissions:["payroll:read"] }), { code:"permission-denied" });
  assert.deepEqual(writePayrollRecord(s, { ...baseArgs, permissions:["payroll:write"] }),
    { period:"2026-01", amount:123.45 });
  assert.throws(() => exportPayroll(s, { accountId:"acct-a", employeeId:"emp-1",
    actorUid:"manager-1", permissions:["payroll:read"] }), { code:"permission-denied" });
  assert.deepEqual(exportPayroll(s, { accountId:"acct-a", employeeId:"emp-1",
    actorUid:"manager-1", permissions:["payroll:export"] }), [{ period:"2026-01", amount:123.45 }]);
  assert.deepEqual(s.audit.map(x => x.action), ["payroll-write", "payroll-export"]);
  assert.ok(s.audit.every(x => x.actorUid === "manager-1"));
});

test("absence reporting has no health-category filters, groupings, or derived category counts", () => {
  const s = createDomainFixture();
  s.absences.push(
    { accountId:"acct-a", employeeId:"emp-1", start:"2026-02-01", end:"2026-02-03",
      kind:"malattia", reason:"synthetic-diagnosis", notes:"synthetic-medical-note" },
    { accountId:"acct-a", employeeId:"emp-1", start:"2026-02-10", end:"2026-02-10",
      kind:"ferie", reason:"synthetic-holiday-reason" }
  );
  const report = managerAbsenceReport(s, { accountId:"acct-a", employeeId:"emp-1" });
  assert.deepEqual(report, [
    { unavailable:true, start:"2026-02-01", end:"2026-02-03" },
    { unavailable:true, start:"2026-02-10", end:"2026-02-10" }
  ]);
  const serialized = JSON.stringify(report);
  for (const forbidden of ["malattia", "ferie", "synthetic-diagnosis", "synthetic-medical-note", "kind", "reason", "count"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});
