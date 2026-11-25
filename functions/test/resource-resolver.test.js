import test from "node:test";
import assert from "node:assert/strict";
import {
  authorizeCanonicalResource,
  resolveCanonicalResourceContext
} from "../src/membership/resource-resolver.js";

const principal = {
  uid: "mgr1", accountId: "acct1", role: "manager", scopeType: "site",
  scopeIds: ["siteA"], permissions: ["dsm:read:site", "dsm:manage:departments"]
};
const records = {
  account: { accountId: "acct1", displayName: "Synthetic account" },
  site: { accountId: "acct1", siteId: "siteA", displayName: "Synthetic site" },
  department: {
    accountId: "acct1", siteId: "siteA", departmentId: "deptA",
    displayName: "Synthetic department"
  }
};
const calls = [];
const loaders = {
  async loadAccount(accountId) {
    calls.push(["account", accountId]);
    return accountId === records.account.accountId ? records.account : null;
  },
  async loadSite(accountId, siteId) {
    calls.push(["site", accountId, siteId]);
    return accountId === records.site.accountId && siteId === records.site.siteId ? records.site : null;
  },
  async loadDepartment(accountId, siteId, departmentId) {
    calls.push(["department", accountId, siteId, departmentId]);
    return accountId === records.department.accountId &&
      siteId === records.department.siteId &&
      departmentId === records.department.departmentId ? records.department : null;
  }
};

test("resolves account-level context only after canonical account lookup", async () => {
  calls.length = 0;
  const context = await resolveCanonicalResourceContext({
    principal,
    selector: { type: "account", accountId: "acct1" },
    loaders
  });
  assert.deepEqual(context, { accountId: "acct1", siteId: null, departmentId: null });
  assert.deepEqual(calls, [["account", "acct1"]]);
  assert.equal(Object.isFrozen(context), true);
});

test("resolves site and department through canonical parent chain", async () => {
  calls.length = 0;
  const context = await resolveCanonicalResourceContext({
    principal,
    selector: { type: "department", accountId: "acct1", siteId: "siteA", departmentId: "deptA" },
    loaders
  });
  assert.deepEqual(context, { accountId: "acct1", siteId: "siteA", departmentId: "deptA" });
  assert.deepEqual(calls, [
    ["account", "acct1"],
    ["site", "acct1", "siteA"],
    ["department", "acct1", "siteA", "deptA"]
  ]);
});

test("ignores display labels and never copies selector-supplied claims into context", async () => {
  const context = await resolveCanonicalResourceContext({
    principal,
    selector: {
      type: "department", accountId: "acct1", siteId: "siteA", departmentId: "deptA",
      role: "admin", scopeIds: ["siteB"], permissions: ["dsm:manage:account"],
      canonical: true, displayName: "Forged label"
    },
    loaders
  });
  assert.deepEqual(Object.keys(context).sort(), ["accountId", "departmentId", "siteId"]);
  assert.equal(context.siteId, "siteA");
  assert.equal(context.departmentId, "deptA");
});

test("denies missing records and cross-account or cross-parent records", async () => {
  const badLoaders = {
    ...loaders,
    async loadSite() {
      return { accountId: "acct2", siteId: "siteA" };
    }
  };
  await assert.rejects(resolveCanonicalResourceContext({
    principal, selector: { type: "site", accountId: "acct1", siteId: "siteA" },
    loaders: badLoaders
  }), error => error.code === "permission-denied");

  const badDepartmentLoaders = {
    ...loaders,
    async loadDepartment() {
      return { accountId: "acct1", siteId: "siteB", departmentId: "deptA" };
    }
  };
  await assert.rejects(resolveCanonicalResourceContext({
    principal,
    selector: { type: "department", accountId: "acct1", siteId: "siteA", departmentId: "deptA" },
    loaders: badDepartmentLoaders
  }), error => error.code === "permission-denied");

  await assert.rejects(resolveCanonicalResourceContext({
    principal, selector: { type: "site", accountId: "acct1", siteId: "missing" },
    loaders
  }), error => error.code === "permission-denied");
});

test("denies malformed selectors and account mismatch before resource lookup", async () => {
  calls.length = 0;
  for (const selector of [
    { type: "site", accountId: "acct2", siteId: "siteA" },
    { type: "site", accountId: "acct1", siteId: "../siteA" },
    { type: "department", accountId: "acct1", siteId: null, departmentId: "deptA" },
    { type: "unknown", accountId: "acct1" },
    []
  ]) {
    await assert.rejects(resolveCanonicalResourceContext({
      principal, selector, loaders
    }), error => error.code === "permission-denied");
  }
  assert.deepEqual(calls, []);
});

test("composes canonical resolution with scope authorization", async () => {
  const allowed = await authorizeCanonicalResource({
    principal, permission: "dsm:manage:departments",
    selector: { type: "department", accountId: "acct1", siteId: "siteA", departmentId: "deptA" },
    loaders
  });
  assert.equal(allowed.authorized, true);

  await assert.rejects(authorizeCanonicalResource({
    principal, permission: "dsm:manage:departments",
    selector: { type: "department", accountId: "acct1", siteId: "siteB", departmentId: "deptA" },
    loaders
  }), error => error.code === "permission-denied");
});


