import { mountDSMMembershipInvitePage } from "../../src/ui/dsm-membership-invite-page.js";

const root = document.getElementById("invite-root");
const summary = document.getElementById("summary");
const calls = [];
const auth = { currentUser: { uid: "synthetic-invite-user", emailVerified: true } };
const listeners = new Set();
const controller = mountDSMMembershipInvitePage(root, {
  auth,
  onAuthStateChanged(_auth, callback) {
    listeners.add(callback);
    callback(auth.currentUser);
    return () => listeners.delete(callback);
  },
  proposeInvite: async data => { calls.push(["propose", data]); return { status: "pending" }; },
  approveInvite: async data => { calls.push(["approve", data]); return { status: "approved_pending_claim" }; },
  claimInvite: async data => { calls.push(["claim", data]); return { status: "claimed" }; }
});
try {
  const inputs = root.querySelectorAll("input");
  inputs[1].value = "invite-ui-test";
  inputs[2].value = "site-synthetic";
  inputs[3].value = "person@example.test";
  root.querySelector("button").click();
  await new Promise(resolve => setTimeout(resolve, 0));
  if (calls[0]?.[0] !== "propose" || calls[0][1].email !== "person@example.test") throw new Error("Proposta UI non inoltrata correttamente.");
  root.querySelectorAll("button")[1].click();
  await new Promise(resolve => setTimeout(resolve, 0));
  if (calls[1]?.[0] !== "approve" || calls[1][1].inviteId !== "invite-ui-test") throw new Error("Approvazione UI non inoltrata correttamente.");
  inputs[4].value = "invite-ui-test";
  root.querySelectorAll("button")[2].click();
  await new Promise(resolve => setTimeout(resolve, 0));
  if (calls[2]?.[0] !== "claim" || calls[2][1].inviteId !== "invite-ui-test") throw new Error("Riscatto UI non inoltrato correttamente.");
  auth.currentUser = { uid: "synthetic-invite-user", emailVerified: false };
  for (const listener of listeners) listener(auth.currentUser);
  if (!root.querySelector("button").disabled) throw new Error("UI non blocca identità non verificata.");
  summary.textContent = "PASS — UI inviti: proposta, approvazione, riscatto e blocco identità non verificata";
  summary.dataset.result = "pass";
} catch (error) {
  summary.textContent = error.stack || error.message;
  summary.dataset.result = "fail";
} finally {
  controller.destroy();
}
