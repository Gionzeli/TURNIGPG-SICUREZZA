import { auth, watchAuth } from "../../firebase-client.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js";
import { createFirebaseAuthAdapter } from "../adapters/firebase/firebase-auth-adapter.js";
import { openDSMDatabase, closeDSMDatabase, createDSMCoreSession } from "../core/database/index.js";
import { mountDSMCanonicalAccountBridge } from "./dsm-canonical-account-bridge.js";
import { mountDSMMembershipInvitePage } from "./dsm-membership-invite-page.js";

const root = document.getElementById("dsm-canonical-account-root");
if (!root) throw new Error("Contenitore collegamento DSM non disponibile.");

const functions = getFunctions();
const listAccounts = httpsCallable(functions, "listMyCanonicalAccounts");
const resolveAuthorization = httpsCallable(functions, "resolveAuthorization");
const listOwnEmployeeShifts = httpsCallable(functions, "listOwnEmployeeShifts");
const proposeMembershipInvite = httpsCallable(functions, "proposeCanonicalMembershipInvite");
const approveMembershipInvite = httpsCallable(functions, "approveCanonicalMembershipInvite");
const claimMembershipInvite = httpsCallable(functions, "claimCanonicalMembershipInvite");
const proposeEmployeeProvisioning = httpsCallable(functions, "proposeEmployeeProvisioning");
const approveEmployeeProvisioning = httpsCallable(functions, "approveEmployeeProvisioning");

const controller = mountDSMCanonicalAccountBridge(root, {
  auth,
  onAuthStateChanged: watchAuth,
  listCanonicalAccounts: async () => {
    const result = await listAccounts();
    return result.data;
  },
  listOwnEmployeeShifts: async data => {
    const result = await listOwnEmployeeShifts(data);
    return result.data;
  },
  resolveAuthorization: async ({ uid, accountId }) => {
    if (!auth.currentUser || auth.currentUser.uid !== uid) {
      throw new Error("L'identità Firebase è cambiata.");
    }
    const result = await resolveAuthorization({ accountId });
    return result.data;
  },
  createAuthAdapter: options => createFirebaseAuthAdapter(options),
  openDatabase: () => openDSMDatabase(),
  closeDatabase: () => closeDSMDatabase(),
  createSession: options => createDSMCoreSession(options)
});

const inviteRoot = document.getElementById("dsm-membership-invite-root");
const inviteController = inviteRoot ? mountDSMMembershipInvitePage(inviteRoot, {
  auth,
  onAuthStateChanged: watchAuth,
  proposeInvite: async data => (await proposeMembershipInvite(data)).data,
  approveInvite: async data => (await approveMembershipInvite(data)).data,
  claimInvite: async data => (await claimMembershipInvite(data)).data,
  proposeEmployee: async data => (await proposeEmployeeProvisioning(data)).data,
  approveEmployee: async data => (await approveEmployeeProvisioning(data)).data
}) : null;

export default Object.freeze({ accountBridge: controller, membershipInvites: inviteController });
