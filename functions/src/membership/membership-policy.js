/**
 * Canonical membership validation and permission derivation.
 * Membership data is server-owned. Client-provided role/scope/permissions are never trusted.
 */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const ROLES = new Set(["member", "manager", "admin"]);
const SCOPE_TYPES = new Set(["account", "site", "department"]);

const PERMISSIONS = Object.freeze({
  member: ["dsm:read:own-scope"],
  manager: ["dsm:read:site", "dsm:manage:site", "dsm:manage:departments"],
  admin: ["dsm:read:account", "dsm:manage:account", "dsm:manage:memberships", "dsm:manage:admin-nominations"]
});

function validId(value) {
  return typeof value === "string" && ID_PATTERN.test(value);
}

export function validateCanonicalMembership(membership, expectedUid, expectedAccountId) {
  if (!membership || typeof membership !== "object" || Array.isArray(membership)) return null;
  if (membership.uid !== expectedUid || membership.accountId !== expectedAccountId) return null;
  if (!validId(membership.uid) || !validId(membership.accountId)) return null;
  if (membership.status !== "active" || !ROLES.has(membership.role) || !SCOPE_TYPES.has(membership.scopeType)) return null;

  const scopeIds = membership.scopeIds;
  if (!Array.isArray(scopeIds) || scopeIds.some(id => !validId(id)) || new Set(scopeIds).size !== scopeIds.length) return null;

  if (membership.role === "admin" && (membership.scopeType !== "account" || scopeIds.length !== 0)) return null;
  if (membership.role === "manager" && (membership.scopeType !== "site" || scopeIds.length < 1)) return null;
  if (membership.role === "member" && (membership.scopeType === "account" || scopeIds.length < 1)) return null;

  // Normalize shape; all authority comes from this policy, not membership permissions.
  return Object.freeze({
    uid: expectedUid,
    accountId: expectedAccountId,
    role: membership.role,
    scopeType: membership.scopeType,
    scopeIds: Object.freeze([...scopeIds]),
    permissions: Object.freeze([...PERMISSIONS[membership.role]])
  });
}

export function resolveCanonicalMembership({ uid, accountId, membership }) {
  if (!validId(uid) || !validId(accountId)) return null;
  return validateCanonicalMembership(membership, uid, accountId);
}
