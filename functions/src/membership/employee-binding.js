const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function deny(message = "Employee identity binding is unavailable.") {
  const error = new Error(message);
  error.code = "permission-denied";
  throw error;
}

function validId(value) {
  return typeof value === "string" && ID_PATTERN.test(value);
}

/**
 * Validate a backend-owned binding fetched by (accountId, verified uid).
 * The caller must never pass a profileId selector from request.data.
 */
export function validateEmployeeBinding(binding, expectedUid, expectedAccountId) {
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) return null;
  if (!validId(expectedUid) || !validId(expectedAccountId)) return null;
  if (binding.uid !== expectedUid || binding.accountId !== expectedAccountId) return null;
  if (!validId(binding.profileId) || binding.status !== "active") return null;
  if (!Number.isSafeInteger(binding.revision) || binding.revision < 1) return null;
  return Object.freeze({
    uid: expectedUid,
    accountId: expectedAccountId,
    profileId: binding.profileId,
    revision: binding.revision
  });
}

/**
 * Resolve a member's one employee identity from trusted backend loaders.
 *
 * loadBinding(accountId, verifiedUid) must read the backend-owned
 * backend-owned binding record selected by the approved storage adapter.
 * Any concrete storage path is intentionally unspecified until EMP-10/schema approval.
 * loadActiveProfile(accountId, profileId) must return a canonical lifecycle
 * projection only when that profile exists in the same account and is active:
 * { accountId, profileId, active: true }.
 *
 * This module deliberately contains no Firestore path adapter and is not an
 * endpoint. The canonical profile store and provisioning workflow are not yet
 * approved; callers must inject trusted server-side loaders.
 */
export async function resolveOwnEmployeeBinding({ principal, loadBinding, loadActiveProfile }) {
  if (!principal || typeof principal !== "object" || Array.isArray(principal) ||
      !validId(principal.uid) || !validId(principal.accountId) ||
      principal.role !== "member" ||
      !Array.isArray(principal.permissions) ||
      !principal.permissions.includes("dsm:read:own-scope") ||
      typeof loadBinding !== "function" ||
      typeof loadActiveProfile !== "function") deny();

  let rawBinding;
  try {
    rawBinding = await loadBinding(principal.accountId, principal.uid);
  } catch {
    deny();
  }
  const binding = validateEmployeeBinding(rawBinding, principal.uid, principal.accountId);
  if (!binding) deny();

  let profile;
  try {
    profile = await loadActiveProfile(binding.accountId, binding.profileId);
  } catch {
    deny();
  }
  if (!profile || typeof profile !== "object" || Array.isArray(profile) ||
      profile.accountId !== binding.accountId ||
      profile.profileId !== binding.profileId ||
      profile.active !== true) deny();

  return Object.freeze({
    uid: binding.uid,
    accountId: binding.accountId,
    profileId: binding.profileId,
    bindingRevision: binding.revision
  });
}
