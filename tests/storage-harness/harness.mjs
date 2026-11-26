// Synthetic reference harness. No Firebase, SQL driver, network, or credentials.
const clone = value => structuredClone(value);
const emptyState = () => ({ bindings: [], audit: [], revision: 0 });

function validate(state) {
  const uids = new Set();
  const employees = new Set();
  for (const b of state.bindings.filter(x => x.status === "active")) {
    const uidKey = b.accountId + ":" + b.uid;
    const employeeKey = b.accountId + ":" + b.employeeId;
    if (uids.has(uidKey) || employees.has(employeeKey)) {
      throw Object.assign(new Error("unique-binding-conflict"), { code: "conflict" });
    }
    uids.add(uidKey);
    employees.add(employeeKey);
  }
}

class Mutex {
  tail = Promise.resolve();
  async run(fn) {
    let release;
    const previous = this.tail;
    this.tail = new Promise(resolve => { release = resolve; });
    await previous;
    try { return await fn(); } finally { release(); }
  }
}

// Models Firestore's optimistic transaction shape, not the Firestore SDK/service.
export class FirestoreModel {
  state = emptyState();
  commitLock = new Mutex();
  async transaction(work, retries = 20) {
    for (let attempt = 0; attempt < retries; attempt++) {
      const baseRevision = this.state.revision;
      const draft = clone(this.state);
      const result = await work(draft);
      validate(draft);
      const committed = await this.commitLock.run(async () => {
        if (this.state.revision !== baseRevision) return false;
        draft.revision = baseRevision + 1;
        this.state = draft;
        return true;
      });
      if (committed) return result;
    }
    throw Object.assign(new Error("transaction-contention"), { code: "aborted" });
  }
  snapshot() { return clone(this.state); }
}

// Models relational serializable transactions + UNIQUE constraints in memory;
// it does not exercise PostgreSQL, SQL, locks, isolation levels, or RLS.
export class PostgresModel {
  state = emptyState();
  lock = new Mutex();
  async transaction(work) {
    return this.lock.run(async () => {
      const draft = clone(this.state);
      const result = await work(draft);
      validate(draft);
      draft.revision = this.state.revision + 1;
      this.state = draft;
      return result;
    });
  }
  snapshot() { return clone(this.state); }
}

export async function bind(adapter, { accountId, uid, employeeId, auditFailure = false }) {
  return adapter.transaction(async draft => {
    const existingUid = draft.bindings.find(x =>
      x.accountId === accountId && x.uid === uid && x.status === "active");
    const existingEmployee = draft.bindings.find(x =>
      x.accountId === accountId && x.employeeId === employeeId && x.status === "active");
    if (existingUid || existingEmployee) {
      if (existingUid?.employeeId === employeeId && existingEmployee?.uid === uid) return "idempotent";
      throw Object.assign(new Error("binding-conflict"), { code: "conflict" });
    }
    draft.bindings.push({ accountId, uid, employeeId, status: "active" });
    if (auditFailure) throw Object.assign(new Error("synthetic-audit-failure"), { code: "audit-failed" });
    draft.audit.push({ actor: "synthetic-server-actor", action: "binding-created", accountId, uid, employeeId });
    return "created";
  });
}

export function assertStateInvariants(state) {
  validate(state);
  for (const b of state.bindings) {
    if (!b.accountId || !b.uid || !b.employeeId) throw new Error("malformed-binding");
  }
  return true;
}
