import { createEmployeeScheduleEmailIngestion } from "./employee-schedule-email-ingestion.js";
import { createPdfScheduleColumnExtractor } from "./employee-schedule-pdf-column-mapper.js";

export function createPdfBackedEmployeeScheduleEmailIngestion({
  extractPdfTables,
  ...dependencies
}) {
  if (typeof extractPdfTables !== "function") {
    throw new TypeError("An approved PDF table extraction engine is required.");
  }
  if (Object.hasOwn(dependencies, "extractSchedule")) {
    throw new TypeError("extractSchedule cannot override the strict PDF column mapper.");
  }
  const extractSchedule = createPdfScheduleColumnExtractor({ extractPdfTables });
  return createEmployeeScheduleEmailIngestion({ ...dependencies, extractSchedule });
}
