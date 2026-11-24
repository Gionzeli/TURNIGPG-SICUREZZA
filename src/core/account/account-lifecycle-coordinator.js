import { DatabaseError, DB_ERROR_CODES } from "../database/database-errors.js";

const REASONS = new Set(["switch", "logout", "initialize"]);

function isExpiredFirebaseContext(context) {
  return context?.identitySource === "firebase" &&
    (!Number.isFinite(context.expiresAt) || context.expiresAt <= Date.now());
}

export function createAccountLifecycleCoordinator({ accountContext } = {}) {
  if (!accountContext || typeof accountContext.activate !== "function" ||
      typeof accountContext.clear !== "function" || typeof accountContext.getActive !== "function") {
    throw new DatabaseError(DB_ERROR_CODES.VALIDATION_FAILED, "Contesto account non valido.");
  }

  let state = "cleared";
  let generation = 0;
  let transitionToken = null;
  let cleanupComplete = true;
  const listeners = new Set();
  const disposables = new Set();

  async function runCleanup(event) {
    const listenerErrors = publish(event);
    const cleanupErrors = [];
    while (disposables.size > 0) {
      let batchFailed = false;
      for (const dispose of [...disposables]) {
        try { await dispose(); disposables.delete(dispose); }
        catch { cleanupErrors.push("dispose-error"); batchFailed = true; }
      }
      if (batchFailed) break;
    }
    cleanupComplete = listenerErrors.length === 0 && cleanupErrors.length === 0 && disposables.size === 0;
  }

  function publish(event) {
    const errors = [];
    for (const listener of [...listeners]) {
      try { listener(Object.freeze({ ...event, state, generation })); }
      catch { errors.push("listener-error"); }
    }
    return errors;
  }

  function requireCurrentFirebaseAuthorization() {
    const active = accountContext.getActive();
    if (isExpiredFirebaseContext(active)) {
      throw new DatabaseError(DB_ERROR_CODES.ACCESS_DENIED, "Autorizzazione Firebase scaduta; ri-autenticarsi.");
    }
    return active;
  }

  return Object.freeze({
    getStatus() {
      return Object.freeze({ state, generation, cleanupComplete, accountId: state === "active" ? accountContext.getActive()?.accountId ?? null : null });
    },

    subscribe(listener) {
      if (typeof listener !== "function") throw new DatabaseError(DB_ERROR_CODES.VALIDATION_FAILED, "Listener non valido.");
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    registerDisposable(dispose) {
      if (typeof dispose !== "function") throw new DatabaseError(DB_ERROR_CODES.VALIDATION_FAILED, "Risorsa disposable non valida.");
      disposables.add(dispose);
      return () => disposables.delete(dispose);
    },

    async beginTransition(reason = "switch") {
      if (!REASONS.has(reason)) throw new DatabaseError(DB_ERROR_CODES.VALIDATION_FAILED, "Motivo transizione non valido.");
      if (state === "switching") throw new DatabaseError(DB_ERROR_CODES.ACCESS_DENIED, "Transizione account già in corso.");
      state = "switching";
      generation += 1;
      transitionToken = Object.freeze({});
      accountContext.clear();
      cleanupComplete = false;
      await runCleanup({ type: "transition-start", reason });
      return transitionToken;
    },

    activateLocal(token, accountId) {
      if (state !== "switching" || !token || token !== transitionToken || !cleanupComplete) {
        throw new DatabaseError(DB_ERROR_CODES.ACCESS_DENIED, "Token transizione non valido.");
      }
      const active = accountContext.activate({ accountId, identitySource: "local" });
      state = "active";
      transitionToken = null;
      publish({ type: "context-active", reason: "activate" });
      return active;
    },

    activateFirebase(token, principal) {
      if (state !== "switching" || !token || token !== transitionToken || !cleanupComplete) {
        throw new DatabaseError(DB_ERROR_CODES.ACCESS_DENIED, "Token transizione non valido.");
      }
      const active = accountContext.activateFirebase(principal);
      state = "active";
      transitionToken = null;
      publish({ type: "context-active", reason: "firebase-activate" });
      return active;
    },

    async retryCleanup(token) {
      if (state !== "switching" || !token || token !== transitionToken) {
        throw new DatabaseError(DB_ERROR_CODES.ACCESS_DENIED, "Token transizione non valido.");
      }
      await runCleanup({ type: "transition-retry" });
      return cleanupComplete;
    },

    clear(token) {
      if (state !== "switching" || !token || token !== transitionToken || !cleanupComplete) {
        throw new DatabaseError(DB_ERROR_CODES.ACCESS_DENIED, "Token transizione non valido o pulizia incompleta.");
      }
      accountContext.clear();
      state = "cleared";
      cleanupComplete = true;
      transitionToken = null;
      publish({ type: "context-cleared", reason: "logout" });
    },

    capture() {
      if (state !== "active") throw new DatabaseError(DB_ERROR_CODES.ACCOUNT_REQUIRED, "Nessun account lifecycle attivo.");
      const active = requireCurrentFirebaseAuthorization();
      const { accountId } = accountContext.requireActive();
      if (isExpiredFirebaseContext(active)) {
        throw new DatabaseError(DB_ERROR_CODES.ACCESS_DENIED, "Autorizzazione Firebase scaduta; ri-autenticarsi.");
      }
      return Object.freeze({ accountId, generation });
    },

    isCurrent(capture) {
      if (!capture || state !== "active" || capture.generation !== generation) return false;
      const active = accountContext.getActive();
      if (isExpiredFirebaseContext(active)) return false;
      return active?.accountId === capture.accountId;
    }
  });
}
