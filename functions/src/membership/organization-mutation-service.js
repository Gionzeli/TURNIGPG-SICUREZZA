import { validateCanonicalMembership } from "./membership-policy.js";

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const ISO_DATE = /^\\d{4}-\\d{2}-\\d{2}$/;
function validDate(value) {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const d = new Date(value + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
const validId = value => typeof value === "string" && ID.test(value);
function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function validLabel(value) { return typeof value === "string" && value.trim().length >= 1 && value.trim().length <= 120; }
function validReason(value) { return typeof value === "string" && /^[a-z0-9_-]{1,64}$/.test(value); }
function validAccount(snap, accountId) {
  if (!snap.exists) return false;
  const a = snap.data();
  return a.accountId === accountId && snap.id === accountId && a.status === "active" &&
    Number.isSafeInteger(a.schemaVersion) && a.schemaVersion > 0 &&
    Number.isSafeInteger(a.version) && a.version > 0;
}
function validResource(snap, accountId, field, id) {
  if (!snap.exists) return false;
  const d = snap.data();
  return d[field] === id && snap.id === id && d.accountId === accountId &&
    d.status === "active" && Number.isSafeInteger(d.version) && d.version > 0;
}
async function actorPrincipal(db, tx, accountId, actorUid, nowMs) {
  const ref = db.doc(`accounts/${accountId}/members/${actorUid}`);
  const snap = await tx.get(ref);
  const principal = validateCanonicalMembership(snap.exists ? snap.data() : null, actorUid, accountId, nowMs);
  if (!principal) fail("permission-denied", "Active effective account membership required.");
  return principal;
}
function requirePermission(principal, permission, siteId = null) {
  if (principal.role === "admin" && principal.scopeType === "account" &&
      principal.permissions.includes("dsm:manage:account")) return;
  if (principal.role === "manager" && siteId !== null &&
      principal.scopeType === "site" && principal.scopeIds.includes(siteId) &&
      principal.permissions.includes(permission)) return;
  fail("permission-denied", "Operation is outside the actor's canonical permission or scope.");
}
function auditRecord({ accountId, actorUid, action, resourceType, resourceId, reasonCode, previousVersion, version, eventId, timestamp, siteId = null }) {
  return {
    accountId, eventId, actorUid, action, resourceType, resourceId, reasonCode,
    previousVersion, version, siteId, occurredAt: new Date(timestamp)
  };
}

/** Internal transaction services. actorUid must come from a revocation-checked token. */
export async function createSite({ db, accountId, actorUid, displayName, reasonCode, now = () => Date.now() }) {
  if (![accountId, actorUid].every(validId) || !validLabel(displayName) || !validReason(reasonCode)) fail("invalid-argument", "Invalid site creation fields.");
  const ref = db.collection(`accounts/${accountId}/sites`).doc();
  const auditRef = db.collection(`accounts/${accountId}/organizationAudit`).doc();
  return db.runTransaction(async tx => {
    const [accountSnap, auditSnap] = await Promise.all([tx.get(db.doc(`accounts/${accountId}`)), tx.get(auditRef)]);
    const timestamp = now();
    if (!Number.isSafeInteger(timestamp) || timestamp <= 0) fail("failed-precondition", "Trusted server clock unavailable.");
    if (!validAccount(accountSnap, accountId)) fail("failed-precondition", "Active canonical account required.");
    if (auditSnap.exists) fail("already-exists", "Audit ID collision.");
    const principal = await actorPrincipal(db, tx, accountId, actorUid, timestamp);
    requirePermission(principal, "dsm:manage:account");
    tx.create(ref, {
      accountId, siteId: ref.id, displayName: displayName.trim(),
      status: "active", version: 1, createdAt: new Date(timestamp), updatedAt: new Date(timestamp)
    });
    tx.create(auditRef, auditRecord({
      accountId, actorUid, action: "site.created", resourceType: "site", resourceId: ref.id,
      reasonCode, previousVersion: null, version: 1, eventId: auditRef.id, timestamp
    }));
    return Object.freeze({ accountId, siteId: ref.id, version: 1, auditEventId: auditRef.id });
  });
}

export async function createDepartment({ db, accountId, actorUid, siteId, displayName, reasonCode, now = () => Date.now() }) {
  if (![accountId, actorUid, siteId].every(validId) || !validLabel(displayName) || !validReason(reasonCode)) fail("invalid-argument", "Invalid department creation fields.");
  const ref = db.collection(`accounts/${accountId}/departments`).doc();
  const auditRef = db.collection(`accounts/${accountId}/organizationAudit`).doc();
  return db.runTransaction(async tx => {
    const [accountSnap, siteSnap, auditSnap] = await Promise.all([
      tx.get(db.doc(`accounts/${accountId}`)), tx.get(db.doc(`accounts/${accountId}/sites/${siteId}`)), tx.get(auditRef)
    ]);
    const timestamp = now();
    if (!Number.isSafeInteger(timestamp) || timestamp <= 0) fail("failed-precondition", "Trusted server clock unavailable.");
    if (!validAccount(accountSnap, accountId) || !validResource(siteSnap, accountId, "siteId", siteId)) {
      fail("failed-precondition", "Active canonical account and site required.");
    }
    if (auditSnap.exists) fail("already-exists", "Audit ID collision.");
    const principal = await actorPrincipal(db, tx, accountId, actorUid, timestamp);
    requirePermission(principal, "dsm:manage:departments", siteId);
    tx.create(ref, {
      accountId, departmentId: ref.id, siteId, displayName: displayName.trim(),
      status: "active", version: 1, createdAt: new Date(timestamp), updatedAt: new Date(timestamp)
    });
    tx.create(auditRef, auditRecord({
      accountId, actorUid, action: "department.created", resourceType: "department", resourceId: ref.id,
      reasonCode, previousVersion: null, version: 1, eventId: auditRef.id, timestamp, siteId
    }));
    return Object.freeze({ accountId, departmentId: ref.id, siteId, version: 1, auditEventId: auditRef.id });
  });
}

export async function archiveDepartment({ db, accountId, actorUid, departmentId, reasonCode, now = () => Date.now() }) {
  if (![accountId, actorUid, departmentId].every(validId) || !validReason(reasonCode)) fail("invalid-argument", "Invalid department archive fields.");
  const departmentRef = db.doc(`accounts/${accountId}/departments/${departmentId}`);
  const auditRef = db.collection(`accounts/${accountId}/organizationAudit`).doc();
  const placementsQuery = db.collectionGroup("placements").where("departmentId", "==", departmentId);
  const membersQuery = db.collection(`accounts/${accountId}/members`).where("scopeIds", "array-contains", departmentId);
  return db.runTransaction(async tx => {
    const [accountSnap, departmentSnap, placementSnap, memberSnap, auditSnap] = await Promise.all([
      tx.get(db.doc(`accounts/${accountId}`)), tx.get(departmentRef), tx.get(placementsQuery),
      tx.get(membersQuery), tx.get(auditRef)
    ]);
    const timestamp = now();
    if (!Number.isSafeInteger(timestamp) || timestamp <= 0) fail("failed-precondition", "Trusted server clock unavailable.");
    if (!validAccount(accountSnap, accountId) || !validResource(departmentSnap, accountId, "departmentId", departmentId)) {
      fail("failed-precondition", "Active canonical account and department required.");
    }
    const department = departmentSnap.data();
    if (!validId(department.siteId)) fail("failed-precondition", "Department has no canonical parent site.");
    const parentSiteSnap = await tx.get(db.doc(`accounts/${accountId}/sites/${department.siteId}`));
    if (!validResource(parentSiteSnap, accountId, "siteId", department.siteId)) {
      fail("failed-precondition", "Department parent site must be active and canonical.");
    }
    if (auditSnap.exists) fail("already-exists", "Audit ID collision.");
    const principal = await actorPrincipal(db, tx, accountId, actorUid, timestamp);
    if (principal.role !== "admin" || !principal.permissions.includes("dsm:archive:department")) {
      fail("permission-denied", "Account admin with department-archive permission required.");
    }
    for (const doc of placementSnap.docs) {
      const d = doc.data();
      if (d.accountId !== accountId || d.departmentId !== departmentId) continue;
      if (!validId(d.employeeId) || !validId(d.placementId) ||
          !validDate(d.validFrom) ||
          (d.validUntil !== null && (!validDate(d.validUntil) || d.validUntil <= d.validFrom))) {
        fail("failed-precondition", "Malformed Employee placement prevents department archival.");
      }
      if (d.validUntil === null) fail("failed-precondition", "Transfer or close current Employee placements before archiving the department.");
    }
    const hasMemberAssignment = memberSnap.docs.some(doc => {
      const m = validateCanonicalMembership(doc.data(), doc.id, accountId, timestamp);
      return m?.role === "member" && m.scopeType === "department" && m.scopeIds.includes(departmentId);
    });
    if (hasMemberAssignment) fail("failed-precondition", "Revoke or reassign active member scopes before archiving the department.");
    const version = department.version + 1;
    if (!Number.isSafeInteger(version)) fail("failed-precondition", "Department version exhausted.");
    tx.update(departmentRef, { status: "archived", version, updatedAt: new Date(timestamp) });
    tx.create(auditRef, auditRecord({
      accountId, actorUid, action: "department.archived", resourceType: "department", resourceId: departmentId,
      reasonCode, previousVersion: department.version, version, eventId: auditRef.id, timestamp, siteId: department.siteId
    }));
    return Object.freeze({ accountId, departmentId, status: "archived", version, auditEventId: auditRef.id });
  });
}

export async function archiveSite({ db, accountId, actorUid, siteId, reasonCode, now = () => Date.now() }) {
  if (![accountId, actorUid, siteId].every(validId) || !validReason(reasonCode)) fail("invalid-argument", "Invalid site archive fields.");
  const siteRef = db.doc(`accounts/${accountId}/sites/${siteId}`);
  const auditRef = db.collection(`accounts/${accountId}/organizationAudit`).doc();
  const departmentsQuery = db.collection(`accounts/${accountId}/departments`).where("siteId", "==", siteId);
  const membersQuery = db.collection(`accounts/${accountId}/members`).where("scopeIds", "array-contains", siteId);
  return db.runTransaction(async tx => {
    const [accountSnap, siteSnap, departmentSnap, memberSnap, auditSnap] = await Promise.all([
      tx.get(db.doc(`accounts/${accountId}`)), tx.get(siteRef), tx.get(departmentsQuery),
      tx.get(membersQuery), tx.get(auditRef)
    ]);
    const timestamp = now();
    if (!Number.isSafeInteger(timestamp) || timestamp <= 0) fail("failed-precondition", "Trusted server clock unavailable.");
    if (!validAccount(accountSnap, accountId) || !validResource(siteSnap, accountId, "siteId", siteId)) {
      fail("failed-precondition", "Active canonical account and site required.");
    }
    if (auditSnap.exists) fail("already-exists", "Audit ID collision.");
    const principal = await actorPrincipal(db, tx, accountId, actorUid, timestamp);
    if (principal.role !== "admin" || !principal.permissions.includes("dsm:archive:site")) {
      fail("permission-denied", "Account admin with site-archive permission required.");
    }
    if (departmentSnap.docs.some(doc => doc.data().accountId === accountId && doc.data().status === "active")) {
      fail("failed-precondition", "Transfer or archive active departments before archiving the site.");
    }
    const hasActiveAssignment = memberSnap.docs.some(doc => {
      const m = validateCanonicalMembership(doc.data(), doc.id, accountId, timestamp);
      return m && m.scopeType === "site" && m.scopeIds.includes(siteId);
    });
    if (hasActiveAssignment) fail("failed-precondition", "Revoke or reassign active site memberships before archiving the site.");
    const site = siteSnap.data(), version = site.version + 1;
    if (!Number.isSafeInteger(version)) fail("failed-precondition", "Site version exhausted.");
    tx.update(siteRef, { status: "archived", version, updatedAt: new Date(timestamp) });
    tx.create(auditRef, auditRecord({
      accountId, actorUid, action: "site.archived", resourceType: "site", resourceId: siteId,
      reasonCode, previousVersion: site.version, version, eventId: auditRef.id, timestamp
    }));
    return Object.freeze({ accountId, siteId, status: "archived", version, auditEventId: auditRef.id });
  });
}
