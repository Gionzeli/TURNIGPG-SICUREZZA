import { verifyIdentity } from "../auth/verify-identity.js";
import { createEmployeeShiftService } from "./employee-shift-service.js";
import { createEmployeeShiftFirestoreAuthorization } from "./employee-shift-firestore-authorization.js";

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const validId = value => typeof value === "string" && ID.test(value);
function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function bearer(request) {
  const header = request?.rawRequest?.headers?.authorization;
  const match = typeof header === "string" ? /^Bearer ([^\s]+)$/i.exec(header) : null;
  if (!match) fail("unauthenticated", "Bearer ID token required.");
  return match[1];
}
function dataObject(request, allowed) {
  const data = request?.data;
  if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).some(k => !allowed.includes(k))) {
    fail("invalid-argument", "Callable data contains unsupported fields.");
  }
  return data;
}
function id(value) { if (!validId(value)) fail("invalid-argument", "Invalid identifier."); return value; }
function validDate(value) { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const d = new Date(value + "T00:00:00Z"); return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value; }
const DTO_KEYS = ["date", "type", "post", "start_time", "end_time", "hours", "is_night", "is_sunday", "is_piantonato", "is_rest_not_enjoyed", "has_meal_voucher"];

export function createEmployeeShiftCallableHandlers({ db, verifyToken, now = () => Date.now() }) {
  if (!db || typeof verifyToken !== "function") throw new TypeError("Trusted Firestore and token verifier required.");
  const authorization = createEmployeeShiftFirestoreAuthorization({ db, now });
  const service = createEmployeeShiftService({ db, authorizeActor: authorization.authorizeActor, loadPlacementAt: authorization.loadPlacementAt, now });
  async function actor(request) {
    try { return await verifyIdentity(bearer(request), verifyToken); }
    catch { fail("unauthenticated", "Identity verification failed."); }
  }
  return Object.freeze({
    async listOwn(request) {
      const data = dataObject(request, ["accountId", "fromDate", "toDate"]);
      const identity = await actor(request), accountId = id(data.accountId);
      if (!validDate(data.fromDate) || !validDate(data.toDate) || data.toDate < data.fromDate) fail("invalid-argument", "Invalid shift date range.");
      return db.runTransaction(async tx => {
        const principal = await authorization.loadOwnPrincipal(tx, { accountId, actorUid: identity.uid, operation: "read" });
        const query = db.collection(`accounts/${accountId}/employeeShifts`)
          .where("employeeId", "==", principal.employeeId)
          .where("date", ">=", data.fromDate)
          .where("date", "<=", data.toDate)
          .orderBy("date", "asc")
          .limit(201);
        const snapshots = await tx.get(query);
        if (snapshots.size > 200) fail("resource-exhausted", "Shift result exceeds the safe response bound.");
        const result = [];
        for (const snapshot of snapshots.docs) {
          const shift = snapshot.data();
          if (shift.accountId !== accountId || shift.employeeId !== principal.employeeId ||
              shift.status !== "active" || !validDate(shift.date) || shift.date < data.fromDate ||
              shift.date > data.toDate || !validId(shift.placementId) || !validId(shift.siteId) ||
              !validId(shift.departmentId) || !Number.isSafeInteger(shift.revision) || shift.revision < 1) continue;
          const placement = await authorization.loadPlacementAt(tx, accountId, principal.employeeId, shift.date);
          if (placement.placementId !== shift.placementId || placement.siteId !== shift.siteId ||
              placement.departmentId !== shift.departmentId) continue;
          const dto = { shiftId: snapshot.id };
          for (const key of DTO_KEYS) if (Object.hasOwn(shift, key)) dto[key] = shift[key];
          dto.revision = shift.revision;
          result.push(dto);
        }
        return result.sort((a, b) => a.date.localeCompare(b.date));
      });
    },
    async create(request) {
      const data = dataObject(request, ["accountId", "data"]), identity = await actor(request), accountId = id(data.accountId);
      const shiftId = db.collection(`accounts/${accountId}/employeeShifts`).doc().id;
      const eventId = db.collection(`accounts/${accountId}/employeeAudit`).doc().id;
      return service.create({ accountId, actorUid: identity.uid, actorIdentity: identity, shiftId, eventId, data: data.data });
    },
    async update(request) {
      const data = dataObject(request, ["accountId", "shiftId", "expectedRevision", "changes"]), identity = await actor(request);
      if (!Number.isSafeInteger(data.expectedRevision) || data.expectedRevision < 1) fail("invalid-argument", "Invalid expected revision.");
      const accountId = id(data.accountId);
      return service.update({ accountId, actorUid: identity.uid, actorIdentity: identity, shiftId: id(data.shiftId),
        eventId: db.collection(`accounts/${accountId}/employeeAudit`).doc().id, expectedRevision: data.expectedRevision, changes: data.changes });
    },
    async delete(request) {
      const data = dataObject(request, ["accountId", "shiftId", "expectedRevision"]), identity = await actor(request);
      if (!Number.isSafeInteger(data.expectedRevision) || data.expectedRevision < 1) fail("invalid-argument", "Invalid expected revision.");
      const accountId = id(data.accountId);
      return service.delete({ accountId, actorUid: identity.uid, actorIdentity: identity, shiftId: id(data.shiftId),
        eventId: db.collection(`accounts/${accountId}/employeeAudit`).doc().id, expectedRevision: data.expectedRevision });
    }
  });
}
