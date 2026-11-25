export {
  openDSMDatabase,
  closeDSMDatabase,
  getDSMDatabaseStatus
} from "./database.js";

export {
  DSM_DB_NAME,
  DSM_DB_VERSION,
  DSM_OBJECT_STORES
} from "./database-schema.js";

export {
  DatabaseError,
  DB_ERROR_CODES
} from "./database-errors.js";

export { createAccountContext } from "../account/account-context.js";
export { ProfileRepository } from "../repositories/profile-repository.js";
export { ShiftRepository } from "../repositories/shift-repository.js";
export { AbsenceRepository } from "../repositories/absence-repository.js";
export { SettingsRepository } from "../repositories/settings-repository.js";
export { MigrationJobRepository } from "../repositories/migration-job-repository.js";
export { QuarantineRepository } from "../repositories/quarantine-repository.js";

export { ProfileService } from "../services/profile-service.js";
export { ShiftService } from "../services/shift-service.js";
export { AbsenceService } from "../services/absence-service.js";
export { HistoryService } from "../services/history-service.js";

export { inspectLegacySnapshot, inspectLegacyExtras, inspectLegacyArchive, inspectLegacyReconciliation, inspectLegacyExport, inspectLegacyShiftChronology } from "../legacy/legacy-read-adapter.js";

export { HistoryRepository } from "../repositories/history-repository.js";

export { createAccountLifecycleCoordinator } from "../account/account-lifecycle-coordinator.js";

export { createDSMCoreSession } from "./create-dsm-session.js";

export { createAccountLifecycleCrossTabBridge } from "../account/account-lifecycle-cross-tab.js";
