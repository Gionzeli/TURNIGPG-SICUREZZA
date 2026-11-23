import { HistoryService } from "../../src/core/services/history-service.js";
import { mountHistoryPage } from "../../src/ui/history-page.js";

const sampleEvents = Array.from({ length: 12 }, (_, index) => {
  const entityType = ["shift", "profile", "setting"][index % 3];
  const action = ["create", "update", "delete"][index % 3];
  return {
    id: `page-test-${String(index + 1).padStart(2, "0")}`,
    createdAt: new Date(Date.UTC(2026, 10, 23, 12, index)).toISOString(),
    revision: 1,
    data: {
      entityType,
      entityId: `synthetic-${index + 1}`,
      action,
      ...(action === "update" ? { previousRevision: 1, newRevision: 2 } : {}),
      ...(action === "create" ? { newRevision: 1 } : {}),
      ...(action === "delete" ? { previousRevision: 1 } : {})
    }
  };
});
const repository = Object.freeze({
  async getRecentEvents(limit = 50) { return sampleEvents.slice(0, limit); }
});

try {
  await mountHistoryPage(document.querySelector("#history-root"), {
    historyService: new HistoryService({ repository })
  });
  document.documentElement.dataset.pageResult = "pass";
  document.querySelector("#test-status").textContent = "Pagina cronologia pronta.";
} catch {
  document.documentElement.dataset.pageResult = "fail";
  document.querySelector("#test-status").textContent = "Test pagina cronologia non riuscito.";
}
