import { openDSMDatabase, closeDSMDatabase, getDSMDatabaseStatus } from "../../src/core/database/index.js";
import { createDSMComposition } from "../../src/ui/create-dsm-composition.js";
import { mountHistoryPage } from "../../src/ui/history-page.js";

const status = document.querySelector("#demo-status");
const closeButton = document.querySelector("#demo-close");
const root = document.querySelector("#demo-history");
let composition;
let databaseName;
let terminating = false;

async function removeDemoDatabase() {
  if (!databaseName || getDSMDatabaseStatus().isOpen) return;
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(databaseName);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Cancellazione database demo bloccata."));
  });
}

async function startDemo() {
  databaseName = `dsm-local-demo-${crypto.randomUUID()}`;
  const db = await openDSMDatabase({ name: databaseName });
  composition = createDSMComposition({
    db,
    accountId: "demo-account-synthetic-only",
    mount: async ({ session }) => {
      const examples = [
        { entityType: "shift", entityId: "demo-shift-001", action: "create", newRevision: 1 },
        { entityType: "profile", entityId: "demo-profile-001", action: "update", previousRevision: 1, newRevision: 2 },
        { entityType: "absence", entityId: "demo-absence-001", action: "create", newRevision: 1 }
      ];
      for (let index = 0; index < examples.length; index += 1) {
        await session.repositories.history.recordEvent(examples[index], {
          createdAt: new Date(Date.UTC(2026, 10, 24, 9, index * 15)).toISOString()
        });
      }
      const view = await mountHistoryPage(root, {
        historyService: session.services.history,
        lifecycleCoordinator: session.lifecycle,
        pageSize: 10
      });
      return () => view.destroy();
    },
    closeDatabase: async () => closeDSMDatabase()
  });
  await composition.start();
  status.textContent = "Sessione locale attiva — 3 eventi sintetici caricati.";
  closeButton.disabled = false;
}

closeButton.addEventListener("click", async () => {
  if (terminating || !composition) return;
  terminating = true;
  closeButton.disabled = true;
  status.textContent = "Chiusura sessione dimostrativa…";
  try {
    await composition.teardown();
    await removeDemoDatabase();
    status.textContent = "Dimostrazione terminata. Vista distrutta e database temporaneo cancellato.";
    document.documentElement.dataset.demoResult = "closed";
  } catch {
    status.textContent = "Chiusura incompleta. Non riavviare: ripetere il teardown dopo aver risolto il problema.";
    document.documentElement.dataset.demoResult = "error";
    terminating = false;
    closeButton.disabled = false;
  }
});

try {
  await startDemo();
  document.documentElement.dataset.demoResult = "ready";
} catch {
  status.textContent = "Impossibile avviare la dimostrazione locale. Nessun dato operativo è stato aperto.";
  document.documentElement.dataset.demoResult = "error";
  closeButton.disabled = true;
}
