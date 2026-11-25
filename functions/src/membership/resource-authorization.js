const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

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
 * IMPORTANT: resourceContext must be loaded/derived by trusted server code from
 * canonical records. Never pass request.data directly as resourceContext.
 * This function makes no database reads and does not establish that a resource
 * actually exists; callers must resolve it before invoking this policy.
 */
export function authorizeResource({ principal, permission, resourceContext }) {
  if (!principal || typeof principal !== "object" ||
      !validId(principal.uid) || !validId(principal.accountId) ||
      !["member", "manager", "admin"].includes(principal.role) ||
      !Array.isArray(principal.scopeIds) ||
      !Array.isArray(principal.permissions)) {
    deny("permission-denied", "A canonical principal is required.");
  }
  if (typeof permission !== "string" || !principal.permissions.includes(permission)) {
    deny();
  }
  if (!resourceContext || typeof resourceContext !== "object" ||
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
