import { HistoryService } from "../../src/core/services/history-service.js";
import { createAccountContext, createAccountLifecycleCoordinator } from "../../src/core/database/index.js";
import { mountHistoryPage } from "../../src/ui/history-page.js";

const sampleEvents = Array.from({ length: 12 }, (_, index) => {
  const entityType = ["shift", "profile", "setting", "absence"][index % 4];
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
  window.__historyPageController = await mountHistoryPage(document.querySelector("#history-root"), {
    historyService: new HistoryService({ repository }),
    pageSize: 10
  });

  const context = createAccountContext();
  const lifecycle = createAccountLifecycleCoordinator({ accountContext: context });
  const initialToken = await lifecycle.beginTransition("initialize");
  lifecycle.activateLocal(initialToken, "history-page-account-A");
  const staleRoot = document.createElement("section");
  document.body.append(staleRoot);
  let resolveStaleRead;
  const pendingMount = mountHistoryPage(staleRoot, {
    historyService: { getRecentEvents: () => new Promise(resolve => { resolveStaleRead = resolve; }) },
    lifecycleCoordinator: lifecycle
  });
  await Promise.resolve();
  const switchToken = await lifecycle.beginTransition("switch");
  lifecycle.activateLocal(switchToken, "history-page-account-B");
  resolveStaleRead(sampleEvents);
  const staleController = await pendingMount;
  if (staleRoot.childNodes.length !== 0 || !staleController.destroyed) {
    throw new Error("La cronologia ha mantenuto dati obsoleti dopo il cambio account.");
  }
  staleRoot.remove();

  window.__historySearchControl = document.querySelector(".dsm-history-filters input[type=search]");
  window.__historyStatusNode = document.querySelector(".dsm-history-status");
  document.documentElement.dataset.pageResult = "pass";
  document.querySelector("#test-status").textContent = "Pagina cronologia pronta.";
} catch {
  document.documentElement.dataset.pageResult = "fail";
  document.querySelector("#test-status").textContent = "Test pagina cronologia non riuscito.";
}
