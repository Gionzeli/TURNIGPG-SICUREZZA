import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import {
  buildCanonicalAccountFixture,
  CANONICAL_ORGANIZATION_ACCOUNT_ID,
  CANONICAL_EMULATOR_OWNER_UID
} from "../src/membership/canonical-account-bootstrap-fixture.js";

function emulatorProjectId() {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("Refusing to seed: FIRESTORE_EMULATOR_HOST is not set.");
  }
  let projectId = process.env.GCLOUD_PROJECT || "";
  if (process.env.FIREBASE_CONFIG) {
    try {
      const config = JSON.parse(process.env.FIREBASE_CONFIG);
      projectId = config.projectId || projectId;
    } catch {
      throw new Error("Refusing to seed: FIREBASE_CONFIG is invalid.");
    }
  }
  if (!projectId.startsWith("demo-")) {
    throw new Error("Refusing to seed: project ID must start with demo-.");
  }
  return projectId;
}

function sameFixture(actual, expected) {
  return Object.entries(expected).every(([key, value]) => {
    const actualValue = actual?.[key];
    if (value && typeof value.toMillis === "function") return actualValue?.toMillis?.() === value.toMillis();
    return JSON.stringify(actualValue) === JSON.stringify(value);
  });
}

async function main() {
  const projectId = emulatorProjectId();
  const app = getApps()[0] || initializeApp({ projectId });
  const db = getFirestore(app);
  const now = Timestamp.fromMillis(0);
  const fixture = buildCanonicalAccountFixture({ timestamp: 0 });
  const accountRef = db.doc(`accounts/${CANONICAL_ORGANIZATION_ACCOUNT_ID}`);
  const membershipRef = db.doc(`accounts/${CANONICAL_ORGANIZATION_ACCOUNT_ID}/members/${CANONICAL_EMULATOR_OWNER_UID}`);
  const accountData = { ...fixture.account, createdAt: now };
  const membershipData = { ...fixture.ownerMembership, validFrom: now, createdAt: now };

  await db.runTransaction(async tx => {
    const [accountSnap, membershipSnap] = await Promise.all([tx.get(accountRef), tx.get(membershipRef)]);
    if (accountSnap.exists && !sameFixture(accountSnap.data(), accountData)) {
      throw new Error("Canonical account exists with different data; refusing to overwrite.");
    }
    if (membershipSnap.exists && !sameFixture(membershipSnap.data(), membershipData)) {
      throw new Error("Synthetic owner membership exists with different data; refusing to overwrite.");
    }
    if (!accountSnap.exists) tx.create(accountRef, accountData);
    if (!membershipSnap.exists) tx.create(membershipRef, membershipData);
  });

  process.stdout.write(JSON.stringify({
    status: "seeded-or-already-present",
    projectId,
    accountId: CANONICAL_ORGANIZATION_ACCOUNT_ID,
    syntheticOwnerUid: CANONICAL_EMULATOR_OWNER_UID,
    emulatorOnly: true
  }) + "\n");
}

main().catch(error => {
  process.stderr.write(`Canonical account emulator seed failed: ${error.message}\n`);
  process.exitCode = 1;
});
