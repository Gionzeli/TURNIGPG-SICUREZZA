import { resolveOwnEmployeeBinding } from "./employee-binding.js";

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const validId = value => typeof value === "string" && ID_PATTERN.test(value);

/**
 * Firestore-backed, server-only loaders for the canonical Employee binding.
 * The two deterministic reservation documents must agree exactly. Admin SDK
 * access is trusted server code; this adapter must never be called with a
 * client-selected employeeId as proof of ownership.
 */
export function createEmployeeFirestoreLoaders(db) {
  if (!db || typeof db.doc !== "function" || typeof db.runTransaction !== "function") {
    throw new TypeError("A trusted Firestore Admin database is required.");
  }

  return Object.freeze({
    async loadBinding(accountId, uid) {
      if (!validId(accountId) || !validId(uid)) return null;
      const byUidRef = db.doc(`accounts/${accountId}/employeeBindingsByUid/${uid}`);
      return db.runTransaction(async tx => {
        const byUid = await tx.get(byUidRef);
        if (!byUid.exists) return null;
        const data = byUid.data();
        if (!validId(data.employeeId)) return null;
        const byEmployeeRef = db.doc(
          `accounts/${accountId}/employeeBindingsByEmployee/${data.employeeId}`
        );
        const byEmployee = await tx.get(byEmployeeRef);
        if (!byEmployee.exists) return null;
        const inverse = byEmployee.data();
        const valid = data.accountId === accountId && data.uid === uid &&
          data.status === "active" && Number.isSafeInteger(data.revision) && data.revision > 0 &&
          inverse.accountId === accountId && inverse.uid === uid &&
          inverse.employeeId === data.employeeId && inverse.status === "active" &&
          inverse.revision === data.revision;
        if (!valid) return null;
        return {
          uid,
          accountId,
          profileId: data.employeeId,
          status: "active",
          revision: data.revision
        };
      });
    },

    async loadActiveProfile(accountId, profileId) {
      if (!validId(accountId) || !validId(profileId)) return null;
      const snapshot = await db.doc(`accounts/${accountId}/employees/${profileId}`).get();
      if (!snapshot.exists) return null;
      const employee = snapshot.data();
      if (employee.accountId !== accountId || employee.employeeId !== profileId) return null;
      return {
        accountId,
        profileId,
        active: employee.status === "active"
      };
    }
  });
}

/** Resolve only the verified member's Employee; no employee selector is accepted. */
export async function resolveOwnEmployeeFromFirestore({ db, principal }) {
  const loaders = createEmployeeFirestoreLoaders(db);
  return resolveOwnEmployeeBinding({ principal, ...loaders });
}
