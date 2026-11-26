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
  const args = { accountId:"acct-a", uid:"uid-1", employeeId:"emp-1", siteId:"site-1", departmentId:"dept-1", date:"2026-02-01", now:"2026-02-01T12:00:00Z" };
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
  assert.deepEqual(payrollView(s, { accountId:"acct-a", employeeId:"emp-1", actorUid:"employee-1", permissions:["payroll:read"] }),
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
    expiresAt:"2026-03-01T00:00:00Z", permissions:["shift:read", "shift:update"] });
  const baseArgs = { accountId:"acct-a", managerUid:"manager-1", employeeId:"emp-1",
    siteId:"site-1", departmentId:"dept-1", date:"2026-02-01", now:"2026-02-01T12:00:00Z" };
  assert.equal(authorizeManagerShift(s, { ...baseArgs, operation:"read" }), true);
  assert.equal(authorizeManagerShift(s, { ...baseArgs, operation:"update" }), true);
  assert.throws(() => authorizeManagerShift(s, { ...baseArgs, operation:"delete" }), { code:"permission-denied" });
  assert.throws(() => authorizeManagerShift(s, { ...baseArgs, operation:"create", siteId:"site-2", departmentId:"dept-2" }), { code:"permission-denied" });
  assert.throws(() => authorizeManagerShift(s, { ...baseArgs, operation:"admin" }), { code:"permission-denied" });
  s.delegations[0].status = "revoked";
  assert.throws(() => authorizeManagerShift(s, { ...baseArgs, operation:"read" }), { code:"permission-denied" });
});


test("manager shift access fails closed for inactive, missing, or ambiguous organization scope", () => {
  const args = { accountId:"acct-a", managerUid:"manager-1", employeeId:"emp-1",
    siteId:"site-1", departmentId:"dept-1", date:"2026-02-01", now:"2026-02-01T12:00:00Z", operation:"read" };
  for (const status of ["suspended", "archived", "unknown"]) {
    const s = placedFixture();
    s.delegations.push({ accountId:"acct-a", managerUid:"manager-1", employeeId:"emp-1",
      siteId:"site-1", departmentId:"dept-1", status:"active", expiresAt:"2026-03-01T00:00:00Z",
      permissions:["shift:read"] });
    s.org[0].status = status;
    assert.throws(() => authorizeManagerShift(s, args), { code:"permission-denied" });
  }
  const missing = placedFixture();
  missing.org = [];
  missing.delegations.push({ accountId:"acct-a", managerUid:"manager-1", employeeId:"emp-1",
    siteId:"site-1", departmentId:"dept-1", status:"active", expiresAt:"2026-03-01T00:00:00Z",
    permissions:["shift:read"] });
  assert.throws(() => authorizeManagerShift(missing, args), { code:"permission-denied" });
  const ambiguous = placedFixture();
  ambiguous.org.push({ ...ambiguous.org[0] });
  ambiguous.delegations.push({ accountId:"acct-a", managerUid:"manager-1", employeeId:"emp-1",
    siteId:"site-1", departmentId:"dept-1", status:"active", expiresAt:"2026-03-01T00:00:00Z",
    permissions:["shift:read"] });
  assert.throws(() => authorizeManagerShift(ambiguous, args), { code:"permission-denied" });
});

