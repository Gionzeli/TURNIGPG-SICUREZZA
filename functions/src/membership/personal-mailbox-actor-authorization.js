import { resolveCanonicalMembership } from "./membership-policy.js";

const ID = /^[A-Za-z0-9_-]{1,128}$/;
function deny(message = "Active canonical employee membership is required.") {
  const error = new Error(message);
  error.code = "permission-denied";
  throw error;
}
function validId(value) { return typeof value === "string" && ID.test(value); }

/**
 * Server-only actor resolver for the personal mailbox lifecycle.
 * The caller MUST verify the Firebase ID token (including revocation) before
 * invoking the mailbox service. This resolver independently reloads the
 * current Auth user and canonical account, membership and reciprocal Employee
 * binding; no client-selected Employee ID or role is accepted.
 */
export function createPersonalMailboxActorAuthorizer({ db, auth, now = () => Date.now() }) {
  if (!db || typeof db.doc !== "function" || typeof db.runTransaction !== "function" ||
      !auth || typeof auth.getUser !== "function") {
    throw new TypeError("Trusted Firestore and Firebase Auth Admin clients are required.");
  }

  return async function authorizeActor({ accountId, actorUid, mode }) {
    if (!validId(accountId) || !validId(actorUid) || mode !== "personal") {
      deny("Only an authenticated personal Employee mailbox is supported.");
    }
    let user;
    try { user = await auth.getUser(actorUid); } catch { deny(); }
    if (user.uid !== actorUid || user.disabled === true || user.emailVerified !== true ||
        typeof user.email !== "string" || user.email.length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email.trim().toLowerCase())) deny();

    const timestamp = now();
    if (!Number.isSafeInteger(timestamp)) deny();
    return db.runTransaction(async tx => {
      const accountRef = db.doc(`accounts/${accountId}`);
      const memberRef = db.doc(`accounts/${accountId}/members/${actorUid}`);
      const [accountSnap, memberSnap] = await Promise.all([
        tx.get(accountRef), tx.get(memberRef)
      ]);
      if (!accountSnap.exists || !memberSnap.exists) deny();
      const account = accountSnap.data();
      if (account.accountId !== accountId || account.status !== "active" ||
          !Number.isSafeInteger(account.schemaVersion) || account.schemaVersion < 1 ||
          !Number.isSafeInteger(account.version) || account.version < 1) deny();
      const membership = resolveCanonicalMembership({
        uid: actorUid, accountId, membership: memberSnap.data(), nowMs: timestamp
      });
      if (!membership || membership.role !== "member" ||
          !membership.permissions.includes("dsm:read:own-scope")) deny();

      const byUidRef = db.doc(`accounts/${accountId}/employeeBindingsByUid/${actorUid}`);
      const byUidSnap = await tx.get(byUidRef);
      if (!byUidSnap.exists) deny();
      const byUid = byUidSnap.data();
      if (!validId(byUid.employeeId) || byUid.accountId !== accountId ||
          byUid.uid !== actorUid || byUid.status !== "active" ||
          !Number.isSafeInteger(byUid.revision) || byUid.revision < 1) deny();

      const byEmployeeRef = db.doc(
        `accounts/${accountId}/employeeBindingsByEmployee/${byUid.employeeId}`
      );
      const employeeRef = db.doc(`accounts/${accountId}/employees/${byUid.employeeId}`);
      const [byEmployeeSnap, employeeSnap] = await Promise.all([
        tx.get(byEmployeeRef), tx.get(employeeRef)
      ]);
      if (!byEmployeeSnap.exists || !employeeSnap.exists) deny();
      const inverse = byEmployeeSnap.data();
      const employee = employeeSnap.data();
      if (inverse.accountId !== accountId || inverse.uid !== actorUid ||
          inverse.employeeId !== byUid.employeeId || inverse.status !== "active" ||
          inverse.revision !== byUid.revision ||
          employee.accountId !== accountId || employee.employeeId !== byUid.employeeId ||
          employee.status !== "active") deny();

      return Object.freeze({
        accountId, uid: actorUid, status: "active", role: membership.role,
        employeeId: byUid.employeeId, email: user.email.trim().toLowerCase(),
        permissions: membership.permissions
      });
    });
  };
}
