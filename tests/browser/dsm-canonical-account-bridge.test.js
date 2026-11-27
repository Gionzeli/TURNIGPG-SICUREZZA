import { mountDSMCanonicalAccountBridge } from "../../src/ui/dsm-canonical-account-bridge.js";
import { createFirebaseAuthAdapter } from "../../src/adapters/firebase/firebase-auth-adapter.js";
import { openDSMDatabase, closeDSMDatabase, createDSMCoreSession } from "../../src/core/database/index.js";

const root = document.querySelector("#bridge-root");
const auth = { currentUser: {
  uid: "synthetic-employee-uid", email: "employee@example.test", emailVerified: true,
  getIdToken: async () => "synthetic-firebase-id-token"
}};
const listeners = new Set();
const onAuthStateChanged = (_auth, callback) => {
  listeners.add(callback);
  queueMicrotask(() => callback(auth.currentUser));
  return () => listeners.delete(callback);
};
const account = { accountId: "synthetic-account-01", role: "member" };
const databaseName = `dsm-canonical-bridge-${crypto.randomUUID()}`;
window.__bridgeDatabaseName = databaseName;
let session;
let controller;
const dependencies = {
  auth, onAuthStateChanged,
  listCanonicalAccounts: async () => [account],
  resolveAuthorization: async ({ uid, accountId }) => ({
    principal: {
      uid, accountId, role: "member", status: "active",
      permissions: ["dsm:read:own-scope"]
    },
    authorizationSource: "server",
    expiresAt: Date.now() + 60_000
  }),
  createAuthAdapter: options => createFirebaseAuthAdapter(options),
  openDatabase: () => openDSMDatabase({ name: databaseName }),
  closeDatabase: () => closeDSMDatabase(),
  createSession: async options => {
    session = await createDSMCoreSession(options);
    window.__bridgeSession = session;
    return session;
  }
};

controller = mountDSMCanonicalAccountBridge(root, dependencies);
await new Promise(resolve => setTimeout(resolve, 0));
document.documentElement.dataset.bridgeResult = "accounts";
document.querySelector("select").value = account.accountId;
document.querySelector("select").dispatchEvent(new Event("change", { bubbles: true }));
document.querySelector("button").click();
await new Promise((resolve, reject) => {
  const started = Date.now();
  const check = () => {
    if (root.textContent.includes("collegato.")) return resolve();
    if (Date.now() - started > 5000) return reject(new Error("Bridge activation timed out."));
    setTimeout(check, 20);
  };
  check();
});
if (session?.accountContext.getActive()?.identitySource !== "firebase" ||
    session.accountContext.getActive()?.accountId !== account.accountId) {
  throw new Error("Canonical Firebase principal was not activated.");
}
document.documentElement.dataset.bridgeResult = "active";

await controller.destroy();
if (listeners.size !== 0) throw new Error("Auth listeners were not removed during teardown.");
await new Promise((resolve, reject) => {
  const request = indexedDB.deleteDatabase(databaseName);
  request.onsuccess = () => resolve();
  request.onerror = () => reject(request.error);
  request.onblocked = () => reject(new Error("DSM bridge test database deletion blocked."));
});
const noMembership = mountDSMCanonicalAccountBridge(root, {
  ...dependencies,
  listCanonicalAccounts: async () => []
});
await new Promise((resolve, reject) => {
  const started = Date.now();
  const check = () => {
    if (root.textContent.includes("non esiste ancora un'appartenenza DSM canonica")) return resolve();
    if (Date.now() - started > 5000) return reject(new Error("Missing canonical membership state timed out."));
    setTimeout(check, 20);
  };
  check();
});
if (!root.querySelector("button").disabled) throw new Error("Missing canonical membership must keep DSM activation disabled.");
await noMembership.destroy();
document.documentElement.dataset.bridgeResult = "complete";
