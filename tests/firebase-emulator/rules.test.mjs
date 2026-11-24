import { readFileSync } from "node:fs";
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} from "@firebase/rules-unit-testing";
import {
  deleteDoc,
  doc,
  getDoc,
  setDoc,
  updateDoc
} from "firebase/firestore";

const projectId = "demo-dsm-rules";
const rules = readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8");
let env;

const verifiedUser = () => env.authenticatedContext("user-a", {
  email: "user-a@example.invalid",
  email_verified: true
}).firestore();

const unverifiedUser = () => env.authenticatedContext("user-unverified", {
  email: "user-unverified@example.invalid",
  email_verified: false
}).firestore();

const adminUser = () => env.authenticatedContext("synthetic-admin", {
  // Emulator-only claim used to exercise the current hardcoded admin rule.
  email: "zelanogianfranco@gmail.com",
  email_verified: true
}).firestore();

const requestData = (uid, email) => ({
  uid,
  email,
  name: "Synthetic User",
  role: "operator",
  note: "emulator fixture",
  status: "pending",
  createdAt: "2026-01-01T00:00:00.000Z"
});

before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: { rules }
  });
});

beforeEach(async () => {
  await env.clearFirestore();
});

after(async () => {
  await env.cleanup();
});

test("FR-01 unauthenticated users cannot read access requests", async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, "accessRequests/user-a")));
});

test("FR-05 verified user can create a well-formed own access request", async () => {
  const db = verifiedUser();
  await assertSucceeds(setDoc(
    doc(db, "accessRequests/user-a"),
    requestData("user-a", "user-a@example.invalid")
  ));
});

test("FR-12b documents current gap: unverified authenticated user can create request", async () => {
  const db = unverifiedUser();
  await assertSucceeds(setDoc(
    doc(db, "accessRequests/user-unverified"),
    requestData("user-unverified", "user-unverified@example.invalid")
  ));
});

test("FR-12a unverified user cannot read own access request", async () => {
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(
      doc(context.firestore(), "accessRequests/user-unverified"),
      requestData("user-unverified", "user-unverified@example.invalid")
    );
  });
  await assertFails(getDoc(doc(unverifiedUser(), "accessRequests/user-unverified")));
});

test("FR-04 member cannot grant themselves membership", async () => {
  const db = verifiedUser();
  await assertFails(setDoc(doc(db, "members/user-a"), {
    active: true,
    role: "admin"
  }));
});

test("FR-19 synthetic admin can create a membership fixture", async () => {
  const db = adminUser();
  await assertSucceeds(setDoc(doc(db, "members/user-a"), {
    active: true,
    role: "operator"
  }));
});

test("FR-08 owner cannot approve their own access request", async () => {
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(
      doc(context.firestore(), "accessRequests/user-a"),
      requestData("user-a", "user-a@example.invalid")
    );
  });
  await assertFails(updateDoc(doc(verifiedUser(), "accessRequests/user-a"), {
    status: "approved"
  }));
});

test("FR-09 owner can edit an allowed request field without changing status", async () => {
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(
      doc(context.firestore(), "accessRequests/user-a"),
      requestData("user-a", "user-a@example.invalid")
    );
  });
  await assertSucceeds(updateDoc(doc(verifiedUser(), "accessRequests/user-a"), {
    note: "updated synthetic note"
  }));
});

test("FR-13 privateData remains denied even to the synthetic admin", async () => {
  await assertFails(setDoc(doc(adminUser(), "privateData/user-a"), {
    payload: "synthetic"
  }));
});

test("FR-21 unlisted collections remain denied", async () => {
  await assertFails(setDoc(doc(verifiedUser(), "unlisted/example"), {
    value: "synthetic"
  }));
});
