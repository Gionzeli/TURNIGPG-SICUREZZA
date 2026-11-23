import { HistoryService } from "../../src/core/services/history-service.js";
import { renderHistoryEvents } from "../../src/ui/history-viewer.js";

// Repository fittizio: nessun IndexedDB, LocalStorage, Firebase o dato operativo.
const sampleEvents = [
  {
    id: "demo-event-003", createdAt: "2026-11-23T09:45:00.000Z", revision: 1,
    data: { entityType: "setting", entityId: "demo-setting", action: "update", previousRevision: 1, newRevision: 2 }
  },
  {
    id: "demo-event-002", createdAt: "2026-11-22T14:20:00.000Z", revision: 1,
    data: { entityType: "profile", entityId: "demo-profile", action: "update", previousRevision: 1, newRevision: 2 }
  },
  {
    id: "demo-event-001", createdAt: "2026-11-21T08:00:00.000Z", revision: 1,
    data: { entityType: "shift", entityId: "demo-shift", action: "create", newRevision: 1 }
  }
];

const demoRepository = Object.freeze({
  async getRecentEvents(limit = 50) {
    return sampleEvents.slice(0, limit);
  },
  async getEventsForEntity() {
    return sampleEvents;
  }
});

const status = document.querySelector("#history-status");
const container = document.querySelector("#history-events");

try {
  const service = new HistoryService({ repository: demoRepository });
  const events = await service.getRecentEvents(20);
  const count = renderHistoryEvents(container, events);
  status.textContent = `${count} eventi dimostrativi · dati inventati`;
  document.documentElement.dataset.previewResult = "pass";
} catch {
  status.textContent = "Anteprima non disponibile.";
  document.documentElement.dataset.previewResult = "fail";
}
