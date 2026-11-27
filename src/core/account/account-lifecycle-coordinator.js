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
  let disposed = false;
  let cleanupTask = null;
  let disposeTask = null;
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

  async function runCleanupTracked(event) {
    const task = Promise.resolve().then(() => runCleanup(event));
    cleanupTask = task;
    try { await task; }
    finally { if (cleanupTask === task) cleanupTask = null; }
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
      return Object.freeze({ state, generation, cleanupComplete, disposed, accountId: state === "active" ? accountContext.getActive()?.accountId ?? null : null });
    },

    subscribe(listener) {
      if (disposed) throw new DatabaseError(DB_ERROR_CODES.ACCESS_DENIED, "Lifecycle dismesso definitivamente.");
      if (typeof listener !== "function") throw new DatabaseError(DB_ERROR_CODES.VALIDATION_FAILED, "Listener non valido.");
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    registerDisposable(dispose) {
      if (disposed) throw new DatabaseError(DB_ERROR_CODES.ACCESS_DENIED, "Lifecycle dismesso definitivamente.");
      if (typeof dispose !== "function") throw new DatabaseError(DB_ERROR_CODES.VALIDATION_FAILED, "Risorsa disposable non valida.");
      disposables.add(dispose);
      return () => disposables.delete(dispose);
    },

    async beginTransition(reason = "switch") {
      if (disposed) throw new DatabaseError(DB_ERROR_CODES.ACCESS_DENIED, "Lifecycle dismesso definitivamente.");
      if (!REASONS.has(reason)) throw new DatabaseError(DB_ERROR_CODES.VALIDATION_FAILED, "Motivo transizione non valido.");
      if (state === "switching") throw new DatabaseError(DB_ERROR_CODES.ACCESS_DENIED, "Transizione account già in corso.");
      state = "switching";
      generation += 1;
      transitionToken = Object.freeze({});
      accountContext.clear();
      cleanupComplete = false;
      await runCleanupTracked({ type: "transition-start", reason });
      return transitionToken;
    },

    activateLocal(token, accountId) {
      if (disposed) throw new DatabaseError(DB_ERROR_CODES.ACCESS_DENIED, "Lifecycle dismesso definitivamente.");
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
      if (disposed) throw new DatabaseError(DB_ERROR_CODES.ACCESS_DENIED, "Lifecycle dismesso definitivamente.");
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
      if (disposed) throw new DatabaseError(DB_ERROR_CODES.ACCESS_DENIED, "Usare dispose() per completare la pulizia del lifecycle dismesso.");
      if (state !== "switching" || !token || token !== transitionToken) {
        throw new DatabaseError(DB_ERROR_CODES.ACCESS_DENIED, "Token transizione non valido.");
      }
      await runCleanupTracked({ type: "transition-retry" });
      return cleanupComplete;
    },

    clear(token) {
      if (disposed) throw new DatabaseError(DB_ERROR_CODES.ACCESS_DENIED, "Lifecycle dismesso definitivamente.");
      if (state !== "switching" || !token || token !== transitionToken || !cleanupComplete) {
        throw new DatabaseError(DB_ERROR_CODES.ACCESS_DENIED, "Token transizione non valido o pulizia incompleta.");
      }
      accountContext.clear();
      state = "cleared";
      cleanupComplete = true;
      transitionToken = null;
      publish({ type: "context-cleared", reason: "logout" });
    },

    dispose() {
      if (disposeTask) return disposeTask;
      const task = (async () => {
        if (state === "disposed") return Object.freeze({ state, generation, cleanupComplete, disposed: true, accountId: null });
        disposed = true;
        accountContext.dispose?.();
        if (state !== "switching") {
          state = "switching";
          generation += 1;
          transitionToken = Object.freeze({});
          accountContext.clear();
          cleanupComplete = false;
          await runCleanupTracked({ type: "transition-start", reason: "dispose" });
        } else if (cleanupTask) {
          await cleanupTask;
        } else if (!cleanupComplete) {
          await runCleanupTracked({ type: "transition-retry", reason: "dispose" });
        }
        if (!cleanupComplete) throw new DatabaseError(DB_ERROR_CODES.ACCESS_DENIED, "Pulizia sessione incompleta; riprovare dispose() o resumePendingTransition().");
        accountContext.clear();
        state = "disposed";
        cleanupComplete = true;
        transitionToken = null;
        publish({ type: "context-disposed", reason: "dispose" });
        return Object.freeze({ state, generation, cleanupComplete, disposed: true, accountId: null });
      })();
      disposeTask = task;
      return task.finally(() => { if (disposeTask === task) disposeTask = null; });
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
