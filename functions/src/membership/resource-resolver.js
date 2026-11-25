import { authorizeResource } from "./resource-authorization.js";

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function deny(message = "Canonical resource could not be resolved.") {
  const error = new Error(message);
  error.code = "permission-denied";
  throw error;
}
function validId(value) {
  return typeof value === "string" && ID_PATTERN.test(value);
}
function validRecord(record) {
  return Boolean(record && typeof record === "object" && !Array.isArray(record));
}

/**
 * Resolve a resource selector against canonical server-owned records.
 *
 * Selector values are identifiers only. Never copy role, scope, account,
 * site, department, ownership, or permission claims from request.data into
 * the returned context. The injected loaders must read authoritative records
 * from the backend data store; do not implement them using client input.
 *
 * Loader contract:
 * - loadAccount(accountId) -> { accountId } | null
 * - loadSite(accountId, siteId) -> { accountId, siteId } | null
 * - loadDepartment(accountId, siteId, departmentId)
 *   -> { accountId, siteId, departmentId } | null
 *
 * This adapter is intentionally storage-agnostic because the production
 * account/site/department document paths have not been approved or defined.
 */
export async function resolveCanonicalResourceContext({ selector, principal, loaders }) {
  if (!principal || typeof principal !== "object" || !validId(principal.accountId)) deny();
  if (!selector || typeof selector !== "object" || Array.isArray(selector)) deny();
  if (!loaders || typeof loaders !== "object" ||
      typeof loaders.loadAccount !== "function" ||
      typeof loaders.loadSite !== "function" ||
      typeof loaders.loadDepartment !== "function") deny();

  const { type, accountId, siteId = null, departmentId = null } = selector;
  if (!validId(accountId) || accountId !== principal.accountId) deny();

  const account = await loaders.loadAccount(accountId);
  if (!validRecord(account) || account.accountId !== accountId) deny();

  if (type === "account") {
    if (siteId !== null || departmentId !== null) deny();
    return Object.freeze({ accountId, siteId: null, departmentId: null });
  }

  if (!validId(siteId)) deny();
  const site = await loaders.loadSite(accountId, siteId);
  if (!validRecord(site) || site.accountId !== accountId || site.siteId !== siteId) deny();

  if (type === "site") {
    if (departmentId !== null) deny();
    return Object.freeze({ accountId, siteId, departmentId: null });
  }

  if (type !== "department" || !validId(departmentId)) deny();
  const department = await loaders.loadDepartment(accountId, siteId, departmentId);
  if (!validRecord(department) ||
      department.accountId !== accountId ||
      department.siteId !== siteId ||
      department.departmentId !== departmentId) deny();

  return Object.freeze({ accountId, siteId, departmentId });
}

/**
 * Resolve canonical records first, then apply the resource authorization
 * policy. This is not an endpoint and does not authenticate the principal.
 */
export async function authorizeCanonicalResource({ principal, permission, selector, loaders }) {
  const resourceContext = await resolveCanonicalResourceContext({ selector, principal, loaders });
  return authorizeResource({ principal, permission, resourceContext });
}
