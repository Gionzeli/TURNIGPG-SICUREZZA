import { randomUUID } from "node:crypto";
import { verifyIdentity } from "../auth/verify-identity.js";
import { createEmployeeShiftFirestoreAuthorization } from "./employee-shift-firestore-authorization.js";

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const validId = value => typeof value === "string" && ID.test(value);
function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function bearer(request) {
  const header = request?.rawRequest?.headers?.authorization;
  const match = typeof header === "string" ? /^Bearer ([^\s]+)$/i.exec(header) : null;
  if (!match) fail("unauthenticated", "Bearer ID token required.");
  return match[1];
}
function dataObject(request, allowed) {
  const data = request?.data;
  if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).some(k => !allowed.includes(k))) {
    fail("invalid-argument", "Callable data contains unsupported fields.");
  }
  return data;
}
function id(value) { if (!validId(value)) fail("invalid-argument", "Invalid identifier."); return value; }
function validDate(value) { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const d = new Date(value + "T00:00:00Z"); return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value; }
const DTO_KEYS = ["date", "type", "post", "start_time", "end_time", "hours", "is_night", "is_sunday", "is_piantonato", "is_rest_not_enjoyed", "has_meal_voucher"];

const PROPOSAL_FIELDS = new Set(["date", "type", "post", "start_time", "end_time", "hours", "is_night", "is_sunday", "is_piantonato", "is_rest_not_enjoyed", "has_meal_voucher"]);
function validateProposedFields(fields, { allowDate }) {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) fail("invalid-argument", "Shift fields must be an object.");
  for (const [key, value] of Object.entries(fields)) {
    if (!PROPOSAL_FIELDS.has(key) || (!allowDate && key === "date")) fail("invalid-argument", "Unsupported shift field.");
    if (key === "date" && !validDate(value)) fail("invalid-argument", "Invalid proposed shift date.");
    if (key === "type" && (typeof value !== "string" || !["turno", "turno_riposo", "riposo", "riposo_compensativo", "ferie", "permesso", "malattia"].includes(value))) fail("invalid-argument", "Invalid shift type.");
    if (key === "post" && (typeof value !== "string" || value.length > 80)) fail("invalid-argument", "Invalid shift post.");
    if (["start_time", "end_time"].includes(key) && (typeof value !== "string" || (value !== "" && !/^(?:[01]\\d|2[0-3]):[0-5]\\d$/.test(value)))) fail("invalid-argument", "Invalid shift time.");
    if (key === "hours" && (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 48)) fail("invalid-argument", "Invalid shift hours.");
    if (["is_night", "is_sunday", "is_piantonato", "is_rest_not_enjoyed", "has_meal_voucher"].includes(key) && typeof value !== "boolean") fail("invalid-argument", "Invalid shift flag.");
  }
  if (Object.hasOwn(fields, "start_time") !== Object.hasOwn(fields, "end_time")) fail("invalid-argument", "Shift start and end times must be supplied together.");
}
function validateProposalChanges(changes) {
  if (!Array.isArray(changes) || changes.length < 1 || changes.length > 30) fail("invalid-argument", "A proposal must contain 1 to 30 shift changes.");
  const seen = new Set();
  return changes.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item) ||
        !["create", "update", "delete"].includes(item.operation)) fail("invalid-argument", "Invalid shift proposal operation.");
    const operation = item.operation;
    if (operation === "create") {
      if (Object.keys(item).some(k => !["operation", "shift"].includes(k))) fail("invalid-argument", "Invalid create proposal.");
      validateProposedFields(item.shift, { allowDate: true });
      if (!validDate(item.shift.date) || typeof item.shift.type !== "string") fail("invalid-argument", "Create proposal requires date and type.");
      return { operation, shift: { ...item.shift } };
    }
    if (Object.keys(item).some(k => !["operation", "shiftId", "expectedRevision", "changes"].includes(k)) ||
        !validId(item.shiftId) || !Number.isSafeInteger(item.expectedRevision) || item.expectedRevision < 1 ||
        seen.has(item.shiftId)) fail("invalid-argument", "Invalid or duplicate shift proposal target.");
    seen.add(item.shiftId);
    if (operation === "delete") {
      if (item.changes !== undefined) fail("invalid-argument", "Delete proposal cannot contain changes.");
      return { operation, shiftId: item.shiftId, expectedRevision: item.expectedRevision };
    }
    validateProposedFields(item.changes, { allowDate: false });
    if (Object.keys(item.changes).length < 1) fail("invalid-argument", "Update proposal requires changes.");
    return { operation, shiftId: item.shiftId, expectedRevision: item.expectedRevision, changes: { ...item.changes } };
  });
}


