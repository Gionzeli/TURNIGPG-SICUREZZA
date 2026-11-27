import { validateCanonicalMembership } from "./membership-policy.js";
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const validId = value => typeof value === "string" && ID.test(value);
function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function requireAdmin(membership, uid, accountId, identity, nowMs) {
  if (!Number.isSafeInteger(nowMs) || !identity || identity.uid !== uid || identity.emailVerified !== true || !Number.isSafeInteger(identity.authTime)) fail("permission-denied", "A verified recent TOTP admin identity is required.");
  const age = Math.floor(nowMs / 1000) - identity.authTime;
  if (age < 0 || age > 300 || identity.secondFactor !== "totp") fail("permission-denied", "A verified recent TOTP admin identity is required.");
  const actor = validateCanonicalMembership(membership, uid, accountId);
  if (!actor || actor.role !== "admin") fail("permission-denied", "Active account admin required.");
}
export async function revokeEmployeeBinding({ db, accountId, actorUid, actorIdentity, employeeId, eventId, now = () => Date.now() }) {
  if (![accountId, actorUid, employeeId, eventId].every(validId)) fail("invalid-argument", "Invalid Employee binding revocation selector.");
  const accountRef = db.doc("accounts/" + accountId);
  const actorRef = db.doc("accounts/" + accountId + "/members/" + actorUid);
  const employeeRef = db.doc("accounts/" + accountId + "/employees/" + employeeId);
  const byEmployeeRef = db.doc("accounts/" + accountId + "/employeeBindingsByEmployee/" + employeeId);
  const auditRef = db.doc("accounts/" + accountId + "/employeeAudit/revoke-binding-" + eventId);
  return db.runTransaction(async tx => {
    const [accountSnap, actorSnap, employeeSnap, byEmployeeSnap, auditSnap] = await Promise.all([tx.get(accountRef), tx.get(actorRef), tx.get(employeeRef), tx.get(byEmployeeRef), tx.get(auditRef)]);
    const timestamp = now();
    if (!accountSnap.exists || accountSnap.data().status !== "active") fail("failed-precondition", "Active account required.");
    requireAdmin(actorSnap.exists ? actorSnap.data() : null, actorUid, accountId, actorIdentity, timestamp);
    if (!employeeSnap.exists || !byEmployeeSnap.exists) fail("not-found", "Active Employee binding not found.");
    if (auditSnap.exists) fail("already-exists", "Audit event ID already used.");
    const employee = employeeSnap.data(), inverse = byEmployeeSnap.data();
    if (employee.accountId !== accountId || employee.employeeId !== employeeId || employee.status !== "active") fail("failed-precondition", "Employee is not active or canonical.");
    if (inverse.accountId !== accountId || inverse.employeeId !== employeeId || inverse.status !== "active" || !validId(inverse.uid) || !Number.isSafeInteger(inverse.revision) || inverse.revision < 1) fail("failed-precondition", "Employee binding reservation is inconsistent.");
    const byUidRef = db.doc("accounts/" + accountId + "/employeeBindingsByUid/" + inverse.uid);
    const controlRef = db.doc("accounts/" + accountId + "/employeeControl/" + employeeId);
    const [byUidSnap, controlSnap] = await Promise.all([tx.get(byUidRef), tx.get(controlRef)]);
    if (!byUidSnap.exists || !controlSnap.exists) fail("failed-precondition", "Binding control or mirror is missing.");
    const forward = byUidSnap.data(), control = controlSnap.data();
    if (forward.accountId !== accountId || forward.uid !== inverse.uid || forward.employeeId !== employeeId || forward.status !== "active" || forward.revision !== inverse.revision || control.accountId !== accountId || control.employeeId !== employeeId || control.bindingRevision !== inverse.revision) fail("failed-precondition", "UID/Employee binding mirrors or control revision disagree.");
    const nextRevision = inverse.revision + 1;
    if (!Number.isSafeInteger(nextRevision)) fail("failed-precondition", "Binding revision exhausted.");
    tx.update(byUidRef, { status: "revoked", revision: nextRevision, revokedAt: timestamp, revokedBy: actorUid });
    tx.update(byEmployeeRef, { status: "revoked", revision: nextRevision, revokedAt: timestamp, revokedBy: actorUid });
    tx.update(controlRef, { bindingRevision: nextRevision, updatedAt: timestamp });
    tx.create(auditRef, { eventId: "revoke-binding-" + eventId, type: "employee.binding.revoked", accountId, employeeId, targetUid: inverse.uid, actorUid, occurredAt: timestamp, previousRevision: inverse.revision, revision: nextRevision });
    return Object.freeze({ status: "revoked", accountId, employeeId, uid: inverse.uid, revision: nextRevision });
  });
}
