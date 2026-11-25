const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const SCOPE_TYPES = new Set(["account", "site", "department"]);

function deny(code = "permission-denied", message = "Resource access denied.") {
  const error = new Error(message);
  error.code = code;
  throw error;
}
function validId(value) {
  return typeof value === "string" && ID_PATTERN.test(value);
}

/**
 * Pure resource-level authorization.
 *
 * IMPORTANT: principal must be produced by canonical server-side membership
 * validation, and resourceContext must be loaded/derived by trusted server code
 * from canonical records. Never pass request.data as either argument.
 * This function makes no database reads and does not establish resource
 * existence; callers must resolve both inputs before invoking this policy.
 */
export function authorizeResource({ principal, permission, resourceContext }) {
  if (!principal || typeof principal !== "object" || Array.isArray(principal) ||
      !validId(principal.uid) || !validId(principal.accountId) ||
      !["member", "manager", "admin"].includes(principal.role) ||
      !SCOPE_TYPES.has(principal.scopeType) ||
      !Array.isArray(principal.scopeIds) ||
      principal.scopeIds.some(id => !validId(id)) ||
      new Set(principal.scopeIds).size !== principal.scopeIds.length ||
      !Array.isArray(principal.permissions) ||
      principal.permissions.some(value => typeof value !== "string")) {
    deny("permission-denied", "A canonical principal is required.");
  }
  if (typeof permission !== "string" || !principal.permissions.includes(permission)) {
    deny();
  }
  if (!resourceContext || typeof resourceContext !== "object" || Array.isArray(resourceContext) ||
      !validId(resourceContext.accountId) ||
      resourceContext.accountId !== principal.accountId) {
    deny();
  }

  const { siteId = null, departmentId = null } = resourceContext;
  if (siteId !== null && !validId(siteId)) deny();
  if (departmentId !== null && !validId(departmentId)) deny();
  if (departmentId !== null && siteId === null) deny();

  if (principal.role === "admin") {
    if (principal.scopeType !== "account" || principal.scopeIds.length !== 0) deny();
    return Object.freeze({ authorized: true, uid: principal.uid, accountId: principal.accountId, permission });
  }

  if (principal.role === "manager") {
    if (principal.scopeType !== "site" || siteId === null ||
        !principal.scopeIds.includes(siteId)) deny();
    return Object.freeze({ authorized: true, uid: principal.uid, accountId: principal.accountId, permission });
  }

  if (principal.role === "member") {
    const inOwnDepartment = principal.scopeType === "department" &&
      departmentId !== null && principal.scopeIds.includes(departmentId);
    const inOwnSite = principal.scopeType === "site" &&
      siteId !== null && principal.scopeIds.includes(siteId);
    if (!inOwnDepartment && !inOwnSite) deny();
    return Object.freeze({ authorized: true, uid: principal.uid, accountId: principal.accountId, permission });
  }

  deny();
}