export function createEmployeeShiftCallableHandlers({ db, verifyToken, now = () => Date.now() }) {
  if (!db || typeof verifyToken !== "function") throw new TypeError("Trusted Firestore and token verifier required.");
  const authorization = createEmployeeShiftFirestoreAuthorization({ db, now });
  async function actor(request) {
    try { return await verifyIdentity(bearer(request), verifyToken); }
    catch { fail("unauthenticated", "Identity verification failed."); }
  }
  return Object.freeze({
    async listOwn(request) {
      const data = dataObject(request, ["accountId", "fromDate", "toDate"]);
      const identity = await actor(request), accountId = id(data.accountId);
      if (!validDate(data.fromDate) || !validDate(data.toDate) || data.toDate < data.fromDate) fail("invalid-argument", "Invalid shift date range.");
      return db.runTransaction(async tx => {
        const principal = await authorization.loadOwnPrincipal(tx, { accountId, actorUid: identity.uid, operation: "read" });
        const query = db.collection(`accounts/${accountId}/employeeShifts`)
          .where("employeeId", "==", principal.employeeId)
          .where("date", ">=", data.fromDate)
          .where("date", "<=", data.toDate)
          .orderBy("date", "asc")
          .limit(201);
        const snapshots = await tx.get(query);
        if (snapshots.size > 200) fail("resource-exhausted", "Shift result exceeds the safe response bound.");
        const result = [];
        for (const snapshot of snapshots.docs) {
          const shift = snapshot.data();
          if (shift.accountId !== accountId || shift.employeeId !== principal.employeeId ||
              shift.status !== "active" || !validDate(shift.date) || shift.date < data.fromDate ||
              shift.date > data.toDate || !validId(shift.placementId) || !validId(shift.siteId) ||
              !validId(shift.departmentId) || !Number.isSafeInteger(shift.revision) || shift.revision < 1) continue;
          const placement = await authorization.loadPlacementAt(tx, accountId, principal.employeeId, shift.date);
          const inMembershipScope = principal.scopeType === "site"
            ? principal.scopeIds.includes(placement.siteId)
            : principal.scopeType === "department" && principal.scopeIds.includes(placement.departmentId);
          if (!inMembershipScope || placement.placementId !== shift.placementId ||
              placement.siteId !== shift.siteId || placement.departmentId !== shift.departmentId) continue;
          const dto = { shiftId: snapshot.id };
          for (const key of DTO_KEYS) if (Object.hasOwn(shift, key)) dto[key] = shift[key];
          dto.revision = shift.revision;
          result.push(dto);
        }
        return result.sort((a, b) => a.date.localeCompare(b.date));
      });
    },

    async proposeOwn(request) {
      const data = dataObject(request, ["accountId", "changes", "source"]);
      const identity = await actor(request), accountId = id(data.accountId);
      if (data.source !== undefined && data.source !== "employee_manual") fail("invalid-argument", "Only employee-entered proposals are accepted here.");
      const changes = validateProposalChanges(data.changes);
      const proposalId = randomUUID().replace(/-/g, "");
      return db.runTransaction(async tx => {
        const principal = await authorization.loadOwnPrincipal(tx, { accountId, actorUid: identity.uid, operation: "read" });
        const accountRef = db.doc(`accounts/${accountId}`);
        const accountSnap = await tx.get(accountRef);
        if (!accountSnap.exists || accountSnap.data().status !== "active") fail("failed-precondition", "Active account required.");
        for (const change of changes) {
          if (change.operation === "create") {
            const placement = await authorization.loadPlacementAt(tx, accountId, principal.employeeId, change.shift.date);
            if (!principal.scopeIds.includes(principal.scopeType === "site" ? placement.siteId : placement.departmentId)) fail("permission-denied", "Proposed shift is outside the employee membership scope.");
            continue;
          }
          const shiftRef = db.doc(`accounts/${accountId}/employeeShifts/${change.shiftId}`);
          const shiftSnap = await tx.get(shiftRef);
          if (!shiftSnap.exists) fail("not-found", "A referenced shift no longer exists.");
          const shift = shiftSnap.data();
          if (shift.accountId !== accountId || shift.employeeId !== principal.employeeId || shift.status !== "active" ||
              shift.revision !== change.expectedRevision || !validDate(shift.date)) fail("failed-precondition", "A referenced shift changed or is not owned by this employee.");
          const placement = await authorization.loadPlacementAt(tx, accountId, principal.employeeId, shift.date);
          if (placement.placementId !== shift.placementId || placement.siteId !== shift.siteId || placement.departmentId !== shift.departmentId) fail("permission-denied", "Shift placement no longer matches canonical history.");
        }
        const timestamp = now();
        if (!Number.isSafeInteger(timestamp)) fail("failed-precondition", "Invalid trusted clock.");
        const ref = db.doc(`accounts/${accountId}/employeeShiftProposals/${proposalId}`);
        tx.create(ref, {
          proposalId, accountId, employeeId: principal.employeeId, proposerUid: identity.uid,
          source: "employee_manual", changes, status: "pending", createdAt: timestamp,
          updatedAt: timestamp, schemaVersion: 1
        });
        return { proposalId, status: "pending", changeCount: changes.length };
      });
    },
    async listOwnProposals(request) {
      const data = dataObject(request, ["accountId"]);
      const identity = await actor(request), accountId = id(data.accountId);
      return db.runTransaction(async tx => {
        const principal = await authorization.loadOwnPrincipal(tx, { accountId, actorUid: identity.uid, operation: "read" });
        const query = db.collection(`accounts/${accountId}/employeeShiftProposals`)
          .where("employeeId", "==", principal.employeeId).orderBy("createdAt", "desc").limit(50);
        const snapshots = await tx.get(query);
        return snapshots.docs.map(snapshot => {
          const proposal = snapshot.data();
          if (proposal.accountId !== accountId || proposal.employeeId !== principal.employeeId ||
              !["pending", "rejected", "approved", "superseded"].includes(proposal.status) ||
              !Array.isArray(proposal.changes) || !Number.isSafeInteger(proposal.createdAt)) return null;
          return {
            proposalId: snapshot.id, status: proposal.status, source: proposal.source,
            createdAt: proposal.createdAt, changeCount: proposal.changes.length,
            changes: proposal.changes
          };
        }).filter(Boolean);
      });
    },
    async rejectOwnProposal(request) {
      const data = dataObject(request, ["accountId", "proposalId"]);
      const identity = await actor(request), accountId = id(data.accountId), proposalId = id(data.proposalId);
      return db.runTransaction(async tx => {
        const principal = await authorization.loadOwnPrincipal(tx, { accountId, actorUid: identity.uid, operation: "read" });
        const ref = db.doc(`accounts/${accountId}/employeeShiftProposals/${proposalId}`);
        const snapshot = await tx.get(ref);
        if (!snapshot.exists) fail("not-found", "Proposal not found.");
        const proposal = snapshot.data();
        if (proposal.accountId !== accountId || proposal.employeeId !== principal.employeeId || proposal.proposerUid !== identity.uid) fail("permission-denied", "Proposal does not belong to this employee.");
        if (proposal.status !== "pending") fail("failed-precondition", "Only pending proposals can be rejected.");
        const timestamp = now();
        if (!Number.isSafeInteger(timestamp)) fail("failed-precondition", "Invalid trusted clock.");
        tx.update(ref, { status: "rejected", decidedAt: timestamp, decidedBy: identity.uid, updatedAt: timestamp });
        return { proposalId, status: "rejected" };
      });
    },
    async create() {
      fail("failed-precondition", "Direct shift mutations are disabled; use the personal schedule proposal and approval workflow.");
    },
    async update() {
      fail("failed-precondition", "Direct shift mutations are disabled; use the personal schedule proposal and approval workflow.");
    },
    async delete() {
      fail("failed-precondition", "Direct shift mutations are disabled; use the personal schedule proposal and approval workflow.");
    }
  });
}
