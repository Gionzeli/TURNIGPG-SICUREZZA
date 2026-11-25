import { DatabaseError, DB_ERROR_CODES } from "./database-errors.js";
import { createAccountContext } from "../account/account-context.js";
import { createAccountLifecycleCoordinator } from "../account/account-lifecycle-coordinator.js";
import { createAccountLifecycleCrossTabBridge } from "../account/account-lifecycle-cross-tab.js";
import { ProfileRepository } from "../repositories/profile-repository.js";
import { ShiftRepository } from "../repositories/shift-repository.js";
import { AbsenceRepository } from "../repositories/absence-repository.js";
import { SettingsRepository } from "../repositories/settings-repository.js";
import { HistoryRepository } from "../repositories/history-repository.js";
import { MigrationJobRepository } from "../repositories/migration-job-repository.js";
import { QuarantineRepository } from "../repositories/quarantine-repository.js";
import { ProfileService } from "../services/profile-service.js";
import { ShiftService } from "../services/shift-service.js";
import { AbsenceService } from "../services/absence-service.js";
import { HistoryService } from "../services/history-service.js";

export async function createDSMCoreSession({ db, accountId, crossTabChannel, tabId, firebaseAuthAdapter } = {}) {
  if ((crossTabChannel === undefined) !== (tabId === undefined)) {
    throw new DatabaseError(DB_ERROR_CODES.VALIDATION_FAILED, "Canale e identificativo scheda devono essere forniti insieme.");
  }
  if (!db || typeof db.transaction !== "function" || !db.objectStoreNames) {
    throw new DatabaseError(DB_ERROR_CODES.VALIDATION_FAILED, "Connessione database DSM non valida.");
  }
  if (firebaseAuthAdapter !== undefined &&
      (!firebaseAuthAdapter || typeof firebaseAuthAdapter.getPrincipal !== "function" ||
       typeof firebaseAuthAdapter.subscribe !== "function")) {
    throw new DatabaseError(DB_ERROR_CODES.VALIDATION_FAILED, "Adapter Firebase non valido.");
  }

  const accountContext = createAccountContext();
  const lifecycle = createAccountLifecycleCoordinator({ accountContext });
  const shared = { db, accountContext, lifecycleCoordinator: lifecycle };
  const repositories = Object.freeze({
    profiles: new ProfileRepository(shared),
    shifts: new ShiftRepository(shared),
    absences: new AbsenceRepository(shared),
    settings: new SettingsRepository(shared),
    history: new HistoryRepository(shared),
    migrationJobs: new MigrationJobRepository(shared),
    quarantine: new QuarantineRepository(shared)
  });
  const services = Object.freeze({
    profiles: new ProfileService({ repository: repositories.profiles }),
    shifts: new ShiftService({ repository: repositories.shifts }),
    absences: new AbsenceService({ repository: repositories.absences }),
    history: new HistoryService({ repository: repositories.history })
  });

  let pendingTransition = null;
  let authRevision = 0;
  let authChangeTask = Promise.resolve();
  let disposed = false;
  let disposeTask = null;
  let firebaseUnsubscribed = false;

  function assertSessionActive() {
    if (disposed) throw new DatabaseError(DB_ERROR_CODES.ACCESS_DENIED, "Sessione DSM dismessa definitivamente.");
  }

  async function clearPendingTransition(pending) {
    if (!pending || pendingTransition !== pending) return lifecycle.getStatus();
    const complete = await lifecycle.retryCleanup(pending.token);
    if (!complete) {
      throw new DatabaseError(DB_ERROR_CODES.ACCESS_DENIED, "Pulizia risorse ancora incompleta; riprovare.");
    }
    lifecycle.clear(pending.token);
    pendingTransition = null;
    return lifecycle.getStatus();
  }

  async function activateFirebaseAccount() {
    assertSessionActive();
    if (!firebaseAuthAdapter) {
      throw new DatabaseError(DB_ERROR_CODES.VALIDATION_FAILED, "Adapter Firebase non configurato.");
    }
    const revision = authRevision;
    let principal;
    try {
      principal = await firebaseAuthAdapter.getPrincipal();
    } catch (error) {
      // An explicit revalidation failure must never leave a previously active
      // Firebase principal usable. Wait for any auth-event invalidation first
      // to avoid racing two concurrent logout transitions.
      await authChangeTask;
      const active = accountContext.getActive();
      if (lifecycle.getStatus().state === "active" && active?.identitySource === "firebase") {
        try {
          await logout();
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            "Verifica Firebase fallita; contesto invalidato ma pulizia incompleta."
          );
        }
      }
      throw error;
    }
    assertSessionActive();
    if (!principal) {
      if (lifecycle.getStatus().state === "active") await logout();
      return null;
    }
    if (revision !== authRevision) {
      throw new DatabaseError(DB_ERROR_CODES.ACCESS_DENIED, "Stato Firebase cambiato durante l'autorizzazione.");
    }
    const token = await lifecycle.beginTransition("switch");
    assertSessionActive();
    const pending = { token, action: "activate-firebase", principal, authRevision: revision };
    pendingTransition = pending;
    if (revision !== authRevision) {
      await clearPendingTransition(pending);
      throw new DatabaseError(DB_ERROR_CODES.ACCESS_DENIED, "Sessione Firebase cambiata prima dell'attivazione.");
    }
    try {
      lifecycle.activateFirebase(token, principal);
      pendingTransition = null;
      return lifecycle.getStatus();
    } catch (error) {
      // Preserve the opaque token so cleanup can be retried; resume revalidates Auth.
      throw error;
    }
  }

  async function handleAuthStateChange() {
    if (disposed) return;
    const status = lifecycle.getStatus();
    if (status.state === "active") {
      const token = await lifecycle.beginTransition("logout");
      const pending = { token, action: "logout", accountId: null };
      pendingTransition = pending;
      if (!lifecycle.getStatus().cleanupComplete) {
        throw new DatabaseError(DB_ERROR_CODES.ACCESS_DENIED, "Pulizia risorse incompleta; riprendere il logout.");
      }
      lifecycle.clear(token);
      pendingTransition = null;
      return;
    }
  }

  const unsubscribeFirebase = firebaseAuthAdapter?.subscribe(() => {
    if (disposed) return;
    authRevision += 1;
    // Serialize invalidation. A revision mismatch prevents any pending Firebase
    // principal from being resumed, even if its cleanup had previously failed.
    authChangeTask = authChangeTask.then(handleAuthStateChange).catch(() => undefined);
  }) ?? null;

  async function activateLocal(nextAccountId, reason) {
    assertSessionActive();
    const token = await lifecycle.beginTransition(reason);
    assertSessionActive();
    const pending = { token, action: "activate", accountId: nextAccountId };
    pendingTransition = pending;
    try {
      lifecycle.activateLocal(token, nextAccountId);
      pendingTransition = null;
      return lifecycle.getStatus();
    } catch (error) {
      throw error;
    }
  }

  async function logout() {
    assertSessionActive();
    const token = await lifecycle.beginTransition("logout");
    assertSessionActive();
    const pending = { token, action: "logout", accountId: null };
    pendingTransition = pending;
    if (!lifecycle.getStatus().cleanupComplete) {
      throw new DatabaseError(DB_ERROR_CODES.ACCESS_DENIED, "Pulizia risorse incompleta; riprendere il logout.");
    }
    lifecycle.clear(token);
    pendingTransition = null;
    return lifecycle.getStatus();
  }

  async function resumePendingTransition() {
    if (disposed) {
      const status = await lifecycle.dispose();
      pendingTransition = null;
      return status;
    }
    if (!pendingTransition) {
      throw new DatabaseError(DB_ERROR_CODES.VALIDATION_FAILED, "Nessuna transizione da riprendere.");
    }
    const pending = pendingTransition;
    const complete = await lifecycle.retryCleanup(pending.token);
    if (!complete) {
      throw new DatabaseError(DB_ERROR_CODES.ACCESS_DENIED, "Pulizia risorse ancora incompleta; riprovare.");
    }

    if (pending.action === "logout") {
      lifecycle.clear(pending.token);
      pendingTransition = null;
      return lifecycle.getStatus();
    }

    if (pending.action === "activate-firebase") {
      if (pending.authRevision !== authRevision) {
        lifecycle.clear(pending.token);
        pendingTransition = null;
        return lifecycle.getStatus();
      }
      // Never resume from the stored principal alone. Resolve membership again
      // against the adapter's current Auth state and reject any intervening event.
      const principal = await firebaseAuthAdapter.getPrincipal();
      if (!principal || pending.authRevision !== authRevision) {
        lifecycle.clear(pending.token);
        pendingTransition = null;
        return lifecycle.getStatus();
      }
      lifecycle.activateFirebase(pending.token, principal);
    } else {
      lifecycle.activateLocal(pending.token, pending.accountId);
    }
    pendingTransition = null;
    return lifecycle.getStatus();
  }

  if (accountId !== undefined) await activateLocal(accountId, "initialize");
  const crossTabBridge = crossTabChannel
    ? createAccountLifecycleCrossTabBridge({ lifecycleCoordinator: lifecycle, channel: crossTabChannel, tabId })
    : null;

  function disposeSession() {
    if (disposeTask) return disposeTask;
    disposed = true;
    authRevision += 1;
    if (!firebaseUnsubscribed) {
      unsubscribeFirebase?.();
      firebaseUnsubscribed = true;
    }
    const task = (async () => {
      try {
        const status = await lifecycle.dispose();
        pendingTransition = null;
        return status;
      } finally {
        crossTabBridge?.dispose({ terminal: true });
      }
    })();
    disposeTask = task;
    return task.finally(() => { if (disposeTask === task) disposeTask = null; });
  }

  return Object.freeze({
    accountContext,
    lifecycle,
    repositories,
    services,
    crossTabBridge,
    dispose: disposeSession,
    switchLocalAccount(nextAccountId) {
      return activateLocal(nextAccountId, "switch");
    },
    activateFirebase: activateFirebaseAccount,
    logout,
    resumePendingTransition
  });
}
