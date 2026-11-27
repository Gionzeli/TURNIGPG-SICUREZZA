/**
 * Synthetic-only bootstrap fixture for the approved organization account.
 * This is test data, not an account-creation API or production provisioning path.
 */
export const CANONICAL_ORGANIZATION_ACCOUNT_ID = "turnigpg-sicurezza";
export const CANONICAL_EMULATOR_OWNER_UID = "dsm-bootstrap-owner-synthetic";

export function buildCanonicalAccountFixture({ timestamp }) {
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new TypeError("A deterministic non-negative fixture timestamp is required.");
  }
  return Object.freeze({
    account: Object.freeze({
      accountId: CANONICAL_ORGANIZATION_ACCOUNT_ID,
      displayName: "TURNIGPG Sicurezza",
      status: "active",
      schemaVersion: 1,
      version: 1,
      fixtureOnly: true,
      createdAt: timestamp,
      createdBy: "emulator-fixture"
    }),
    ownerMembership: Object.freeze({
      uid: CANONICAL_EMULATOR_OWNER_UID,
      accountId: CANONICAL_ORGANIZATION_ACCOUNT_ID,
      status: "active",
      role: "admin",
      scopeType: "account",
      scopeIds: Object.freeze([]),
      validFrom: timestamp,
      validUntil: null,
      fixtureOnly: true,
      createdAt: timestamp,
      createdBy: "emulator-fixture"
    })
  });
}
