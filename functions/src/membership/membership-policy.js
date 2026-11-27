/** Canonical membership policy. Authority is derived from server-owned membership only. */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const ROLES = new Set(["member", "manager", "admin"]);
const SCOPE_TYPES = new Set(["account", "site", "department"]);
const PERMISSIONS = Object.freeze({
  member: [
    "dsm:read:own-scope",
    "dsm:employee:shift:read:self",
    "dsm:employee:employment-profile:read:self"
  ],
  manager: ["dsm:read:site", "dsm:manage:site", "dsm:manage:departments", "dsm:transfer:departments"],
  admin: ["dsm:read:account", "dsm:manage:account", "dsm:manage:memberships", "dsm:manage:admin-nominations", "dsm:transfer:departments", "dsm:archive:site", "dsm:archive:department"]
});
function validId(value) { return typeof value === "string" && ID_PATTERN.test(value); }
function timestampMillis(value) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (value && typeof value.toMillis === "function") {
    try { const result = value.toMillis(); return Number.isFinite(result) ? result : null; } catch { return null; }
  }
  return null;
}

/**
 * Effective-dated membership contract. validFrom is mandatory; validUntil
 * must be a Firestore Timestamp/Date or null. Server time is injected for tests.
 */
export function validateCanonicalMembership(membership, expectedUid, expectedAccountId, nowMs = Date.now()) {
  if (!membership || typeof membership !== "object" || Array.isArray(membership) ||
      !validId(expectedUid) || !validId(expectedAccountId) ||
      membership.uid !== expectedUid || membership.accountId !== expectedAccountId ||
      !validId(membership.uid) || !validId(membership.accountId) ||
      membership.status !== "active" || !ROLES.has(membership.role) ||
      !SCOPE_TYPES.has(membership.scopeType) || !Number.isSafeInteger(nowMs)) return null;

  const from = timestampMillis(membership.validFrom);
  const until = membership.validUntil === null ? null : timestampMillis(membership.validUntil);
  if (from === null || (membership.validUntil !== null && until === null) ||
      from > nowMs || (until !== null && (until <= from || nowMs >= until))) return null;

  const scopeIds = membership.scopeIds;
  if (!Array.isArray(scopeIds) || scopeIds.some(id => !validId(id)) ||
      new Set(scopeIds).size !== scopeIds.length) return null;
  if (membership.role === "admin" && (membership.scopeType !== "account" || scopeIds.length !== 0)) return null;
  if (membership.role === "manager" && (membership.scopeType !== "site" || scopeIds.length < 1)) return null;
  if (membership.role === "member" && (membership.scopeType === "account" || scopeIds.length < 1)) return null;

  return Object.freeze({
    uid: expectedUid, accountId: expectedAccountId, role: membership.role,
    scopeType: membership.scopeType, scopeIds: Object.freeze([...scopeIds]),
    permissions: Object.freeze([...PERMISSIONS[membership.role]])
  });
}
export function resolveCanonicalMembership({ uid, accountId, membership, nowMs = Date.now() }) {
  if (!validId(uid) || !validId(accountId)) return null;
  return validateCanonicalMembership(membership, uid, accountId, nowMs);
}
