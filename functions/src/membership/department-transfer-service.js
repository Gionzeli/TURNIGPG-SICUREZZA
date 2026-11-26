import { validateCanonicalMembership } from "./membership-policy.js";

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const validId = value => typeof value === "string" && ID.test(value);
function fail(code, message) { const error = new Error(message); error.code = code; throw error; }

/** Transaction-aware authorization from the canonical, effective membership. */
async function authorizeFromCanonicalMembership(db, tx, args, nowMs) {
  const ref = db.doc(`accounts/${args.accountId}/members/${args.actorUid}`);
  const snapshot = await tx.get(ref);
  const principal = validateCanonicalMembership(
    snapshot.exists ? snapshot.data() : null, args.actorUid, args.accountId, nowMs
  );
  if (!principal || !principal.permissions.includes("dsm:transfer:departments")) {
    fail("permission-denied", "Active membership with department-transfer permission required.");
  }
  if (principal.role === "admin" && principal.scopeType === "account" && principal.scopeIds.length === 0) return;
  if (principal.role === "manager" && principal.scopeType === "site" &&
      principal.scopeIds.includes(args.sourceSiteId) &&
      principal.scopeIds.includes(args.destinationSiteId)) return;
  fail("permission-denied", "Actor must be scoped to both source and destination sites.");
}

/**
 * Internal-only department transfer. actorUid must be derived from a
 * revocation-checked Firebase ID token by the trusted caller. The default
 * authorizer reloads effective membership inside the same transaction.
 * Audit IDs are generated server-side and the write is atomic with the move.
 */
export async function transferDepartment({
  db, accountId, departmentId, sourceSiteId, destinationSiteId,
  expectedVersion, actorUid, reasonCode, now = () => Date.now(), authorizeActor
}) {
  if (![accountId, departmentId, sourceSiteId, destinationSiteId, actorUid].every(validId) ||
      sourceSiteId === destinationSiteId ||
      !Number.isSafeInteger(expectedVersion) || expectedVersion < 1 ||
      typeof reasonCode !== "string" || !/^[a-z0-9_-]{1,64}$/.test(reasonCode) ||
      (authorizeActor !== undefined && typeof authorizeActor !== "function") ||
      !db || typeof db.doc !== "function" || typeof db.collection !== "function" ||
      typeof db.runTransaction !== "function") {
    fail("invalid-argument", "Invalid department transfer request.");
  }
  const accountRef = db.doc(`accounts/${accountId}`);
  const departmentRef = db.doc(`accounts/${accountId}/departments/${departmentId}`);
  const sourceRef = db.doc(`accounts/${accountId}/sites/${sourceSiteId}`);
  const destinationRef = db.doc(`accounts/${accountId}/sites/${destinationSiteId}`);
  const auditRef = db.collection(`accounts/${accountId}/organizationAudit`).doc();
  return db.runTransaction(async tx => {
    const [accountSnap, departmentSnap, sourceSnap, destinationSnap, auditSnap] = await Promise.all([
      tx.get(accountRef), tx.get(departmentRef), tx.get(sourceRef), tx.get(destinationRef), tx.get(auditRef)
    ]);
    const timestamp = now();
    if (!Number.isSafeInteger(timestamp) || timestamp <= 0) fail("failed-precondition", "Trusted server clock unavailable.");
    const account = accountSnap.exists ? accountSnap.data() : null;
    const department = departmentSnap.exists ? departmentSnap.data() : null;
    const source = sourceSnap.exists ? sourceSnap.data() : null;
    const destination = destinationSnap.exists ? destinationSnap.data() : null;
    const validResource = (snap, data, field, id) => snap.exists &&
      data && data[field] === id && snap.id === id && data.accountId === accountId &&
      data.status === "active" && Number.isSafeInteger(data.version) && data.version >= 1;
    if (!validResource(accountSnap, account, "accountId", accountId) ||
        !Number.isSafeInteger(account.schemaVersion) || account.schemaVersion < 1) {
      fail("failed-precondition", "Active canonical account required.");
    }
    if (!validResource(departmentSnap, department, "departmentId", departmentId) ||
        department.siteId !== sourceSiteId || department.version !== expectedVersion) {
      fail("failed-precondition", "Department is missing, inactive or stale.");
    }
    if (!validResource(sourceSnap, source, "siteId", sourceSiteId) ||
        !validResource(destinationSnap, destination, "siteId", destinationSiteId)) {
      fail("failed-precondition", "Active source and destination sites in the same account are required.");
    }
    if (auditSnap.exists) fail("already-exists", "Audit event collision.");
    const authorizationArgs = {
      accountId, actorUid, permission: "dsm:transfer:departments",
      sourceSiteId, destinationSiteId, departmentId
    };
    if (authorizeActor) await authorizeActor(tx, authorizationArgs);
    else await authorizeFromCanonicalMembership(db, tx, authorizationArgs, timestamp);
    const nextVersion = department.version + 1;
    if (!Number.isSafeInteger(nextVersion)) fail("failed-precondition", "Department version exhausted.");
    tx.update(departmentRef, { siteId: destinationSiteId, version: nextVersion, updatedAt: timestamp });
    tx.create(auditRef, {
      accountId, eventId: auditRef.id, actorUid, action: "department.transferred",
      resourceType: "department", resourceId: departmentId,
      sourceSiteId, destinationSiteId, reasonCode, previousVersion: department.version,
      version: nextVersion, occurredAt: timestamp
    });
    return Object.freeze({
      accountId, departmentId, sourceSiteId, destinationSiteId, version: nextVersion,
      auditEventId: auditRef.id
    });
  });
}