test("payroll write and export are separate explicit permissions and are audited", () => {
  const s = createDomainFixture();
  const baseArgs = { accountId:"acct-a", employeeId:"emp-1", recordId:"pay-1",
    period:"2026-01", amount:123.45, actorUid:"manager-1" };
  assert.throws(() => writePayrollRecord(s, { ...baseArgs, permissions:["payroll:read"] }), { code:"permission-denied" });
  assert.throws(() => writePayrollRecord(s, { ...baseArgs, permissions:["payroll:write"], authorizedEmployeeIds:["emp-2"] }), { code:"permission-denied" });
  assert.deepEqual(writePayrollRecord(s, { ...baseArgs, permissions:["payroll:write"], authorizedEmployeeIds:["emp-1"] }),
    { period:"2026-01", amount:123.45 });
  assert.throws(() => exportPayroll(s, { accountId:"acct-a", employeeId:"emp-1",
    actorUid:"manager-1", permissions:["payroll:read"], authorizedEmployeeIds:["emp-1"] }), { code:"permission-denied" });
  assert.throws(() => exportPayroll(s, { accountId:"acct-a", employeeId:"emp-1",
    actorUid:"manager-1", permissions:["payroll:export"], authorizedEmployeeIds:["emp-2"] }), { code:"permission-denied" });
  assert.deepEqual(exportPayroll(s, { accountId:"acct-a", employeeId:"emp-1",
    actorUid:"manager-1", permissions:["payroll:export"], authorizedEmployeeIds:["emp-1"] }), [{ period:"2026-01", amount:123.45 }]);
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


test("account and Employee isolation deny cross-tenant and cross-Employee manager access", () => {
  const s = placedFixture();
  s.accounts.push({ accountId:"acct-b", status:"active" });
  s.employees.push({ accountId:"acct-b", employeeId:"emp-1", status:"active" });
  s.org.push({ accountId:"acct-b", siteId:"site-1", departmentId:"dept-1", status:"active",
    siteStatus:"active", departmentStatus:"active" });
  addPlacement(s, { accountId:"acct-b", employeeId:"emp-1", siteId:"site-1", departmentId:"dept-1", start:"2026-01-01" });
  s.delegations.push({ accountId:"acct-a", managerUid:"manager-a", employeeId:"emp-1",
    siteId:"site-1", departmentId:"dept-1", status:"active", expiresAt:"2027-01-01T00:00:00Z", permissions:["shift:read"] });
  assert.equal(authorizeManagerShift(s, { accountId:"acct-a", managerUid:"manager-a", employeeId:"emp-1",
    siteId:"site-1", departmentId:"dept-1", date:"2026-02-01", operation:"read", now:"2026-02-01T12:00:00Z" }), true);
  assert.throws(() => authorizeManagerShift(s, { accountId:"acct-b", managerUid:"manager-a", employeeId:"emp-1",
    siteId:"site-1", departmentId:"dept-1", date:"2026-02-01", operation:"read", now:"2026-02-01T12:00:00Z" }), { code:"permission-denied" });
  assert.throws(() => authorizeManagerShift(s, { accountId:"acct-a", managerUid:"manager-a", employeeId:"emp-2",
    siteId:"site-1", departmentId:"dept-1", date:"2026-02-01", operation:"read", now:"2026-02-01T12:00:00Z" }), { code:"permission-denied" });
});

test("payroll authorization requires both exact permission and explicit Employee scope", () => {
  const s = createDomainFixture();
  s.employees.push({ accountId:"acct-a", employeeId:"emp-2", status:"active" });
  s.payroll.push(
    { accountId:"acct-a", employeeId:"emp-1", period:"2026-01", amount:100 },
    { accountId:"acct-a", employeeId:"emp-2", period:"2026-01", amount:200 },
    { accountId:"acct-b", employeeId:"emp-1", period:"2026-01", amount:300 }
  );
  assert.deepEqual(payrollView(s, { accountId:"acct-a", employeeId:"emp-1", actorUid:"employee-1", permissions:["payroll:read"] }),
    [{ period:"2026-01", amount:100 }]);
  assert.throws(() => writePayrollRecord(s, { accountId:"acct-a", employeeId:"emp-2",
    recordId:"pay-2", period:"2026-02", amount:222, actorUid:"manager-a",
    permissions:["payroll:write"], authorizedEmployeeIds:["emp-1"] }), { code:"permission-denied" });
  assert.throws(() => exportPayroll(s, { accountId:"acct-a", employeeId:"emp-2",
    actorUid:"manager-a", permissions:["payroll:export"], authorizedEmployeeIds:["emp-1"] }), { code:"permission-denied" });
  assert.deepEqual(exportPayroll(s, { accountId:"acct-a", employeeId:"emp-1",
    actorUid:"manager-a", permissions:["payroll:export"], authorizedEmployeeIds:["emp-1"] }),
    [{ period:"2026-01", amount:100 }]);
  assert.equal(s.audit.at(-1).accountId, "acct-a");
});

test("payroll write prepares audit before publishing data mutation", () => {
  const s = createDomainFixture();
  const before = structuredClone(s.payroll);
  s.audit = null;
  assert.throws(() => writePayrollRecord(s, { accountId:"acct-a", employeeId:"emp-1",
    recordId:"pay-1", period:"2026-01", amount:10, actorUid:"actor",
    permissions:["payroll:write"], authorizedEmployeeIds:["emp-1"] }));
  assert.deepEqual(s.payroll, before);
});


test("payroll read/write/export deny after Employee suspension or termination", () => {
  const s = createDomainFixture();
  s.payroll.push({ accountId:"acct-a", employeeId:"emp-1", recordId:"pay-1", period:"2026-01", amount:100 });
  const writeArgs = { accountId:"acct-a", employeeId:"emp-1", recordId:"pay-2",
    period:"2026-02", amount:120, actorUid:"manager-a", permissions:["payroll:write"],
    authorizedEmployeeIds:["emp-1"] };
  const exportArgs = { accountId:"acct-a", employeeId:"emp-1", actorUid:"manager-a",
    permissions:["payroll:export"], authorizedEmployeeIds:["emp-1"] };
  for (const status of ["suspended","terminated","archived","unknown"]) {
    s.employees[0].status=status;
    assert.throws(() => payrollView(s,{accountId:"acct-a",employeeId:"emp-1",actorUid:"employee-1",permissions:["payroll:read"]}),{code:"permission-denied"});
    assert.throws(() => writePayrollRecord(s,writeArgs),{code:"permission-denied"});
    assert.throws(() => exportPayroll(s,exportArgs),{code:"permission-denied"});
    assert.equal(s.payroll.length,1);
  }
});

test("payroll revocation is effective when the operation permission is removed", () => {
  const s=createDomainFixture();
  s.payroll.push({accountId:"acct-a",employeeId:"emp-1",recordId:"pay-1",period:"2026-01",amount:100});
  const writeArgs={accountId:"acct-a",employeeId:"emp-1",recordId:"pay-2",period:"2026-02",amount:150,actorUid:"mgr",authorizedEmployeeIds:["emp-1"]};
  const exportArgs={accountId:"acct-a",employeeId:"emp-1",actorUid:"mgr",authorizedEmployeeIds:["emp-1"]};
  assert.throws(()=>writePayrollRecord(s,{...writeArgs,permissions:[]}),{code:"permission-denied"});
  assert.throws(()=>exportPayroll(s,{...exportArgs,permissions:[]}),{code:"permission-denied"});
  assert.throws(()=>payrollView(s,{accountId:"acct-a",employeeId:"emp-1",actorUid:"employee-1",permissions:[]}),{code:"permission-denied"});
  assert.equal(s.payroll.length,1);
});


test("payroll read and export fail closed when audit cannot be appended", () => {
  const s = createDomainFixture();
  s.payroll.push({ accountId:"acct-a", employeeId:"emp-1", recordId:"pay-1", period:"2026-01", amount:100 });
  const readArgs = { accountId:"acct-a", employeeId:"emp-1", actorUid:"employee-1", permissions:["payroll:read"] };
  const exportArgs = { accountId:"acct-a", employeeId:"emp-1", actorUid:"manager-1",
    permissions:["payroll:export"], authorizedEmployeeIds:["emp-1"] };
  s.audit = null;
  assert.throws(() => payrollView(s, readArgs));
  assert.throws(() => exportPayroll(s, exportArgs));
});

test("payroll read/export audit entries include actor and operation permission", () => {
  const s = createDomainFixture();
  s.payroll.push({ accountId:"acct-a", employeeId:"emp-1", recordId:"pay-1", period:"2026-01", amount:100 });
  assert.deepEqual(payrollView(s, { accountId:"acct-a", employeeId:"emp-1", actorUid:"employee-1", permissions:["payroll:read"] }),
    [{ period:"2026-01", amount:100 }]);
  assert.deepEqual(exportPayroll(s, { accountId:"acct-a", employeeId:"emp-1", actorUid:"manager-1",
    permissions:["payroll:export"], authorizedEmployeeIds:["emp-1"] }), [{ period:"2026-01", amount:100 }]);
  assert.deepEqual(s.audit.map(x => [x.action, x.permission, x.actorUid]), [
    ["payroll-read", "payroll:read", "employee-1"],
    ["payroll-export", "payroll:export", "manager-1"]
  ]);
});


test("account, site, and department lifecycle independently deny new placement and protected access", () => {
  const args = { accountId:"acct-a", uid:"uid-1", employeeId:"emp-1",
    siteId:"site-1", departmentId:"dept-1", date:"2026-02-01" };
  const managerArgs = { accountId:"acct-a", managerUid:"manager-1", employeeId:"emp-1",
    siteId:"site-1", departmentId:"dept-1", date:"2026-02-01",
    now:"2026-02-01T12:00:00Z", operation:"read" };
  const inactiveStates = ["suspended", "archived", "unknown", undefined];

  for (const status of inactiveStates) {
    const s = placedFixture();
    if (status === undefined) delete s.accounts[0].status;
    else s.accounts[0].status = status;
    s.delegations.push({ accountId:"acct-a", managerUid:"manager-1", employeeId:"emp-1",
      siteId:"site-1", departmentId:"dept-1", status:"active",
      expiresAt:"2026-03-01T00:00:00Z", permissions:["shift:read"] });
    assert.throws(() => authorizeNewOperation(s, args), { code:"permission-denied" });
    assert.throws(() => authorizeManagerShift(s, managerArgs), { code:"permission-denied" });
    assert.throws(() => addPlacement(s, { accountId:"acct-a", employeeId:"emp-1",
      siteId:"site-2", departmentId:"dept-2", start:"2026-07-01" }), { code:"account-not-active" });
  }

  for (const field of ["status", "siteStatus", "departmentStatus"]) {
    for (const status of inactiveStates) {
      const s = placedFixture();
      if (status === undefined) delete s.org[0][field];
      else s.org[0][field] = status;
      s.delegations.push({ accountId:"acct-a", managerUid:"manager-1", employeeId:"emp-1",
        siteId:"site-1", departmentId:"dept-1", status:"active",
        expiresAt:"2026-03-01T00:00:00Z", permissions:["shift:read"] });
      assert.throws(() => authorizeNewOperation(s, args), { code:"permission-denied" });
      assert.throws(() => authorizeManagerShift(s, managerArgs), { code:"permission-denied" });
      assert.throws(() => addPlacement(s, { accountId:"acct-a", employeeId:"emp-1",
        siteId:"site-1", departmentId:"dept-1", start:"2026-07-01" }), { code:"org-not-active" });
    }
  }
  const duplicateAccount = placedFixture();
  duplicateAccount.accounts.push({ accountId:"acct-a", status:"active" });
  assert.throws(() => authorizeNewOperation(duplicateAccount, args), { code:"permission-denied" });
});
