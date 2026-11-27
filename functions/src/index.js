import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { verifyIdentity } from "./auth/verify-identity.js";
import { resolveCanonicalMembership } from "./membership/membership-policy.js";
import { createEmployeeProvisioningHandlers } from "./membership/employee-provisioning-callable-handlers.js";
import { createOrganizationCallableHandlers } from "./membership/organization-callable-handlers.js";
import { createEmployeeShiftCallableHandlers } from "./membership/employee-shift-callable-handlers.js";
import { createOwnEmploymentProfileCallableHandlers } from "./membership/employee-employment-profile-callable-handlers.js";
import { createCanonicalAccountCallableHandlers } from "./membership/canonical-account-callable-handlers.js";
import { createCanonicalMembershipInviteHandlers } from "./membership/canonical-membership-invite-callable-handlers.js";

initializeApp();

const organization = createOrganizationCallableHandlers({
  db: getFirestore(),
  verifyToken: (token, checkRevoked) => getAuth().verifyIdToken(token, checkRevoked)
});

const employeeShifts = createEmployeeShiftCallableHandlers({
  db: getFirestore(),
  verifyToken: (token, checkRevoked) => getAuth().verifyIdToken(token, checkRevoked)
});

const ownEmploymentProfile = createOwnEmploymentProfileCallableHandlers({
  db: getFirestore(),
  verifyToken: (token, checkRevoked) => getAuth().verifyIdToken(token, checkRevoked)
});

const canonicalAccounts = createCanonicalAccountCallableHandlers({
  db: getFirestore(),
  verifyToken: (token, checkRevoked) => getAuth().verifyIdToken(token, checkRevoked)
});

const membershipInvites = createCanonicalMembershipInviteHandlers({
  db: getFirestore(),
  verifyToken: (token, checkRevoked) => getAuth().verifyIdToken(token, checkRevoked)
});

const employeeProvisioning = createEmployeeProvisioningHandlers({
  db: getFirestore(),
  verifyToken: (token, checkRevoked) => getAuth().verifyIdToken(token, checkRevoked)
});

function callableError(error) {
  const allowed = new Set([
    "unauthenticated", "invalid-argument", "permission-denied", "not-found",
    "already-exists", "failed-precondition", "resource-exhausted"
  ]);
  if (error instanceof HttpsError) return error;
  if (allowed.has(error?.code)) return new HttpsError(error.code, error.message);
  return new HttpsError("internal", "Protected operation failed.");
}

export const health = onCall(async () => ({
  status: "ok",
  mode: "isolated-scaffold",
  identityAndMembershipResolutionImplemented: true,
  organizationMutationCallablesImplemented: true,
  organizationMutationAuthorizationImplemented: true,
  protectedEmployeeDataApisImplemented: false,
  ownEmploymentProfileReadImplemented: true,
  protectedEmployeeShiftApisImplemented: true,
  employeeShiftSelfAuthorizationImplemented: true,
  directEmployeeShiftMutationsEnabled: false,
  employeeShiftPersonalApprovalRequired: true,\n  employeeShiftProposalSubmissionImplemented: true,\n  employeeShiftProposalEmployeeApprovalImplemented: true,
  employeeDelegatedShiftAuthorizationImplemented: false,
  employeeDomainAuthorizationImplemented: true,
  bootstrapImplemented: false,
  employeeProvisioningCallablesImplemented: true,
  canonicalMembershipInviteCallablesImplemented: true,
  membershipInviteRequiresVerifiedEmailAndTwoAdmins: true
}));

