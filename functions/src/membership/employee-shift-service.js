const ID = /^[A-Za-z0-9_-]{1,128}$/;
const validId = value => typeof value === "string" && ID.test(value);
const TYPES = new Set(["turno", "turno_riposo", "riposo", "riposo_compensativo", "ferie", "permesso", "malattia"]);
const FLAGS = ["is_night", "is_sunday", "is_piantonato", "is_rest_not_enjoyed", "has_meal_voucher"];
const KEYS = new Set(["date", "type", "post", "start_time", "end_time", "hours", ...FLAGS]);
function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function validDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value + "T00:00:00Z")) &&
    new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
}
function normalizeShift(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("invalid-argument", "Shift payload must be an object.");
  for (const key of Object.keys(input)) if (!KEYS.has(key)) fail("invalid-argument", "Unrecognized shift field.");
  if (!validDate(input.date) || !TYPES.has(input.type)) fail("invalid-argument", "Invalid shift date or type.");
  const post = input.post ?? "";
  if (typeof post !== "string" || post.length > 80) fail("invalid-argument", "Invalid shift post.");
  const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  const start_time = input.start_time ?? "", end_time = input.end_time ?? "";
  if ((start_time !== "" && (typeof start_time !== "string" || !time.test(start_time))) ||
      (end_time !== "" && (typeof end_time !== "string" || !time.test(end_time))) ||
      ((start_time === "") !== (end_time === "")) || (start_time !== "" && start_time === end_time)) {
    fail("invalid-argument", "Invalid shift time interval.");
  }
  const hours = input.hours ?? 0;
  if (typeof hours !== "number" || !Number.isFinite(hours) || hours < 0 || hours > 48) fail("invalid-argument", "Invalid shift hours.");
  const flags = {};
  for (const key of FLAGS) {
    const value = input[key] ?? false;
    if (typeof value !== "boolean") fail("invalid-argument", "Invalid shift flag.");
    flags[key] = value;
  }
  return { date: input.date, type: input.type, post, start_time, end_time, hours, ...flags };
}
function assertPlacement(placement, { accountId, employeeId, date }) {
  if (!placement || placement.accountId !== accountId || placement.employeeId !== employeeId ||
      !validId(placement.placementId) || !validId(placement.siteId) || !validId(placement.departmentId) ||
      !validDate(placement.validFrom) || (placement.validUntil !== null && !validDate(placement.validUntil)) ||
      placement.validFrom > date || (placement.validUntil !== null && placement.validUntil <= date)) {
    fail("permission-denied", "A unique active-at-date Employee placement is required.");
  }
  return placement;
}
function validateRevision(value) {
  if (!Number.isSafeInteger(value) || value < 1) fail("invalid-argument", "A positive expected shift revision is required.");
}
function refs(db, accountId, shiftId, eventId) {
  return {
    account: db.doc("accounts/" + accountId),
    shift: db.doc("accounts/" + accountId + "/employeeShifts/" + shiftId),
    audit: db.doc("accounts/" + accountId + "/employeeAudit/shift-" + eventId)
  };
}
/**
 * Internal Firestore service. authorizeActor and loadPlacementAt MUST read
 * canonical membership, binding/delegation, lifecycle, permissions and
 * historical placement through the supplied transaction. No client identity,
 * Employee, site or department fields are accepted in the shift payload.
 */
