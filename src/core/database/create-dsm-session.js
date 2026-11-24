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

  async function activateFirebaseAccount() {
    if (!firebaseAuthAdapter) {
      throw new DatabaseError(DB_ERROR_CODES.VALIDATION_FAILED, "Adapter Firebase non configurato.");
    }
    const revision = authRevision;
    const principal = await firebaseAuthAdapter.getPrincipal();
    if (!principal) {
      if (lifecycle.getStatus().state === "active") await logout();
      return null;
    }
    if (revision !== authRevision) {
      throw new DatabaseError(DB_ERROR_CODES.ACCESS_DENIED, "Stato Firebase cambiato durante l'autorizzazione.");
    }
    const token = await lifecycle.beginTransition("switch");
    pendingTransition = { token, action: "activate-firebase", principal };
    try {
      if (revision !== authRevision) {
        await lifecycle.retryCleanup(token);
        lifecycle.clear(token);
        pendingTransition = null;
        throw new DatabaseError(DB_ERROR_CODES.ACCESS_DENIED, "Sessione Firebase cambiata prima dell'attivazione.");
      }
      lifecycle.activateFirebase(token, principal);
      pendingTransition = null;
      return lifecycle.getStatus();
    } catch (error) {
      throw error;
    }
  }

  const unsubscribeFirebase = firebaseAuthAdapter?.subscribe(event => {
    authRevision += 1;
    // Fail closed on every auth-state transition. A newly authenticated user must
    // explicitly call activateFirebaseAccount after the adapter has resolved membership.
    if (lifecycle.getStatus().state === "active") {
      authChangeTask = authChangeTask.then(() => logout()).catch(() => undefined);
    }
  }) ?? null;

  async function activateLocal(nextAccountId, reason) {
    const token = await lifecycle.beginTransition(reason);
    pendingTransition = { token, action: "activate", accountId: nextAccountId };
    try {
      lifecycle.activateLocal(token, nextAccountId);
      pendingTransition = null;
      return lifecycle.getStatus();
    } catch (error) {
      // Keep the opaque token so the caller can retry failed cleanup safely.
      throw error;
    }
  }

  async function logout() {
    const token = await lifecycle.beginTransition("logout");
    pendingTransition = { token, action: "logout", accountId: null };
    if (!lifecycle.getStatus().cleanupComplete) {
      throw new DatabaseError(DB_ERROR_CODES.ACCESS_DENIED, "Pulizia risorse incompleta; riprendere il logout.");
    }
    lifecycle.clear(token);
    pendingTransition = null;
    return lifecycle.getStatus();
  }

  async function resumePendingTransition() {
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
    if (pending.action === "activate-firebase") lifecycle.activateFirebase(pending.token, pending.principal);
    else lifecycle.activateLocal(pending.token, pending.accountId);
    pendingTransition = null;
    return lifecycle.getStatus();
  }

  if (accountId !== undefined) await activateLocal(accountId, "initialize");
  const crossTabBridge = crossTabChannel
    ? createAccountLifecycleCrossTabBridge({ lifecycleCoordinator: lifecycle, channel: crossTabChannel, tabId })
    : null;

  return Object.freeze({
    accountContext,
    lifecycle,
    repositories,
    services,
    crossTabBridge,
    dispose() {
      unsubscribeFirebase?.();
      crossTabBridge?.dispose();
    },
    switchLocalAccount(nextAccountId) {
      return activateLocal(nextAccountId, "switch");
    },
    activateFirebase: activateFirebaseAccount,
    logout,
    resumePendingTransition
  });
}