export const resolveAuthorization = onCall(async (request) => {
  const authorization = request.rawRequest.headers.authorization ?? "";
  const match = authorization.match(/^Bearer (.+)$/i);
  if (!match) throw new HttpsError("unauthenticated", "Bearer ID token required.");
  let identity;
  try {
    identity = await verifyIdentity(match[1], (token, checkRevoked) =>
      getAuth().verifyIdToken(token, checkRevoked)
    );
  } catch {
    throw new HttpsError("unauthenticated", "Identity verification failed.");
  }
  const accountId = request.data?.accountId;
  if (typeof accountId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(accountId)) {
    throw new HttpsError("invalid-argument", "A valid accountId selector is required.");
  }
  try {
    const db = getFirestore();
    const [accountSnapshot, snapshot] = await Promise.all([
      db.doc(`accounts/${accountId}`).get(),
      db.doc(`accounts/${accountId}/members/${identity.uid}`).get()
    ]);
    if (!accountSnapshot.exists) throw new HttpsError("permission-denied", "Active canonical account required.");
    const account = accountSnapshot.data();
    if (account.accountId !== accountId || accountSnapshot.id !== accountId ||
        account.status !== "active" || !Number.isSafeInteger(account.schemaVersion) ||
        account.schemaVersion < 1 || !Number.isSafeInteger(account.version) || account.version < 1) {
      throw new HttpsError("permission-denied", "Account is inactive or malformed.");
    }
    if (!snapshot.exists) throw new HttpsError("permission-denied", "Active membership required.");
    const principal = resolveCanonicalMembership({ uid: identity.uid, accountId, membership: snapshot.data() });
    if (!principal) throw new HttpsError("permission-denied", "Membership is inactive or malformed.");
    return { principal, authorizationSource: "server", expiresAt: Date.now() + 5 * 60 * 1000 };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", "Authorization lookup failed.");
  }
});

export const listMyCanonicalAccounts = onCall(async request => {
  try { return await canonicalAccounts.listMine(request); }
  catch (error) { throw callableError(error); }
});

export const proposeCanonicalMembershipInvite = onCall(async request => {
  try { return await membershipInvites.propose(request); }
  catch (error) { throw callableError(error); }
});
export const approveCanonicalMembershipInvite = onCall(async request => {
  try { return await membershipInvites.approve(request); }
  catch (error) { throw callableError(error); }
});
export const claimCanonicalMembershipInvite = onCall(async request => {
  try { return await membershipInvites.claim(request); }
  catch (error) { throw callableError(error); }
});

export const proposeEmployeeProvisioning = onCall(async request => {
  try { return await employeeProvisioning.propose(request); }
  catch (error) { throw callableError(error); }
});

export const approveEmployeeProvisioning = onCall(async request => {
  try { return await employeeProvisioning.approve(request); }
  catch (error) { throw callableError(error); }
});

export const revokeEmployeeBinding = onCall(async request => {
  try { return await employeeProvisioning.revoke(request); }
  catch (error) { throw callableError(error); }
});

export const createOrganizationSite = onCall(async request => {
  try { return await organization.createSite(request); }
  catch (error) { throw callableError(error); }
});
export const createOrganizationDepartment = onCall(async request => {
  try { return await organization.createDepartment(request); }
  catch (error) { throw callableError(error); }
});
export const archiveOrganizationDepartment = onCall(async request => {
  try { return await organization.archiveDepartment(request); }
  catch (error) { throw callableError(error); }
});
export const archiveOrganizationSite = onCall(async request => {
  try { return await organization.archiveSite(request); }
  catch (error) { throw callableError(error); }
});
export const transferOrganizationDepartment = onCall(async request => {
  try { return await organization.transferDepartment(request); }
  catch (error) { throw callableError(error); }
});

export const listOwnEmployeeShifts = onCall(async request => {
  try { return await employeeShifts.listOwn(request); }
  catch (error) { throw callableError(error); }
});
export const proposeOwnEmployeeShiftChanges = onCall(async request => {
  try { return await employeeShifts.proposeOwn(request); }
  catch (error) { throw callableError(error); }
});
export const listOwnEmployeeShiftProposals = onCall(async request => {
  try { return await employeeShifts.listOwnProposals(request); }
  catch (error) { throw callableError(error); }
});
export const approveOwnEmployeeShiftProposal = onCall(async request => {
  try { return await employeeShifts.approveOwnProposal(request); }
  catch (error) { throw callableError(error); }
});
export const rejectOwnEmployeeShiftProposal = onCall(async request => {
  try { return await employeeShifts.rejectOwnProposal(request); }
  catch (error) { throw callableError(error); }
});

export const createOwnEmployeeShift = onCall(async request => {
  try { return await employeeShifts.create(request); }
  catch (error) { throw callableError(error); }
});
export const updateOwnEmployeeShift = onCall(async request => {
  try { return await employeeShifts.update(request); }
  catch (error) { throw callableError(error); }
});
export const deleteOwnEmployeeShift = onCall(async request => {
  try { return await employeeShifts.delete(request); }
  catch (error) { throw callableError(error); }
});

export const readOwnEmployeeEmploymentProfile = onCall(async request => {
  try { return await ownEmploymentProfile.read(request); }
  catch (error) { throw callableError(error); }
});
