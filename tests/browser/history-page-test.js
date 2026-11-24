import { HistoryService } from "../../src/core/services/history-service.js";
import { createAccountContext, createAccountLifecycleCoordinator } from "../../src/core/database/index.js";
import { mountHistoryPage } from "../../src/ui/history-page.js";
import { createDSMComposition } from "../../src/ui/create-dsm-composition.js";

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
  const lifecycleRoot = document.createElement("section");
  document.body.append(lifecycleRoot);
  const lifecyclePage = await mountHistoryPage(lifecycleRoot, {
    historyService: new HistoryService({ repository }),
    lifecycleCoordinator: lifecycle,
    pageSize: 10
  });
  const detachedExportButton = lifecycleRoot.querySelector(".dsm-history-filters button:last-child");
  if (!detachedExportButton || detachedExportButton.disabled) {
    throw new Error("L'esportazione sintetica non era disponibile prima della transizione.");
  }
  let objectUrlCreations = 0;
  const originalCreateObjectURL = URL.createObjectURL;
  URL.createObjectURL = (...args) => {
    objectUrlCreations += 1;
    return originalCreateObjectURL.apply(URL, args);
  };
  const uiSwitch = await lifecycle.beginTransition("switch");
  if (lifecycleRoot.childNodes.length !== 0 || !lifecyclePage.destroyed) {
    throw new Error("La vista cronologia non è stata svuotata all'inizio della transizione.");
  }
  detachedExportButton.click();
  URL.createObjectURL = originalCreateObjectURL;
  if (objectUrlCreations !== 0) {
    throw new Error("Un pulsante di esportazione obsoleto ha generato un CSV dopo la transizione.");
  }
  lifecycle.activateLocal(uiSwitch, "history-page-account-B");
  lifecycleRoot.remove();

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

  let cleanupAttempts = 0;
  let databaseCloseAttempts = 0;
  const composition = createDSMComposition({
    db: { transaction() {}, objectStoreNames: [] },
    accountId: "synthetic-composition-account",
    mount: ({ registerCleanup }) => {
      registerCleanup(() => {
        cleanupAttempts += 1;
        if (cleanupAttempts === 1) throw new Error("synthetic partial mount cleanup failure");
      });
      throw new Error("synthetic view mount failure");
    },
    closeDatabase: async () => { databaseCloseAttempts += 1; }
  });
  let mountFailure;
  try { await composition.start(); } catch (error) { mountFailure = error; }
  if (!(mountFailure instanceof AggregateError) || composition.status === "closed" ||
      databaseCloseAttempts !== 0 || cleanupAttempts !== 1) {
    throw new Error("Il composition root non ha mantenuto il teardown bloccato dopo il mount parziale.");
  }
  await composition.teardown();
  if (composition.status !== "closed" || cleanupAttempts !== 2 || databaseCloseAttempts !== 1) {
    throw new Error("Il retry del teardown non ha completato cleanup e chiusura DB nell'ordine previsto.");
  }

  window.__historySearchControl = document.querySelector(".dsm-history-filters input[type=search]");
  window.__historyStatusNode = document.querySelector(".dsm-history-status");
  document.documentElement.dataset.pageResult = "pass";
  document.querySelector("#test-status").textContent = "Pagina cronologia pronta.";
} catch {
  document.documentElement.dataset.pageResult = "fail";
  document.querySelector("#test-status").textContent = "Test pagina cronologia non riuscito.";
}
