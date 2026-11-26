import { FieldPath } from "firebase-admin/firestore";

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const validId = value => typeof value === "string" && ID.test(value);
function deny() {
  const error = new Error("Active canonical organization resource required.");
  error.code = "permission-denied";
  throw error;
}
function validDoc(snapshot, idField, expectedId, accountId) {
  if (!snapshot?.exists) return null;
  const data = snapshot.data();
  if (!data || typeof data !== "object" || Array.isArray(data) ||
      data[idField] !== expectedId || data.accountId !== accountId ||
      snapshot.id !== expectedId || !["active", "archived"].includes(data.status) ||
      !Number.isSafeInteger(data.version) || data.version < 1) return null;
  return data;
}

/** Server-only adapter for the approved flat account/sites/departments hierarchy. */
export function createOrganizationFirestoreLoaders(db) {
  if (!db || typeof db.doc !== "function") throw new TypeError("Trusted Firestore Admin database required.");
  const accountRef = accountId => db.doc(`accounts/${accountId}`);
  const siteRef = (accountId, siteId) => db.doc(`accounts/${accountId}/sites/${siteId}`);
  const departmentRef = (accountId, departmentId) => db.doc(`accounts/${accountId}/departments/${departmentId}`);

  return Object.freeze({
    async loadAccount(accountId) {
      if (!validId(accountId)) return null;
      const snap = await accountRef(accountId).get();
      return validDoc(snap, "accountId", accountId, accountId);
    },
    async loadSite(accountId, siteId) {
      if (!validId(accountId) || !validId(siteId)) return null;
      const [account, site] = await Promise.all([accountRef(accountId).get(), siteRef(accountId, siteId).get()]);
      const a = validDoc(account, "accountId", accountId, accountId);
      const s = validDoc(site, "siteId", siteId, accountId);
      return a?.status === "active" && s?.status === "active" ? s : null;
    },
    async loadDepartment(accountId, siteId, departmentId) {
      if (![accountId, siteId, departmentId].every(validId)) return null;
      const [account, site, department] = await Promise.all([
        accountRef(accountId).get(), siteRef(accountId, siteId).get(), departmentRef(accountId, departmentId).get()
      ]);
      const a = validDoc(account, "accountId", accountId, accountId);
      const s = validDoc(site, "siteId", siteId, accountId);
      const d = validDoc(department, "departmentId", departmentId, accountId);
      return a?.status === "active" && s?.status === "active" &&
        d?.status === "active" && d.siteId === siteId ? d : null;
    },
    async loadActiveOrg(tx, accountId, siteId, departmentId) {
      if (![accountId, siteId, departmentId].every(validId)) return null;
      const refs = [accountRef(accountId), siteRef(accountId, siteId), departmentRef(accountId, departmentId)];
      const [account, site, department] = await Promise.all(refs.map(ref => tx.get(ref)));
      const a = validDoc(account, "accountId", accountId, accountId);
      const s = validDoc(site, "siteId", siteId, accountId);
      const d = validDoc(department, "departmentId", departmentId, accountId);
      if (a?.status !== "active" || s?.status !== "active" ||
          d?.status !== "active" || d.siteId !== siteId) return null;
      return {
        accountId, siteId, departmentId,
        status: "active", siteStatus: "active", departmentStatus: "active"
      };
    }
  });
}

/** Expose only canonical path constructors to trusted backend services. */
export const organizationDocumentPaths = Object.freeze({
  account: accountId => validId(accountId) ? `accounts/${accountId}` : deny(),
  site: (accountId, siteId) => [accountId, siteId].every(validId) ? `accounts/${accountId}/sites/${siteId}` : deny(),
  department: (accountId, departmentId) => [accountId, departmentId].every(validId) ? `accounts/${accountId}/departments/${departmentId}` : deny()
});
