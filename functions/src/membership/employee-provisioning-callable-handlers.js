import { verifyIdentity } from "../auth/verify-identity.js";
import {
  proposeEmployeeProvisioning,
  approveEmployeeProvisioning
} from "./employee-provisioning-service.js";

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}
function bearer(request) {
  const header = request?.rawRequest?.headers?.authorization;
  if (typeof header !== "string") fail("unauthenticated", "Bearer ID token required.");
  const match = /^Bearer ([^\\s]+)$/i.exec(header);
  if (!match) fail("unauthenticated", "Bearer ID token required.");
  return match[1];
}
function dataObject(request) {
  const data = request?.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    fail("invalid-argument", "Callable data must be an object.");
  }
  return data;
}

/**
 * Callable handler factory. Identity and MFA claims are derived only from a
 * revocation-checked Firebase ID token; actor fields in request.data are ignored.
 */
export function createEmployeeProvisioningHandlers({
  db, verifyToken, now = () => Date.now(),
  services = { proposeEmployeeProvisioning, approveEmployeeProvisioning }
}) {
  if (!db || typeof verifyToken !== "function" || typeof now !== "function" ||
      !services || typeof services.proposeEmployeeProvisioning !== "function" ||
      typeof services.approveEmployeeProvisioning !== "function") {
    throw new TypeError("Trusted Firestore, token verifier, clock and services are required.");
  }
  async function actor(request) {
    let identity;
    try {
      identity = await verifyIdentity(bearer(request), verifyToken);
    } catch {
      fail("unauthenticated", "Identity verification failed.");
    }
    return identity;
  }
  return Object.freeze({
    async propose(request) {
      const data = dataObject(request);
      const identity = await actor(request);
      return services.proposeEmployeeProvisioning({
        db, accountId: data.accountId, actorUid: identity.uid, actorIdentity: identity,
        proposalId: data.proposalId, targetUid: data.targetUid,
        employeeId: data.employeeId, verificationRef: data.verificationRef, now
      });
    },
    async approve(request) {
      const data = dataObject(request);
      const identity = await actor(request);
      return services.approveEmployeeProvisioning({
        db, accountId: data.accountId, actorUid: identity.uid, actorIdentity: identity,
        proposalId: data.proposalId, now
      });
    }
  });
}
