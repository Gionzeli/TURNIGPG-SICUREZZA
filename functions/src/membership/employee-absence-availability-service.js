const ID = /^[A-Za-z0-9_-]{1,128}$/;
const validId = value => typeof value === "string" && ID.test(value);
function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function validDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value + "T00:00:00Z")) &&
    new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
}
function validateRange(startDate, endDate) {
  if (!validDate(startDate) || !validDate(endDate) || endDate < startDate ||
      (Date.parse(endDate + "T00:00:00Z") - Date.parse(startDate + "T00:00:00Z")) / 86400000 > 3660) {
    fail("invalid-argument", "Invalid absence availability range.");
  }
}
/**
 * Manager-facing availability only. The injected authorizer must verify a
 * revocation-checked actor, active canonical membership, explicit
 * absence:read:availability permission and all placement/delegation scopes
 * intersecting the requested date range. It returns only allowed placement IDs.
 */
export function createManagerAbsenceAvailabilityService({ db, authorizeManagerAvailability, now = () => Date.now() }) {
  if (!db || typeof authorizeManagerAvailability !== "function" || typeof now !== "function") {
    throw new TypeError("Trusted Firestore, manager authorizer and clock are required.");
  }
  return Object.freeze({
    async read({ accountId, actorUid, actorIdentity, employeeId, startDate, endDate, eventId }) {
      if (![accountId, actorUid, employeeId, eventId].every(validId)) fail("invalid-argument", "Invalid absence selector.");
      if (!actorIdentity || actorIdentity.uid !== actorUid) fail("permission-denied", "Verified actor identity does not match the request actor.");
      validateRange(startDate, endDate);
      const accountRef = db.doc("accounts/" + accountId);
      const recordsRef = db.collection("accounts/" + accountId + "/employeeAbsences");
      const auditRef = db.doc("accounts/" + accountId + "/employeeAudit/absence-availability-" + eventId);
      return db.runTransaction(async tx => {
        const [accountSnap, auditSnap] = await Promise.all([tx.get(accountRef), tx.get(auditRef)]);
        const timestamp = now();
        if (!Number.isSafeInteger(timestamp)) fail("failed-precondition", "Invalid trusted clock.");
        if (!accountSnap.exists || accountSnap.data().status !== "active") fail("failed-precondition", "Active account required.");
        if (auditSnap.exists) fail("already-exists", "Audit event ID already used.");
        const scope = await authorizeManagerAvailability(tx, {
          accountId, actorUid, actorIdentity, employeeId, startDate, endDate,
          permission: "absence:read:availability", operation: "read-availability"
        });
        if (!scope || scope.employeeId !== employeeId || !Array.isArray(scope.placementIds) ||
            scope.placementIds.length === 0 || scope.placementIds.length > 500 || scope.placementIds.some(id => !validId(id)) ||
            new Set(scope.placementIds).size !== scope.placementIds.length) {
          fail("permission-denied", "No authorized Employee placement scope for absence availability.");
        }
        const snapshot = await tx.get(recordsRef.where("employeeId", "==", employeeId).where("status", "==", "active").limit(501));
        if (snapshot.size > 500) fail("resource-exhausted", "Absence history exceeds the safe query bound.");
        const allowed = new Set(scope.placementIds);
        const availability = [];
        for (const doc of snapshot.docs) {
          const record = doc.data();
          if (record.accountId !== accountId || record.employeeId !== employeeId ||
              record.status !== "active" || !validId(record.placementId) ||
              !validDate(record.startDate) || !validDate(record.endDate) || record.endDate < record.startDate) {
            fail("failed-precondition", "Malformed canonical absence record.");
          }
          if (!allowed.has(record.placementId) || record.startDate > endDate || record.endDate < startDate) continue;
          availability.push(Object.freeze({
            unavailable: true,
            startDate: record.startDate < startDate ? startDate : record.startDate,
            endDate: record.endDate > endDate ? endDate : record.endDate
          }));
        }
        availability.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate));
        tx.create(auditRef, {
          eventId: "absence-availability-" + eventId,
          type: "employee.absence.availability.read",
          accountId, employeeId, actorUid, occurredAt: timestamp,
          startDate, endDate, returnedIntervals: availability.length
        });
        return Object.freeze({ employeeId, startDate, endDate, availability: Object.freeze(availability) });
      });
    }
  });
}