export function createEmployeeShiftService({ db, authorizeActor, loadPlacementAt, now = () => Date.now() }) {
  if (!db || typeof authorizeActor !== "function" || typeof loadPlacementAt !== "function" || typeof now !== "function") {
    throw new TypeError("Trusted Firestore, authorization and placement loaders are required.");
  }
  async function context(tx, args) {
    const actor = await authorizeActor(tx, args);
    if (!actor || !validId(actor.employeeId)) fail("permission-denied", "Shift operation is not authorized.");
    const placement = assertPlacement(await loadPlacementAt(tx, args.accountId, actor.employeeId, args.date), {
      accountId: args.accountId, employeeId: actor.employeeId, date: args.date
    });
    return { employeeId: actor.employeeId, placement };
  }
  return Object.freeze({
    async create({ accountId, actorUid, actorIdentity, shiftId, eventId, data }) {
      if (![accountId, actorUid, shiftId, eventId].every(validId)) fail("invalid-argument", "Invalid shift selector.");
      const shift = normalizeShift(data), r = refs(db, accountId, shiftId, eventId);
      return db.runTransaction(async tx => {
        const [accountSnap, shiftSnap, auditSnap] = await Promise.all([tx.get(r.account), tx.get(r.shift), tx.get(r.audit)]);
        const timestamp = now();
        if (!Number.isSafeInteger(timestamp)) fail("failed-precondition", "Invalid trusted clock.");
        if (!accountSnap.exists || accountSnap.data().status !== "active") fail("failed-precondition", "Active account required.");
        if (shiftSnap.exists || auditSnap.exists) fail("already-exists", "Shift or audit ID already exists.");
        const { employeeId, placement } = await context(tx, { accountId, actorUid, actorIdentity, employeeId: null, date: shift.date, operation: "create" });
        const record = {
          ...shift, accountId, employeeId, placementId: placement.placementId,
          siteId: placement.siteId, departmentId: placement.departmentId,
          status: "active", revision: 1, createdAt: timestamp, createdBy: actorUid, updatedAt: timestamp
        };
        tx.create(r.shift, record);
        tx.create(r.audit, { eventId: "shift-" + eventId, type: "employee.shift.created", accountId, employeeId, shiftId, actorUid, occurredAt: timestamp, revision: 1 });
        return Object.freeze({ shiftId, employeeId, revision: 1, status: "active" });
      });
    },
    async update({ accountId, actorUid, actorIdentity, shiftId, eventId, expectedRevision, changes }) {
      if (![accountId, actorUid, shiftId, eventId].every(validId)) fail("invalid-argument", "Invalid shift selector.");
      validateRevision(expectedRevision);
      if (!changes || typeof changes !== "object" || Array.isArray(changes) || Object.hasOwn(changes, "date")) fail("invalid-argument", "Shift date is immutable; create a replacement through an approved workflow.");
      const r = refs(db, accountId, shiftId, eventId);
      return db.runTransaction(async tx => {
        const [accountSnap, shiftSnap, auditSnap] = await Promise.all([tx.get(r.account), tx.get(r.shift), tx.get(r.audit)]);
        const timestamp = now();
        if (!Number.isSafeInteger(timestamp)) fail("failed-precondition", "Invalid trusted clock.");
        if (!accountSnap.exists || accountSnap.data().status !== "active") fail("failed-precondition", "Active account required.");
        if (!shiftSnap.exists || shiftSnap.data().status !== "active") fail("not-found", "Active shift not found.");
        if (auditSnap.exists) fail("already-exists", "Audit event ID already used.");
        const current = shiftSnap.data();
        if (current.accountId !== accountId || !validId(current.employeeId) || !validDate(current.date) || current.revision !== expectedRevision) fail("failed-precondition", "Shift ownership or revision mismatch.");
        await context(tx, { accountId, actorUid, actorIdentity, employeeId: current.employeeId, date: current.date, siteId: current.siteId, departmentId: current.departmentId, operation: "update", current });
        const normalized = normalizeShift({ ...current, ...changes });
        const revision = expectedRevision + 1;
        if (!Number.isSafeInteger(revision)) fail("failed-precondition", "Shift revision exhausted.");
        tx.update(r.shift, { ...normalized, revision, updatedAt: timestamp, updatedBy: actorUid });
        tx.create(r.audit, { eventId: "shift-" + eventId, type: "employee.shift.updated", accountId, employeeId: current.employeeId, shiftId, actorUid, occurredAt: timestamp, revision });
        return Object.freeze({ shiftId, employeeId: current.employeeId, revision, status: "active" });
      });
    },
    async delete({ accountId, actorUid, actorIdentity, shiftId, eventId, expectedRevision }) {
      if (![accountId, actorUid, shiftId, eventId].every(validId)) fail("invalid-argument", "Invalid shift selector.");
      validateRevision(expectedRevision);
      const r = refs(db, accountId, shiftId, eventId);
      return db.runTransaction(async tx => {
        const [accountSnap, shiftSnap, auditSnap] = await Promise.all([tx.get(r.account), tx.get(r.shift), tx.get(r.audit)]);
        const timestamp = now();
        if (!Number.isSafeInteger(timestamp)) fail("failed-precondition", "Invalid trusted clock.");
        if (!accountSnap.exists || accountSnap.data().status !== "active") fail("failed-precondition", "Active account required.");
        if (!shiftSnap.exists || shiftSnap.data().status !== "active") fail("not-found", "Active shift not found.");
        if (auditSnap.exists) fail("already-exists", "Audit event ID already used.");
        const current = shiftSnap.data();
        if (current.accountId !== accountId || !validId(current.employeeId) || !validDate(current.date) || current.revision !== expectedRevision) fail("failed-precondition", "Shift ownership or revision mismatch.");
        await context(tx, { accountId, actorUid, actorIdentity, employeeId: current.employeeId, date: current.date, siteId: current.siteId, departmentId: current.departmentId, operation: "delete", current });
        const revision = expectedRevision + 1;
        if (!Number.isSafeInteger(revision)) fail("failed-precondition", "Shift revision exhausted.");
        tx.update(r.shift, { status: "deleted", revision, deletedAt: timestamp, deletedBy: actorUid, updatedAt: timestamp });
        tx.create(r.audit, { eventId: "shift-" + eventId, type: "employee.shift.deleted", accountId, employeeId: current.employeeId, shiftId, actorUid, occurredAt: timestamp, revision });
        return Object.freeze({ shiftId, employeeId: current.employeeId, revision, status: "deleted" });
      });
    }
  });
}
