import { verifyIdentity } from "../auth/verify-identity.js";
import {
  createAdminNomination,
  approveAdminNomination,
  cancelAdminNomination
} from "./nomination-service.js";

function unauthenticated(message) {
  const error = new Error(message);
  error.code = "unauthenticated";
  throw error;
}

function readBearerToken(request) {
  const authorization = request?.rawRequest?.headers?.authorization;
  if (typeof authorization !== "string") unauthenticated("Bearer ID token required.");
  const match = /^Bearer ([^\\s]+)$/i.exec(authorization);
  if (!match) unauthenticated("Bearer ID token required.");
  return match[1];
}

function readData(request) {
  const data = request?.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    const error = new Error("Callable data must be an object.");
    error.code = "invalid-argument";
    throw error;
  }
  return data;
}

/**
 * Builds trusted server-side handlers for nomination operations.
 * Deliberately not wired to onCall or exported from the composition root.
 * actorUid and actorIdentity are derived only from a revocation-checked token.
 */
export function createNominationHandlers({
  db,
  verifyToken,
  now = () => Date.now(),
  services = { createAdminNomination, approveAdminNomination, cancelAdminNomination }
}) {
  if (!db || typeof verifyToken !== "function" || typeof now !== "function" ||
      !services || typeof services.createAdminNomination !== "function" ||
      typeof services.approveAdminNomination !== "function" ||
      typeof services.cancelAdminNomination !== "function") {
    throw new TypeError("Trusted database, token verifier, clock, and nomination services are required.");
  }

  async function trustedActor(request) {
    const token = readBearerToken(request);
    try {
      return await verifyIdentity(token, verifyToken);
    } catch {
      unauthenticated("Identity verification failed.");
    }
  }

  return Object.freeze({
    async create(request) {
      const data = readData(request);
      const identity = await trustedActor(request);
      return services.createAdminNomination({
        db, accountId: data.accountId, actorUid: identity.uid, actorIdentity: identity,
        nominationId: data.nominationId, targetUid: data.targetUid, role: data.role,
        scopeType: data.scopeType, scopeIds: data.scopeIds, now
      });
    },

    async approve(request) {
      const data = readData(request);
      const identity = await trustedActor(request);
      return services.approveAdminNomination({
        db, accountId: data.accountId, actorUid: identity.uid, actorIdentity: identity,
        nominationId: data.nominationId, now
      });
    },

    async cancel(request) {
      const data = readData(request);
      const identity = await trustedActor(request);
      return services.cancelAdminNomination({
        db, accountId: data.accountId, actorUid: identity.uid, actorIdentity: identity,
        nominationId: data.nominationId, eventId: data.eventId, reason: data.reason, now
      });
    }
  });
}
