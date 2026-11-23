import { DatabaseError, DB_ERROR_CODES } from "./database-errors.js";
import { createAccountContext } from "../account/account-context.js";
import { createAccountLifecycleCoordinator } from "../account/account-lifecycle-coordinator.js";
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

export async function createDSMCoreSession({ db, accountId } = {}) {
  if (!db || typeof db.transaction !== "function" || !db.objectStoreNames) {
    throw new DatabaseError(DB_ERROR_CODES.VALIDATION_FAILED, "Connessione database DSM non valida.");
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

  async function activateLocal(nextAccountId, reason) {
    const token = await lifecycle.beginTransition(reason);
    lifecycle.activateLocal(token, nextAccountId);
    return lifecycle.getStatus();
  }

  if (accountId !== undefined) await activateLocal(accountId, "initialize");

  return Object.freeze({
    accountContext,
    lifecycle,
    repositories,
    services,
    switchLocalAccount(nextAccountId) {
      return activateLocal(nextAccountId, "switch");
    },
    async logout() {
      const token = await lifecycle.beginTransition("logout");
      lifecycle.clear(token);
      return lifecycle.getStatus();
    }
  });
}
