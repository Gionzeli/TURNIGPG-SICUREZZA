// Pure in-memory domain reference model; deliberately not a datastore adapter.
const fail = code => { throw Object.assign(new Error(code), { code }); };
const validDate = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(value + "T00:00:00Z")) &&
  new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
const overlaps = (a, b) => a.start < (b.end ?? "9999-12-31") &&
  b.start < (a.end ?? "9999-12-31");

export function createDomainFixture() {
  return {
    employees: [{ accountId: "acct-a", employeeId: "emp-1", status: "active" }],
    org: [
      { accountId: "acct-a", siteId: "site-1", departmentId: "dept-1", status: "active" },
      { accountId: "acct-a", siteId: "site-2", departmentId: "dept-2", status: "active" }
    ],
    placements: [], shifts: [], payroll: [], absences: [], bindings: [
      { accountId: "acct-a", uid: "uid-1", employeeId: "emp-1", status: "active" }
    ],
    delegations: [], audit: []
  };
}

function validatePlacement(state, placement, excluded = null) {
  const { accountId, employeeId, siteId, departmentId, start, end = null } = placement;
  if (![accountId, employeeId, siteId, departmentId].every(x => typeof x === "string" && x.length > 0) ||
      !validDate(start) || (end !== null && (!validDate(end) || end <= start))) fail("invalid-placement");
  if (!state.employees.some(x => x.accountId === accountId && x.employeeId === employeeId && x.status === "active")) fail("employee-not-active");
  if (!state.org.some(x => x.accountId === accountId && x.siteId === siteId &&
      x.departmentId === departmentId && x.status === "active")) fail("org-not-active");
  const candidate = { accountId, employeeId, siteId, departmentId, start, end };
  if (state.placements.some(x => x !== excluded && x.accountId === accountId &&
      x.employeeId === employeeId && overlaps(x, candidate))) fail("placement-overlap");
  return candidate;
}

export function addPlacement(state, placement) {
  const candidate = validatePlacement(state, placement);
  state.placements.push(candidate);
  return candidate;
}

export function placementAt(state, accountId, employeeId, date) {
  if (!validDate(date)) fail("invalid-date");
  const found = state.placements.filter(x => x.accountId === accountId && x.employeeId === employeeId &&
    x.start <= date && (x.end === null || date < x.end));
  if (found.length !== 1) fail("placement-missing-or-ambiguous");
  return found[0];
}

export function addHistoricalShift(state, { accountId, employeeId, shiftId, date }) {
  const placement = placementAt(state, accountId, employeeId, date);
  const shift = { accountId, employeeId, shiftId, date, siteId: placement.siteId, departmentId: placement.departmentId };
  state.shifts.push(shift);
  return shift;
}

export function transferEmployee(state, { accountId, employeeId, siteId, departmentId, effectiveDate }) {
  if (!validDate(effectiveDate)) fail("invalid-date");
  const current = placementAt(state, accountId, employeeId, effectiveDate);
  if (current.start === effectiveDate) fail("ambiguous-transfer-boundary");
  // Validate every precondition before changing the old interval.
  const next = validatePlacement(state,
    { accountId, employeeId, siteId, departmentId, start: effectiveDate }, current);
  current.end = effectiveDate;
  state.placements.push(next);
  return next;
}

export function revokeBinding(state, accountId, uid) {
  const binding = state.bindings.find(x => x.accountId === accountId && x.uid === uid && x.status === "active");
  if (!binding) fail("binding-unavailable");
  binding.status = "revoked";
  state.audit.push({ actor: "synthetic-server-actor", action: "binding-revoked", accountId, uid });
}

export function authorizeNewOperation(state, { accountId, uid, employeeId, siteId, departmentId, date }) {
  const binding = state.bindings.find(x => x.accountId === accountId && x.uid === uid &&
    x.employeeId === employeeId && x.status === "active");
  const employee = state.employees.find(x => x.accountId === accountId && x.employeeId === employeeId);
  const org = state.org.find(x => x.accountId === accountId && x.siteId === siteId &&
    x.departmentId === departmentId && x.status === "active");
  let placement;
  try { placement = placementAt(state, accountId, employeeId, date); }
  catch { fail("permission-denied"); }
  if (!binding || !employee || employee.status !== "active" || !org ||
      placement.siteId !== siteId || placement.departmentId !== departmentId) fail("permission-denied");
  return true;
}

function requireActiveEmployee(state, accountId, employeeId) {
  const employee = state.employees.find(x => x.accountId === accountId && x.employeeId === employeeId);
  if (!employee || employee.status !== "active") fail("permission-denied");
  return employee;
}
export function payrollView(state, { accountId, employeeId, actorUid, permissions = [] }) {
  requireActiveEmployee(state, accountId, employeeId);
  if (!permissions.includes("payroll:read") || typeof actorUid !== "string" || !actorUid) fail("permission-denied");
  const rows = state.payroll.filter(x => x.accountId === accountId && x.employeeId === employeeId)
    .map(x => ({ period: x.period, amount: x.amount }));
  const nextAudit = state.audit.concat({ actorUid, action: "payroll-read", permission: "payroll:read", accountId, employeeId, recordCount: rows.length });
  // Prepare audit before returning any payroll data (fail closed if audit cannot be staged).
  state.audit = nextAudit;
  return rows;
}

