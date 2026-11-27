import { resolveCanonicalMembership } from "./membership-policy.js";

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const validId = value => typeof value === "string" && ID.test(value);
const OPERATIONS = Object.freeze({
  read: "dsm:employee:shift:read:self",
  create: "dsm:employee:shift:create:self",
  update: "dsm:employee:shift:update:self",
  delete: "dsm:employee:shift:delete:self"
});
function deny() {
  const error = new Error("Own Employee shift access denied.");
  error.code = "permission-denied";
  throw error;
}
function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + "T00:00:00Z");
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
function placementFrom(snapshot, accountId, expectedEmployeeId = null) {
  const p = snapshot.data();
  if (!p || p.accountId !== accountId || (expectedEmployeeId !== null && p.employeeId !== expectedEmployeeId) || p.placementId !== snapshot.id ||
      !validId(p.employeeId) || !validId(p.siteId) || !validId(p.departmentId) ||
      !validDate(p.validFrom) ||
      !(p.validUntil === null || (validDate(p.validUntil) && p.validUntil > p.validFrom)) ||
      !Number.isSafeInteger(p.revision) || p.revision < 1) deny();
  return p;
}

/** Transaction-aware adapter; delegated manager/admin shift access remains denied. */
export function createEmployeeShiftFirestoreAuthorization({ db, now = () => Date.now() }) {
  if (!db || typeof db.doc !== "function" || typeof now !== "function") throw new TypeError("Trusted Firestore and clock are required.");
  async function load(tx, { accountId, actorUid, operation, date = null }) {
    if (!validId(accountId) || !validId(actorUid) || !Object.hasOwn(OPERATIONS, operation) ||
        (date !== null && !validDate(date)) || (operation !== "read" && !validDate(date))) deny();
    const accountRef = db.doc(`accounts/${accountId}`);
    const memberRef = db.doc(`accounts/${accountId}/members/${actorUid}`);
    const bindingRef = db.doc(`accounts/${accountId}/employeeBindingsByUid/${actorUid}`);
    const [accountSnap, memberSnap, bindingSnap] = await Promise.all([tx.get(accountRef), tx.get(memberRef), tx.get(bindingRef)]);
    const timestamp = now();
    if (!Number.isSafeInteger(timestamp) || !accountSnap.exists || accountSnap.id !== accountId ||
        accountSnap.data().accountId !== accountId || accountSnap.data().status !== "active" ||
        !Number.isSafeInteger(accountSnap.data().schemaVersion) || accountSnap.data().schemaVersion < 1 ||
        !Number.isSafeInteger(accountSnap.data().version) || accountSnap.data().version < 1 || !memberSnap.exists) deny();
    const principal = resolveCanonicalMembership({ uid: actorUid, accountId, membership: memberSnap.data(), nowMs: timestamp });
    if (!principal || principal.role !== "member" || !bindingSnap.exists) deny();
    const binding = bindingSnap.data();
    if (binding.accountId !== accountId || binding.uid !== actorUid || !validId(binding.employeeId) ||
        binding.status !== "active" || !Number.isSafeInteger(binding.revision) || binding.revision < 1) deny();
    const employeeId = binding.employeeId;
    const reverseRef = db.doc(`accounts/${accountId}/employeeBindingsByEmployee/${employeeId}`);
    const employeeRef = db.doc(`accounts/${accountId}/employees/${employeeId}`);
    const controlRef = db.doc(`accounts/${accountId}/employeeControl/${employeeId}`);
    const historyQuery = db.collection(`accounts/${accountId}/employees/${employeeId}/placements`).limit(501);
    const [reverseSnap, employeeSnap, controlSnap, historySnap] = await Promise.all([
      tx.get(reverseRef), tx.get(employeeRef), tx.get(controlRef), tx.get(historyQuery)
    ]);
    if (!reverseSnap.exists || !employeeSnap.exists || !controlSnap.exists || historySnap.size < 1 || historySnap.size > 500) deny();
    const reverse = reverseSnap.data(), employee = employeeSnap.data(), control = controlSnap.data();
    if (reverse.accountId !== accountId || reverse.uid !== actorUid || reverse.employeeId !== employeeId ||
        reverse.status !== "active" || reverse.revision !== binding.revision ||
        employee.accountId !== accountId || employee.employeeId !== employeeId || employee.status !== "active" ||
        control.accountId !== accountId || control.employeeId !== employeeId ||
        control.bindingRevision !== binding.revision || !Number.isSafeInteger(control.bindingRevision) ||
        control.bindingRevision < 1) deny();
    const history = historySnap.docs.map(s => placementFrom(s, accountId, employeeId));
    let placement = null;
    if (date !== null) {
      const matches = history.filter(p => p.employeeId === employeeId && p.validFrom <= date &&
        (p.validUntil === null || p.validUntil > date));
      if (matches.length !== 1) deny();
      placement = matches[0];
      const scopeMatches = principal.scopeType === "site"
        ? principal.scopeIds.includes(placement.siteId)
        : principal.scopeType === "department" && principal.scopeIds.includes(placement.departmentId);
      if (!scopeMatches) deny();
      const [siteSnap, departmentSnap] = await Promise.all([
        tx.get(db.doc(`accounts/${accountId}/sites/${placement.siteId}`)),
        tx.get(db.doc(`accounts/${accountId}/departments/${placement.departmentId}`))
      ]);
      if (!siteSnap.exists || !departmentSnap.exists) deny();
      const site = siteSnap.data(), department = departmentSnap.data();
      if (site.accountId !== accountId || site.siteId !== placement.siteId || site.status !== "active" ||
          department.accountId !== accountId || department.departmentId !== placement.departmentId ||
          department.siteId !== placement.siteId || department.status !== "active") deny();
    }
    return Object.freeze({
      employeeId, uid: actorUid, accountId, permission: OPERATIONS[operation],
      scopeType: principal.scopeType, scopeIds: principal.scopeIds, placement
    });
  }
  return Object.freeze({
    authorizeActor: async (tx, args) => {
      const result = await load(tx, args);
      if (args.employeeId && args.employeeId !== result.employeeId) deny();
      if (args.current && (!result.placement || args.current.placementId !== result.placement.placementId ||
          args.current.siteId !== result.placement.siteId || args.current.departmentId !== result.placement.departmentId)) deny();
      return result;
    },
    loadPlacementAt: async (tx, accountId, employeeId, date) => {
      if (!validId(accountId) || !validId(employeeId) || !validDate(date)) deny();
      const query = db.collection(`accounts/${accountId}/employees/${employeeId}/placements`).limit(501);
      const result = await tx.get(query);
      if (result.size < 1 || result.size > 500) deny();
      const history = result.docs.map(s => placementFrom(s, accountId, employeeId));
      const matches = history.filter(p => p.employeeId === employeeId && p.validFrom <= date &&
        (p.validUntil === null || p.validUntil > date));
      if (matches.length !== 1) deny();
      const placement = matches[0];
      const [siteSnap, departmentSnap] = await Promise.all([
        tx.get(db.doc(`accounts/${accountId}/sites/${placement.siteId}`)),
        tx.get(db.doc(`accounts/${accountId}/departments/${placement.departmentId}`))
      ]);
      if (!siteSnap.exists || !departmentSnap.exists) deny();
      const site = siteSnap.data(), department = departmentSnap.data();
      if (site.accountId !== accountId || site.siteId !== placement.siteId || site.status !== "active" ||
          department.accountId !== accountId || department.departmentId !== placement.departmentId ||
          department.siteId !== placement.siteId || department.status !== "active") deny();
      return placement;
    },
    loadOwnPrincipal: (tx, args) => load(tx, args)
  });
}
