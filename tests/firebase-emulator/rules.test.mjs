import { readFileSync } from "node:fs";
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
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

test("FR-06 rejects access requests with mismatched identity or non-pending status", async () => {
  const db = verifiedUser();
  await assertFails(setDoc(doc(db, "accessRequests/user-a"), {
    ...requestData("user-b", "user-a@example.invalid")
  }));
  await assertFails(setDoc(doc(db, "accessRequests/user-a"), {
    ...requestData("user-a", "other@example.invalid")
  }));
  await assertFails(setDoc(doc(db, "accessRequests/user-a"), {
    ...requestData("user-a", "user-a@example.invalid"),
    status: "approved"
  }));
});

test("FR-07 rejects access requests with unexpected fields", async () => {
  const db = verifiedUser();
  await assertFails(setDoc(doc(db, "accessRequests/user-a"), {
    ...requestData("user-a", "user-a@example.invalid"),
    isAdmin: true
  }));
});

test("FR-10 owner cannot change access request UID or email", async () => {
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(
      doc(context.firestore(), "accessRequests/user-a"),
      requestData("user-a", "user-a@example.invalid")
    );
  });
  const db = verifiedUser();
  await assertFails(updateDoc(doc(db, "accessRequests/user-a"), { uid: "user-b" }));
  await assertFails(updateDoc(doc(db, "accessRequests/user-a"), { email: "other@example.invalid" }));
});

test("FR-11 owner can delete their own access request", async () => {
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(
      doc(context.firestore(), "accessRequests/user-a"),
      requestData("user-a", "user-a@example.invalid")
    );
  });
  await assertSucceeds(deleteDoc(doc(verifiedUser(), "accessRequests/user-a")));
});

const notificationPath = (uid, notificationId = "notice-1") =>
  `notifications/${uid}/items/${notificationId}`;

const notificationData = () => ({
  title: "Synthetic notice",
  body: "Emulator-only fixture",
  read: false,
  createdAt: "2026-01-01T00:00:00.000Z"
});

const seedNotification = async (uid = "user-a", notificationId = "notice-1") => {
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(
      doc(context.firestore(), notificationPath(uid, notificationId)),
      notificationData()
    );
  });
};

test("FR-19a synthetic admin can create a notification for a user", async () => {
  await assertSucceeds(setDoc(
    doc(adminUser(), notificationPath("user-a")),
    notificationData()
  ));
});

test("FR-20a non-admin cannot create a notification", async () => {
  await assertFails(setDoc(
    doc(verifiedUser(), notificationPath("user-a")),
    notificationData()
  ));
});

test("FR-20b notification is readable by its owner but not another user", async () => {
  await seedNotification();
  const owner = verifiedUser();
  const other = env.authenticatedContext("user-b", {
    email: "user-b@example.invalid",
    email_verified: true
  }).firestore();

  await assertSucceeds(getDoc(doc(owner, notificationPath("user-a"))));
  await assertFails(getDoc(doc(other, notificationPath("user-a"))));
});

test("FR-15 owner can mark a notification as read with a boolean", async () => {
  await seedNotification();
  await assertSucceeds(updateDoc(
    doc(verifiedUser(), notificationPath("user-a")),
    { read: true }
  ));
});

test("FR-14 owner cannot change notification content", async () => {
  await seedNotification();
  await assertFails(updateDoc(
    doc(verifiedUser(), notificationPath("user-a")),
    { title: "Tampered synthetic title" }
  ));
});

test("FR-16 owner cannot set notification read to a string", async () => {
  await seedNotification();
  await assertFails(updateDoc(
    doc(verifiedUser(), notificationPath("user-a")),
    { read: "true" }
  ));
});

test("FR-20c owner cannot delete a notification", async () => {
  await seedNotification();
  await assertFails(deleteDoc(
    doc(verifiedUser(), notificationPath("user-a"))
  ));
});

test("FR-19b synthetic admin can delete a notification", async () => {
  await seedNotification();
  await assertSucceeds(deleteDoc(
    doc(adminUser(), notificationPath("user-a"))
  ));
});

const updatePath = (id = "update-1") => `updates/${id}`;
const updateData = () => ({
  title: "Synthetic release note",
  body: "Emulator-only update",
  published: true
});

const seedUpdate = async (id = "update-1") => {
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), updatePath(id)), updateData());
  });
};

