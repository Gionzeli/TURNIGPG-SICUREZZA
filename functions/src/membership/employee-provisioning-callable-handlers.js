import { verifyIdentity } from "../auth/verify-identity.js";
import { proposeEmployeeProvisioning, approveEmployeeProvisioning } from "./employee-provisioning-service.js";
import { revokeEmployeeBinding } from "./employee-binding-service.js";
function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function bearer(request) {
  const header = request?.rawRequest?.headers?.authorization;
  if (typeof header !== "string") fail("unauthenticated", "Bearer ID token required.");
  const match = /^Bearer (.+)$/i.exec(header);
  if (!match || /\s/.test(match[1])) fail("unauthenticated", "Bearer ID token required.");
  return match[1];
}
function dataObject(request, allowedKeys) {
  const data = request?.data;
  if (!data || typeof data !== "object" || Array.isArray(data) ||
      Object.keys(data).some(key => !allowedKeys.includes(key))) {
    fail("invalid-argument", "Callable data contains unsupported fields.");
  }
  return data;
}
export function createEmployeeProvisioningHandlers({ db, verifyToken, now = () => Date.now(), services = { proposeEmployeeProvisioning, approveEmployeeProvisioning, revokeEmployeeBinding } }) {
  if (!db || typeof verifyToken !== "function" || typeof now !== "function" || !services || typeof services.proposeEmployeeProvisioning !== "function" || typeof services.approveEmployeeProvisioning !== "function" || typeof services.revokeEmployeeBinding !== "function") throw new TypeError("Trusted Firestore, token verifier, clock and services are required.");
  async function actor(request) {
    try { return await verifyIdentity(bearer(request), verifyToken); }
    catch { fail("unauthenticated", "Identity verification failed."); }
  }
  return Object.freeze({
    async propose(request) { const data = dataObject(request, ["accountId", "proposalId", "targetUid", "employeeId", "verificationRef"]), identity = await actor(request); return services.proposeEmployeeProvisioning({ db, accountId: data.accountId, actorUid: identity.uid, actorIdentity: identity, proposalId: data.proposalId, targetUid: data.targetUid, employeeId: data.employeeId, verificationRef: data.verificationRef, now }); },
    async approve(request) { const data = dataObject(request, ["accountId", "proposalId"]), identity = await actor(request); return services.approveEmployeeProvisioning({ db, accountId: data.accountId, actorUid: identity.uid, actorIdentity: identity, proposalId: data.proposalId, now }); },
    async revoke(request) { const data = dataObject(request, ["accountId", "employeeId", "eventId"]), identity = await actor(request); return services.revokeEmployeeBinding({ db, accountId: data.accountId, actorUid: identity.uid, actorIdentity: identity, employeeId: data.employeeId, eventId: data.eventId, now }); }
  });
}