export function managerAbsenceView(state, { accountId, employeeId }) {
  return state.absences.filter(x => x.accountId === accountId && x.employeeId === employeeId)
    .map(x => ({ unavailable: true, start: x.start, end: x.end }));
}


// Synthetic policy examples only; these do not enforce authorization in an application.
export function revokeManagerDelegation(state, {
  accountId, managerUid, employeeId, siteId, departmentId, actorUid, reason
}) {
  if (![accountId, managerUid, employeeId, siteId, departmentId, actorUid, reason]
      .every(x => typeof x === "string" && x.trim().length > 0)) fail("invalid-revocation");
  const matches = state.delegations.filter(x => x.accountId === accountId &&
    x.managerUid === managerUid && x.employeeId === employeeId &&
    x.siteId === siteId && x.departmentId === departmentId && x.status === "active");
  if (matches.length !== 1) fail("delegation-unavailable");
  const nextAudit = state.audit.concat({ actorUid, action:"manager-delegation-revoked",
    accountId, managerUid, employeeId, siteId, departmentId, reason });
  // Stage the audit before changing delegation status.
  state.audit = nextAudit;
  matches[0].status = "revoked";
  return true;
}

export function authorizeManagerShift(state, {
  accountId, managerUid, employeeId, siteId, departmentId, date, operation, now
}) {
  const allowedOperations = new Set(["read", "create", "update", "delete"]);
  if (!allowedOperations.has(operation) || typeof now !== "string" ||
      Number.isNaN(Date.parse(now)) || !validDate(date)) fail("permission-denied");
  const permission = `shift:${operation}`;
  const delegation = state.delegations.find(x =>
    x.accountId === accountId && x.managerUid === managerUid &&
    x.employeeId === employeeId && x.status === "active" &&
    x.permissions?.includes(permission) && x.siteId === siteId && x.departmentId === departmentId &&
    typeof x.expiresAt === "string" && !Number.isNaN(Date.parse(x.expiresAt)) &&
    Date.parse(x.expiresAt) > Date.parse(now));
  const employee = state.employees.find(x =>
    x.accountId === accountId && x.employeeId === employeeId && x.status === "active");
  const org = state.org.find(x => x.accountId === accountId &&
    x.siteId === siteId && x.departmentId === departmentId && x.status === "active");
  let placement;
  try { placement = placementAt(state, accountId, employeeId, date); }
  catch { fail("permission-denied"); }
  if (!delegation || !employee || !org ||
      placement.siteId !== siteId || placement.departmentId !== departmentId) fail("permission-denied");
  return true;
}

export function writePayrollRecord(state, {
  accountId, employeeId, recordId, period, amount, actorUid, permissions = [], authorizedEmployeeIds = []
}) {
  if (!permissions.includes("payroll:write") || !authorizedEmployeeIds.includes(employeeId)) fail("permission-denied");
  requireActiveEmployee(state, accountId, employeeId);
  if (![accountId, employeeId, recordId, period, actorUid].every(x => typeof x === "string" && x.length > 0) ||
      typeof amount !== "number" || !Number.isFinite(amount)) fail("invalid-payroll-record");
  const index = state.payroll.findIndex(x =>
    x.accountId === accountId && x.employeeId === employeeId && x.recordId === recordId);
  const nextPayroll = state.payroll.slice();
  const record = { accountId, employeeId, recordId, period, amount };
  if (index < 0) nextPayroll.push(record);
  else nextPayroll[index] = record;
  const nextAudit = state.audit.concat({ actorUid, action: "payroll-write", permission: "payroll:write", accountId, employeeId, recordId });
  // Prepare both replacement arrays before publishing either mutation.
  state.payroll = nextPayroll;
  state.audit = nextAudit;
  return { period, amount };
}

export function exportPayroll(state, {
  accountId, employeeId, actorUid, permissions = [], authorizedEmployeeIds = []
}) {
  if (!permissions.includes("payroll:export") || !authorizedEmployeeIds.includes(employeeId) ||
      typeof actorUid !== "string" || !actorUid) fail("permission-denied");
  requireActiveEmployee(state, accountId, employeeId);
  const rows = state.payroll.filter(x => x.accountId === accountId && x.employeeId === employeeId)
    .map(x => ({ period: x.period, amount: x.amount }));
  const nextAudit = state.audit.concat({ actorUid, action: "payroll-export", permission: "payroll:export", accountId, employeeId, recordCount: rows.length });
  // Audit must be staged before data is returned; an audit failure prevents export.
  state.audit = nextAudit;
  return rows;
}

export function managerAbsenceReport(state, { accountId, employeeId }) {
  // No category filters, category groupings, or category-derived counts are exposed.
  return state.absences.filter(x => x.accountId === accountId && x.employeeId === employeeId)
    .map(x => ({ unavailable: true, start: x.start, end: x.end }));
}
