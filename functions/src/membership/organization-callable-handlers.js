import { verifyIdentity } from "../auth/verify-identity.js";
import { createSite, createDepartment, archiveDepartment, archiveSite } from "./organization-mutation-service.js";
import { transferDepartment } from "./department-transfer-service.js";

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const REASON = /^[a-z0-9_-]{1,64}$/;
function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function bearer(request) {
  const header = request?.rawRequest?.headers?.authorization;
  const match = typeof header === "string" ? /^Bearer ([^\s]+)$/i.exec(header) : null;
  if (!match) fail("unauthenticated", "Bearer ID token required.");
  return match[1];
}
function dataObject(request, allowed) {
  const data = request?.data;
  if (!data || typeof data !== "object" || Array.isArray(data) ||
      Object.keys(data).some(key => !allowed.includes(key))) {
    fail("invalid-argument", "Callable data contains unsupported fields.");
  }
  return data;
}
function requiredId(value) { if (typeof value !== "string" || !ID.test(value)) fail("invalid-argument", "Invalid identifier."); return value; }
function requiredReason(value) { if (typeof value !== "string" || !REASON.test(value)) fail("invalid-argument", "Invalid reason code."); return value; }

export function createOrganizationCallableHandlers({
  db, verifyToken, now = () => Date.now(),
  services = { createSite, createDepartment, archiveDepartment, archiveSite, transferDepartment }
}) {
  if (!db || typeof verifyToken !== "function" || typeof now !== "function" || !services ||
      ["createSite", "createDepartment", "archiveDepartment", "archiveSite", "transferDepartment"]
        .some(name => typeof services[name] !== "function")) {
    throw new TypeError("Trusted Firestore, token verifier, clock and organization services are required.");
  }
  async function actor(request) {
    try { return await verifyIdentity(bearer(request), verifyToken); }
    catch { fail("unauthenticated", "Identity verification failed."); }
  }
  return Object.freeze({
    async createSite(request) {
      const data = dataObject(request, ["accountId", "displayName", "reasonCode"]);
      const identity = await actor(request);
      return services.createSite({ db, accountId: requiredId(data.accountId), actorUid: identity.uid,
        displayName: data.displayName, reasonCode: requiredReason(data.reasonCode), now });
    },
    async createDepartment(request) {
      const data = dataObject(request, ["accountId", "siteId", "displayName", "reasonCode"]);
      const identity = await actor(request);
      return services.createDepartment({ db, accountId: requiredId(data.accountId), siteId: requiredId(data.siteId),
        actorUid: identity.uid, displayName: data.displayName, reasonCode: requiredReason(data.reasonCode), now });
    },
    async archiveDepartment(request) {
      const data = dataObject(request, ["accountId", "departmentId", "reasonCode"]);
      const identity = await actor(request);
      return services.archiveDepartment({ db, accountId: requiredId(data.accountId), departmentId: requiredId(data.departmentId),
        actorUid: identity.uid, reasonCode: requiredReason(data.reasonCode), now });
    },
    async archiveSite(request) {
      const data = dataObject(request, ["accountId", "siteId", "reasonCode"]);
      const identity = await actor(request);
      return services.archiveSite({ db, accountId: requiredId(data.accountId), siteId: requiredId(data.siteId),
        actorUid: identity.uid, reasonCode: requiredReason(data.reasonCode), now });
    },
    async transferDepartment(request) {
      const data = dataObject(request, ["accountId", "departmentId", "sourceSiteId", "destinationSiteId", "expectedVersion", "reasonCode"]);
      const identity = await actor(request);
      return services.transferDepartment({ db, accountId: requiredId(data.accountId), departmentId: requiredId(data.departmentId),
        sourceSiteId: requiredId(data.sourceSiteId), destinationSiteId: requiredId(data.destinationSiteId),
        expectedVersion: data.expectedVersion, actorUid: identity.uid, reasonCode: requiredReason(data.reasonCode), now });
    }
  });
}