test("denies absent or mismatched canonical account before descendant lookups", async () => {
  calls.length = 0;
  const missingAccount = {
    ...loaders,
    async loadAccount(accountId) {
      calls.push(["account", accountId]);
      return null;
    }
  };
  await assert.rejects(resolveCanonicalResourceContext({
    principal,
    selector: { type: "site", accountId: "acct1", siteId: "siteA" },
    loaders: missingAccount
  }), error => error.code === "permission-denied");
  assert.deepEqual(calls, [["account", "acct1"]]);

  calls.length = 0;
  const mismatchedAccount = {
    ...loaders,
    async loadAccount(accountId) {
      calls.push(["account", accountId]);
      return { accountId: "acct-other" };
    }
  };
  await assert.rejects(resolveCanonicalResourceContext({
    principal,
    selector: { type: "department", accountId: "acct1", siteId: "siteA", departmentId: "deptA" },
    loaders: mismatchedAccount
  }), error => error.code === "permission-denied");
  assert.deepEqual(calls, [["account", "acct1"]]);
});

test("denies malformed canonical site and department records", async () => {
  const malformedSite = {
    ...loaders,
    async loadSite() { return ["not-a-canonical-record"]; }
  };
  await assert.rejects(resolveCanonicalResourceContext({
    principal,
    selector: { type: "site", accountId: "acct1", siteId: "siteA" },
    loaders: malformedSite
  }), error => error.code === "permission-denied");

  for (const record of [
    null,
    { accountId: "acct1", siteId: "siteA" },
    { accountId: "acct1", siteId: "siteA", departmentId: "dept-other" },
    { accountId: "acct-other", siteId: "siteA", departmentId: "deptA" },
    { accountId: "acct1", siteId: "site-other", departmentId: "deptA" }
  ]) {
    const malformedDepartment = {
      ...loaders,
      async loadDepartment() { return record; }
    };
    await assert.rejects(resolveCanonicalResourceContext({
      principal,
      selector: { type: "department", accountId: "acct1", siteId: "siteA", departmentId: "deptA" },
      loaders: malformedDepartment
    }), error => error.code === "permission-denied");
  }
});

test("rejects malformed principal identity before invoking any loader", async () => {
  calls.length = 0;
  await assert.rejects(resolveCanonicalResourceContext({
    principal: { ...principal, accountId: "../acct1" },
    selector: { type: "account", accountId: "acct1" },
    loaders
  }), error => error.code === "permission-denied");
  assert.deepEqual(calls, []);
});

test("denies malformed canonical site records before department lookup", async () => {
  const selector = {
    type: "department", accountId: "acct1", siteId: "siteA", departmentId: "deptA"
  };
  const malformedSiteRecords = [
    null,
    {},
    { accountId: "acct1" },
    { accountId: "acct1", siteId: "site-other" },
    { accountId: "acct-other", siteId: "siteA" }
  ];

  for (const siteRecord of malformedSiteRecords) {
    const observed = [];
    const malformedSiteLoaders = {
      async loadAccount(accountId) {
        observed.push(["account", accountId]);
        return records.account;
      },
      async loadSite(accountId, siteId) {
        observed.push(["site", accountId, siteId]);
        return siteRecord;
      },
      async loadDepartment(accountId, siteId, departmentId) {
        observed.push(["department", accountId, siteId, departmentId]);
        return records.department;
      }
    };

    await assert.rejects(resolveCanonicalResourceContext({
      principal, selector, loaders: malformedSiteLoaders
    }), error => error.code === "permission-denied");
    assert.deepEqual(observed, [
      ["account", "acct1"],
      ["site", "acct1", "siteA"]
    ]);
  }
});


test("normalizes canonical loader failures to permission-denied and stops resolution", async () => {
  const cases = [
    ["account", { async loadAccount() { throw new Error("storage unavailable"); } }],
    ["site", { async loadSite() { throw new Error("storage unavailable"); } }],
    ["department", { async loadDepartment() { throw new Error("storage unavailable"); } }]
  ];
  for (const [failedLoader, override] of cases) {
    const seen = [];
    const faultLoaders = {
      async loadAccount(id) { seen.push("account"); return records.account; },
      async loadSite(a, s) { seen.push("site"); return records.site; },
      async loadDepartment(a, s, d) { seen.push("department"); return records.department; },
      ...override
    };
    const selector = failedLoader === "account"
      ? { type: "account", accountId: "acct1" }
      : failedLoader === "site"
        ? { type: "site", accountId: "acct1", siteId: "siteA" }
        : { type: "department", accountId: "acct1", siteId: "siteA", departmentId: "deptA" };
    await assert.rejects(resolveCanonicalResourceContext({ principal, selector, loaders: faultLoaders }),
      error => error.code === "permission-denied");
  }
});
