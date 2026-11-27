import { resolveCanonicalMembership } from "./membership-policy.js";
import { mapApprovedEmploymentProfileFields } from "./employment-profile-dto.js";

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const validId = value => typeof value === "string" && ID.test(value);
function deny(code = "permission-denied", message = "Own employment profile access denied.") {
  const error = new Error(message); error.code = code; throw error;
}

/** Server-only, transaction-aware authorization and allowlisted profile loader. */
export function createOwnEmploymentProfileLoader({ db, now = () => Date.now() }) {
  if (!db || typeof db.doc !== "function" || typeof db.runTransaction !== "function" || typeof now !== "function") {
    throw new TypeError("Trusted Firestore and clock are required.");
  }
  return Object.freeze({
    async read({ accountId, uid }) {
      if (!validId(accountId) || !validId(uid)) deny("invalid-argument", "Invalid account selector.");
      return db.runTransaction(async tx => {
        const accountRef = db.doc(`accounts/${accountId}`);
        const memberRef = db.doc(`accounts/${accountId}/members/${uid}`);
        const bindingRef = db.doc(`accounts/${accountId}/employeeBindingsByUid/${uid}`);
        const [accountSnap, memberSnap, bindingSnap] = await Promise.all([
          tx.get(accountRef), tx.get(memberRef), tx.get(bindingRef)
        ]);
        const timestamp = now();
        if (!Number.isSafeInteger(timestamp) || !accountSnap.exists || !memberSnap.exists || !bindingSnap.exists) deny();
        const account = accountSnap.data();
        if (account.accountId !== accountId || accountSnap.id !== accountId || account.status !== "active" ||
            !Number.isSafeInteger(account.schemaVersion) || account.schemaVersion < 1 ||
            !Number.isSafeInteger(account.version) || account.version < 1) deny();
        const principal = resolveCanonicalMembership({ uid, accountId, membership: memberSnap.data(), nowMs: timestamp });
        if (!principal || principal.role !== "member" ||
            !principal.permissions.includes("dsm:employee:employment-profile:read:self")) deny();
        const binding = bindingSnap.data();
        if (binding.accountId !== accountId || binding.uid !== uid || !validId(binding.employeeId) ||
            binding.status !== "active" || !Number.isSafeInteger(binding.revision) || binding.revision < 1) deny();
        const employeeId = binding.employeeId;
        const reverseRef = db.doc(`accounts/${accountId}/employeeBindingsByEmployee/${employeeId}`);
        const employeeRef = db.doc(`accounts/${accountId}/employees/${employeeId}`);
        const profileRef = db.doc(`accounts/${accountId}/employees/${employeeId}/employmentProfiles/current`);
        const [reverseSnap, employeeSnap, profileSnap] = await Promise.all([
          tx.get(reverseRef), tx.get(employeeRef), tx.get(profileRef)
        ]);
        if (!reverseSnap.exists || !employeeSnap.exists || !profileSnap.exists) deny("not-found", "Canonical employment profile not found.");
        const reverse = reverseSnap.data(), employee = employeeSnap.data(), stored = profileSnap.data();
        if (reverse.accountId !== accountId || reverse.uid !== uid || reverse.employeeId !== employeeId ||
            reverse.status !== "active" || reverse.revision !== binding.revision ||
            employee.accountId !== accountId || employee.employeeId !== employeeId || employee.status !== "active") deny();
        if (stored.accountId !== accountId || stored.employeeId !== employeeId || stored.status !== "active" ||
            stored.schemaVersion !== 1 || !Number.isSafeInteger(stored.revision) || stored.revision < 1) {
          deny("failed-precondition", "Canonical employment profile is malformed or unsupported.");
        }
        let employmentProfile;
        try { employmentProfile = mapApprovedEmploymentProfileFields(stored); }
        catch { deny("failed-precondition", "Canonical employment profile contains invalid fields."); }
        return Object.freeze({ employeeId, employmentProfile });
      });
    }
  });
}
