import { authorizeResource } from "./resource-authorization.js";

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const validId = value => typeof value === "string" && ID.test(value);
const MODES = new Set(["self", "delegated"]);
const ROLES = new Set(["member", "manager", "admin"]);
const SCOPE_TYPES = new Set(["account", "site", "department"]);

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function validPrincipal(principal) {
  return Boolean(principal && typeof principal === "object" && !Array.isArray(principal) &&
    validId(principal.uid) && validId(principal.accountId) &&
    ROLES.has(principal.role) && SCOPE_TYPES.has(principal.scopeType) &&
    Array.isArray(principal.scopeIds) && principal.scopeIds.every(validId) &&
    new Set(principal.scopeIds).size === principal.scopeIds.length &&
    Array.isArray(principal.permissions) &&
    principal.permissions.every(value => typeof value === "string"));
}

function deny(message = "Employee data access denied.") {
  const error = new Error(message);
  error.code = "permission-denied";
  throw error;
}

/**
 * Domain-level authorization primitive. principal, binding and placement
 * must be loaded by trusted server code; none may originate from request.data.
 *
 * Self mode proves the UID↔Employee binding. Delegated mode proves the
 * operation-specific permission and the target Employee's canonical
 * placement scope. Existing role permissions intentionally do not imply
 * these proposed data-domain permissions.
 */
export function authorizeEmployeeDomainOperation({
  principal, permission, accessMode, employeeBinding = null,
  employeeId, placement = null
}) {
  if (!validPrincipal(principal) ||
      typeof permission !== "string" || !principal.permissions.includes(permission) ||
      !MODES.has(accessMode) || !validId(employeeId)) deny();

  if (accessMode === "self") {
    if (!employeeBinding || employeeBinding.uid !== principal.uid ||
        employeeBinding.accountId !== principal.accountId ||
        employeeBinding.profileId !== employeeId ||
        employeeBinding.status !== "active" ||
        !Number.isSafeInteger(employeeBinding.revision) || employeeBinding.revision < 1) deny();
    return Object.freeze({
      authorized: true, accessMode, uid: principal.uid,
      accountId: principal.accountId, employeeId, permission
    });
  }

  if (!placement || placement.accountId !== principal.accountId ||
      placement.employeeId !== employeeId ||
      !validId(placement.placementId) || !validId(placement.siteId) ||
      !validId(placement.departmentId) ||
      !validDate(placement.validFrom) ||
      (placement.validUntil !== null &&
        (!validDate(placement.validUntil) || placement.validUntil <= placement.validFrom))) deny();

  const resource = authorizeResource({
    principal, permission,
    resourceContext: {
      accountId: placement.accountId,
      siteId: placement.siteId,
      departmentId: placement.departmentId
    }
  });
  return Object.freeze({
    ...resource, accessMode, employeeId,
    placementId: placement.placementId,
    siteId: placement.siteId,
    departmentId: placement.departmentId
  });
}
