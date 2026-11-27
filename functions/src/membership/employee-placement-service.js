const ID = /^[A-Za-z0-9_-]{1,128}$/;
const validId = value => typeof value === "string" && ID.test(value);
function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function validDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value + "T00:00:00Z")) &&
    new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
}
function overlaps(a, b) {
  const aEnd = a.validUntil ?? "9999-12-31";
  const bEnd = b.validUntil ?? "9999-12-31";
  return a.validFrom < bEnd && b.validFrom < aEnd;
}
function validateInput({ accountId, actorUid, employeeId, placementId, siteId, departmentId, validFrom, validUntil, eventId }) {
  if (![accountId, actorUid, employeeId, placementId, siteId, departmentId, eventId].every(validId) ||
      !validDate(validFrom) || (validUntil !== null && validUntil !== undefined && (!validDate(validUntil) || validUntil <= validFrom))) {
    fail("invalid-argument", "Invalid Employee placement fields.");
  }
}
async function runPlacementTransaction({
  db, accountId, actorUid, actorIdentity, employeeId, placementId, siteId, departmentId,
  validFrom, validUntil = null, eventId, reasonCode, now, loadActiveOrg, authorizeActor, transfer
}) {
  validateInput({ accountId, actorUid, employeeId, placementId, siteId, departmentId, validFrom, validUntil, eventId });
  if (typeof loadActiveOrg !== "function" || typeof authorizeActor !== "function") {
    throw new TypeError("Trusted organization and actor authorization loaders are required.");
  }
  const accountRef = db.doc("accounts/" + accountId);
  const employeeRef = db.doc("accounts/" + accountId + "/employees/" + employeeId);
  const controlRef = db.doc("accounts/" + accountId + "/employeeControl/" + employeeId);
  const placementsRef = db.collection("accounts/" + accountId + "/employees/" + employeeId + "/placements");
  const nextRef = placementsRef.doc(placementId);
  const auditRef = db.doc("accounts/" + accountId + "/employeeAudit/placement-" + eventId);
  return db.runTransaction(async tx => {
    const bindingByEmployeeRef = db.doc("accounts/" + accountId + "/employeeBindingsByEmployee/" + employeeId);
    const [accountSnap, employeeSnap, controlSnap, placementQuery, nextSnap, auditSnap, inverseBindingSnap] = await Promise.all([
      tx.get(accountRef), tx.get(employeeRef), tx.get(controlRef), tx.get(placementsRef.limit(501)),
      tx.get(nextRef), tx.get(auditRef), tx.get(bindingByEmployeeRef)
    ]);
    const timestamp = now();
    if (!Number.isSafeInteger(timestamp)) fail("failed-precondition", "Trusted clock is invalid.");
    if (!accountSnap.exists || accountSnap.data().status !== "active") fail("failed-precondition", "Active account required.");
    if (!employeeSnap.exists || employeeSnap.data().accountId !== accountId ||
        employeeSnap.data().employeeId !== employeeId || employeeSnap.data().status !== "active") fail("failed-precondition", "Active canonical Employee required.");
    if (!controlSnap.exists || controlSnap.data().accountId !== accountId ||
        controlSnap.data().employeeId !== employeeId || !Number.isSafeInteger(controlSnap.data().placementRevision) ||
        controlSnap.data().placementRevision < 0 ||
        !Number.isSafeInteger(controlSnap.data().bindingRevision) || controlSnap.data().bindingRevision < 1) {
      fail("failed-precondition", "Employee control or binding revision is missing or malformed.");
    }
    if (placementQuery.size > 500) fail("resource-exhausted", "Placement history exceeds the safe transaction bound.");
    if (nextSnap.exists || auditSnap.exists) fail("already-exists", "Placement or audit event ID already exists.");
    if (!inverseBindingSnap.exists) fail("permission-denied", "Active Employee binding is required.");
    const inverse = inverseBindingSnap.data();
    if (inverse.accountId !== accountId || inverse.employeeId !== employeeId ||
        inverse.status !== "active" || !validId(inverse.uid) ||
        !Number.isSafeInteger(inverse.revision) || inverse.revision !== controlSnap.data().bindingRevision) {
      fail("permission-denied", "Employee binding reservation is inconsistent or revoked.");
    }
    const bindingByUidRef = db.doc("accounts/" + accountId + "/employeeBindingsByUid/" + inverse.uid);
    const bindingByUidSnap = await tx.get(bindingByUidRef);
    if (!bindingByUidSnap.exists) fail("permission-denied", "Employee UID binding mirror is missing.");
    const forward = bindingByUidSnap.data();
    if (forward.accountId !== accountId || forward.uid !== inverse.uid ||
        forward.employeeId !== employeeId || forward.status !== "active" ||
        forward.revision !== inverse.revision) {
      fail("permission-denied", "Employee binding mirrors do not agree.");
    }
    const existing = placementQuery.docs.map(doc => {
      const data = doc.data();
      if (data.accountId !== accountId || data.employeeId !== employeeId ||
          data.placementId !== doc.id || !validId(data.siteId) || !validId(data.departmentId) ||
          !validDate(data.validFrom) ||
          (data.validUntil !== null && (!validDate(data.validUntil) || data.validUntil <= data.validFrom)) ||
          !Number.isSafeInteger(data.revision) || data.revision < 1) {
        fail("failed-precondition", "Malformed historical Employee placement.");
      }
      return { id: doc.id, ...data };
    });
    if (!transfer && existing.length !== 0) fail("failed-precondition", "Initial placement requires empty placement history.");
    const org = await loadActiveOrg(tx, accountId, siteId, departmentId);
    if (!org || org.accountId !== accountId || org.siteId !== siteId ||
        org.departmentId !== departmentId || org.status !== "active" ||
        org.siteStatus !== "active" || org.departmentStatus !== "active") {
      fail("failed-precondition", "Active canonical site and department required.");
    }
    await authorizeActor(tx, { accountId, actorUid, actorIdentity, employeeId, operation: transfer ? "transfer" : "create" });
    let previous = null;
    if (transfer) {
      const matches = existing.filter(p => p.validFrom <= validFrom &&
        (p.validUntil === null || p.validUntil > validFrom));
      if (matches.length !== 1) fail("failed-precondition", "Current placement is missing or ambiguous at transfer date.");
      previous = matches[0];
      if (previous.validFrom === validFrom) fail("failed-precondition", "Transfer cannot reuse an existing placement boundary.");
    }
    const candidate = { accountId, employeeId, placementId, siteId, departmentId, validFrom, validUntil };
    for (const item of existing) {
      if (previous && item.id === previous.id) continue;
      if (overlaps(item, candidate)) fail("already-exists", "Employee placement interval overlaps existing history.");
    }
    const revision = controlSnap.data().placementRevision + 1;
    if (!Number.isSafeInteger(revision)) fail("failed-precondition", "Placement revision exhausted.");
    if (previous) {
      const previousRef = placementsRef.doc(previous.id);
      const previousRevision = previous.revision + 1;
      if (!Number.isSafeInteger(previousRevision)) fail("failed-precondition", "Previous placement revision exhausted.");
      tx.update(previousRef, { validUntil: validFrom, revision: previousRevision, updatedAt: timestamp });
    }
    tx.create(nextRef, { ...candidate, revision: 1, createdAt: timestamp, createdBy: actorUid });
    tx.update(controlRef, { placementRevision: revision, updatedAt: timestamp });
    tx.create(auditRef, {
      eventId: "placement-" + eventId, type: transfer ? "employee.placement.transferred" : "employee.placement.created",
      accountId, employeeId, placementId, actorUid, reasonCode,
      previousPlacementId: previous?.id ?? null, occurredAt: timestamp, revision
    });
    return Object.freeze({ accountId, employeeId, placementId, siteId, departmentId, validFrom, validUntil, revision });
  });
}

/** Internal service: callers must inject trusted transaction-aware authorization and org loaders. */
export async function createInitialEmployeePlacement(args) {
  return runPlacementTransaction({ ...args, validUntil: args.validUntil ?? null, reasonCode: "initial-placement", transfer: false });
}
export async function transferEmployeePlacement(args) {
  return runPlacementTransaction({ ...args, validUntil: null, reasonCode: "employee-transfer", transfer: true });
}
