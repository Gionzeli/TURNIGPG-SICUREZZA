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
const accounts = [
  { accountId: "synthetic-account-01", role: "member" },
  { accountId: "synthetic-account-02", role: "member" }
];
const databaseName = `dsm-canonical-bridge-${crypto.randomUUID()}`;
window.__bridgeDatabaseName = databaseName;
let session;
let controller;
const dependencies = {
  auth, onAuthStateChanged,
  listCanonicalAccounts: async () => accounts,
  readOwnEmployeeEmploymentProfile: async data => ({
    employeeId: "synthetic-employee-01",
    employmentProfile: { ccnl: "HV17", section: "vigilanza_armata", level: "4", role: "Ruolo sintetico", effectiveDate: "2026-09-01" }
  }),
  listOwnEmployeeShiftProposals: async data => [{ proposalId: "synthetic-proposal-01", status: "pending", source: "employee_manual", changeCount: 1, changes: [{ operation: "create", shift: { date: "2026-06-25", type: "turno", post: "Postazione nuova", start_time: "08:00", end_time: "16:00" } }] }],
  approveOwnEmployeeShiftProposal: async data => { window.__approvedProposal = data; return { status: "approved" }; },
  rejectOwnEmployeeShiftProposal: async data => ({ status: "rejected" }),
  proposeOwnEmployeeShiftChanges: async data => { window.__proposedShiftChanges = data; return { status: "pending" }; },
  listOwnEmployeeShifts: async data => {
    window.__shiftQuery = data;
    return [{
      shiftId: "synthetic-shift-01",
      date: data.fromDate,
      type: "turno",
      post: "Postazione sintetica",
      start_time: "08:00",
      end_time: "16:00",
      hours: 8,
      revision: 1
    }];
  },
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
document.querySelector("select").value = accounts[0].accountId;
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
    session.accountContext.getActive()?.accountId !== accounts[0].accountId) {
  throw new Error("Canonical Firebase principal was not activated.");
}
document.documentElement.dataset.bridgeResult = "active";
const shiftPanel = [...root.querySelectorAll("section.card")].find(panel => panel.querySelector("h3")?.textContent === "I miei turni");
if (!shiftPanel || shiftPanel.hidden) throw new Error("Own shifts view was not enabled after account activation.");
await new Promise((resolve, reject) => {
  const started = Date.now();
  const check = () => {
    if (root.textContent.includes("Ruolo sintetico")) return resolve();
    if (Date.now() - started > 5000) return reject(new Error("Own employment profile query timed out."));
    setTimeout(check, 20);
  };
  check();
});
if (!root.textContent.includes("HV17") || !root.textContent.includes("2026-09-01") ||
    root.textContent.includes("compensation")) throw new Error("Employment profile allowlist was not rendered correctly.");
root.querySelector('input[aria-label="Data iniziale"]').value = "2026-06-01";
root.querySelector('input[aria-label="Data finale"]').value = "2026-06-30";
root.querySelector('form').dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
await new Promise((resolve, reject) => {
  const started = Date.now();
  const check = () => {
    if (root.textContent.includes("Postazione sintetica")) return resolve();
    if (Date.now() - started > 5000) return reject(new Error("Own employee shifts query timed out."));
    setTimeout(check, 20);
  };
  check();
});
if (JSON.stringify(window.__shiftQuery) !== JSON.stringify({
  accountId: accounts[0].accountId, fromDate: "2026-06-01", toDate: "2026-06-30"
})) throw new Error("Own shifts callable received unexpected selectors.");
if (root.textContent.includes("synthetic-employee-uid") || root.textContent.includes("compensation")) {
  throw new Error("Own shifts view exposed an identity or non-allowlisted field.");
}
if (shiftPanel.querySelector("tbody button") || root.textContent.includes("Modifica")) {
  throw new Error("Employee calendar must not expose direct mutation before personal proposal approval is implemented.");
}
const accountSelect = root.querySelector("select");
accountSelect.value = accounts[1].accountId;
accountSelect.dispatchEvent(new Event("change", { bubbles: true }));
await new Promise((resolve, reject) => {
  const started = Date.now();
  const check = () => {
    if (root.textContent.includes("Account precedente disconnesso")) return resolve();
    if (Date.now() - started > 5000) return reject(new Error("Previous DSM account was not invalidated."));
    setTimeout(check, 20);
  };
  check();
});
if ([...root.querySelectorAll("section.card")].some(panel => !panel.hidden) ||
    root.textContent.includes("Postazione sintetica") || root.textContent.includes("Ruolo sintetico")) {
  throw new Error("Own shift data remained visible after account switch.");
}
if (session.accountContext.getActive() !== null) {
  throw new Error("Previous DSM account remained active after selection changed.");
}
root.querySelector("button").click();
await new Promise((resolve, reject) => {
  const started = Date.now();
  const check = () => {
    if (root.textContent.includes("synthetic-account-02 collegato.")) return resolve();
    if (Date.now() - started > 5000) return reject(new Error("Second canonical account activation timed out."));
    setTimeout(check, 20);
  };
  check();
});
const manualProposalForm = [...root.querySelectorAll("form")].find(form => form.querySelector('[aria-label="Data turno"]'));
if (!manualProposalForm) throw new Error("Personal manual proposal form is missing.");
manualProposalForm.querySelector('[aria-label="Data turno"]').value = "2026-06-28";
manualProposalForm.querySelector('[aria-label="Tipo turno"]').value = "turno";
manualProposalForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
await new Promise((resolve, reject) => {
  const started = Date.now();
  const check = () => {
    if (window.__proposedShiftChanges?.changes?.[0]?.shift?.date === "2026-06-28") return resolve();
    if (Date.now() - started > 5000) return reject(new Error("Manual shift proposal was not submitted."));
    setTimeout(check, 20);
  };
  check();
});
if (window.__proposedShiftChanges.source !== "employee_manual") {
  throw new Error("Manual proposal provenance was not preserved.");
}
if (session.accountContext.getActive()?.accountId !== accounts[1].accountId) {
  throw new Error("Second canonical account was not activated.");
}

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