test("FR-22a verified user can read a published update", async () => {
  await seedUpdate();
  await assertSucceeds(getDoc(doc(verifiedUser(), updatePath())));
});

test("FR-22b unverified user cannot read updates", async () => {
  await seedUpdate();
  await assertFails(getDoc(doc(unverifiedUser(), updatePath())));
});

test("FR-22c synthetic admin can create an update", async () => {
  await assertSucceeds(setDoc(doc(adminUser(), updatePath()), updateData()));
});

test("FR-22d verified non-admin cannot create an update", async () => {
  await assertFails(setDoc(doc(verifiedUser(), updatePath()), updateData()));
});

test("FR-22e only synthetic admin can update or delete an update", async () => {
  await seedUpdate();
  await assertFails(updateDoc(doc(verifiedUser(), updatePath()), {
    title: "Unauthorized synthetic edit"
  }));
  await assertFails(deleteDoc(doc(verifiedUser(), updatePath())));
  await assertSucceeds(updateDoc(doc(adminUser(), updatePath()), {
    title: "Admin synthetic edit"
  }));
  await assertSucceeds(deleteDoc(doc(adminUser(), updatePath())));
});


const memberPath = (uid = "user-a") => `members/${uid}`;
const memberData = () => ({
  active: true,
  role: "operator"
});

const seedMember = async (uid = "user-a") => {
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), memberPath(uid)), memberData());
  });
};

test("FR-23a verified member can read their own membership", async () => {
  await seedMember("user-a");
  await assertSucceeds(getDoc(doc(verifiedUser(), memberPath("user-a"))));
});

test("FR-23b verified user cannot read another member document", async () => {
  await seedMember("user-b");
  await assertFails(getDoc(doc(verifiedUser(), memberPath("user-b"))));
});

test("FR-23c synthetic admin can read another member document", async () => {
  await seedMember("user-b");
  await assertSucceeds(getDoc(doc(adminUser(), memberPath("user-b"))));
});

test("FR-23d unverified user cannot read their own membership", async () => {
  await seedMember("user-unverified");
  await assertFails(getDoc(doc(unverifiedUser(), memberPath("user-unverified"))));
});

test("FR-23e non-admin cannot update or delete another member document", async () => {
  await seedMember("user-b");
  await assertFails(updateDoc(doc(verifiedUser(), memberPath("user-b")), {
    active: false
  }));
  await assertFails(deleteDoc(doc(verifiedUser(), memberPath("user-b"))));
});

test("FR-23f synthetic admin can update and delete a member document", async () => {
  await seedMember("user-b");
  await assertSucceeds(updateDoc(doc(adminUser(), memberPath("user-b")), {
    active: false
  }));
  await assertSucceeds(deleteDoc(doc(adminUser(), memberPath("user-b"))));
});

test("FR-23g verified non-admin cannot enumerate the members collection", async () => {
  await seedMember("user-a");
  await seedMember("user-b");
  await assertFails(getDocs(collection(verifiedUser(), "members")));
});

test("FR-23h synthetic admin can enumerate the members collection", async () => {
  await seedMember("user-a");
  await seedMember("user-b");
  const snapshot = await assertSucceeds(getDocs(collection(adminUser(), "members")));
  assert.equal(snapshot.size, 2);
});

test("FR-24a verified non-admin cannot enumerate the accessRequests collection", async () => {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, "accessRequests/user-a"), requestData("user-a", "user-a@example.invalid"));
    await setDoc(doc(db, "accessRequests/user-b"), requestData("user-b", "user-b@example.invalid"));
  });
  await assertFails(getDocs(collection(verifiedUser(), "accessRequests")));
});

test("FR-24b synthetic admin can enumerate the accessRequests collection", async () => {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, "accessRequests/user-a"), requestData("user-a", "user-a@example.invalid"));
    await setDoc(doc(db, "accessRequests/user-b"), requestData("user-b", "user-b@example.invalid"));
  });
  const snapshot = await assertSucceeds(getDocs(collection(adminUser(), "accessRequests")));
  assert.equal(snapshot.size, 2);
});

test("FR-25 documents that an owner can rewrite createdAt while status stays pending", async () => {
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(
      doc(context.firestore(), "accessRequests/user-a"),
      requestData("user-a", "user-a@example.invalid")
    );
  });
  await assertSucceeds(updateDoc(doc(verifiedUser(), "accessRequests/user-a"), {
    createdAt: "2035-12-31T23:59:59.000Z"
  }));
});
