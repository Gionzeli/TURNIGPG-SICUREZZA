import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCanonicalAccountFixture,
  CANONICAL_ORGANIZATION_ACCOUNT_ID,
  CANONICAL_EMULATOR_OWNER_UID
} from "../src/membership/canonical-account-bootstrap-fixture.js";

test("builds only the approved synthetic canonical account and owner membership", () => {
  const fixture = buildCanonicalAccountFixture({ timestamp: 0 });
  assert.equal(CANONICAL_ORGANIZATION_ACCOUNT_ID, "turnigpg-sicurezza");
  assert.equal(fixture.account.accountId, "turnigpg-sicurezza");
  assert.equal(fixture.account.status, "active");
  assert.equal(fixture.account.schemaVersion, 1);
  assert.equal(fixture.ownerMembership.uid, CANONICAL_EMULATOR_OWNER_UID);
  assert.equal(fixture.ownerMembership.accountId, fixture.account.accountId);
  assert.equal(fixture.ownerMembership.role, "admin");
  assert.equal(fixture.ownerMembership.scopeType, "account");
  assert.deepEqual(fixture.ownerMembership.scopeIds, []);
  assert.equal(fixture.ownerMembership.validUntil, null);
  assert.equal(fixture.account.fixtureOnly, true);
  assert.equal(fixture.ownerMembership.fixtureOnly, true);
});

test("rejects non-deterministic or invalid fixture timestamps", () => {
  for (const timestamp of [-1, 1.5, NaN, Infinity, "0", null]) {
    assert.throws(() => buildCanonicalAccountFixture({ timestamp }), TypeError);
  }
});
