import { HistoryService } from "../../src/core/services/history-service.js";
import { renderHistoryEvents } from "../../src/ui/history-viewer.js";

// Repository fittizio: nessun IndexedDB, LocalStorage, Firebase o dato operativo.
const sampleEvents = [
  { id: "demo-event-006", createdAt: "2026-11-23T09:45:00.000Z", revision: 1,
    data: { entityType: "setting", entityId: "demo-setting", action: "update", previousRevision: 1, newRevision: 2 } },
  { id: "demo-event-005", createdAt: "2026-11-23T08:30:00.000Z", revision: 1,
    data: { entityType: "shift", entityId: "demo-shift-old", action: "delete", previousRevision: 1 } },
  { id: "demo-event-004", createdAt: "2026-11-22T16:10:00.000Z", revision: 1,
    data: { entityType: "profile", entityId: "demo-profile-new", action: "create", newRevision: 1 } },
  { id: "demo-event-003", createdAt: "2026-11-22T14:20:00.000Z", revision: 1,
    data: { entityType: "profile", entityId: "demo-profile", action: "update", previousRevision: 1, newRevision: 2 } },
  { id: "demo-event-002", createdAt: "2026-11-21T12:00:00.000Z", revision: 1,
    data: { entityType: "shift", entityId: "demo-shift-two", action: "update", previousRevision: 1, newRevision: 2 } },
  { id: "demo-event-001", createdAt: "2026-11-21T08:00:00.000Z", revision: 1,
    data: { entityType: "shift", entityId: "demo-shift", action: "create", newRevision: 1 } }
];

const demoRepository = Object.freeze({
  async getRecentEvents(limit = 50) { return sampleEvents.slice(0, limit); },
  async getEventsForEntity() { return sampleEvents; }
});

const status = document.querySelector("#history-status");
const container = document.querySelector("#history-events");
const controls = {
  from: document.querySelector("#filter-from"),
  to: document.querySelector("#filter-to"),
  entity: document.querySelector("#filter-entity"),
  action: document.querySelector("#filter-action"),
  search: document.querySelector("#filter-search"),
  clear: document.querySelector("#clear-filters")
};

function filterEvents(events) {
  const from = controls.from.value;
  const to = controls.to.value;
  const entity = controls.entity.value;
  const action = controls.action.value;
  const query = controls.search.value.trim().toLocaleLowerCase("it");
  if (from && to && from > to) {
    status.textContent = "Intervallo non valido: la data iniziale supera quella finale.";
    container.replaceChildren();
    return 0;
  }
  const filtered = events.filter(event => {
    const day = event.occurredAt.slice(0, 10);
    return (!from || day >= from) && (!to || day <= to) &&
      (entity === "all" || event.entityLabel === entity) &&
      (action === "all" || event.actionLabel === action) &&
      (!query || [event.entityLabel, event.actionLabel, event.description, day, String(event.revision)].
        some(value => value.toLocaleLowerCase("it").includes(query)));
  });
  const count = renderHistoryEvents(container, filtered);
  status.textContent = `${count} di ${events.length} eventi dimostrativi · dati inventati`;
  return count;
}

try {
  const service = new HistoryService({ repository: demoRepository });
  const events = await service.getRecentEvents(50);
  const refresh = () => filterEvents(events);
  for (const control of [controls.from, controls.to, controls.entity, controls.action, controls.search]) {
    control.addEventListener("change", refresh);
  }
  controls.clear.addEventListener("click", () => {
    controls.from.value = "";
    controls.to.value = "";
    controls.entity.value = "all";
    controls.action.value = "all";
    controls.search.value = "";
    refresh();
  });
  refresh();
  document.documentElement.dataset.previewResult = "pass";
} catch {
  status.textContent = "Anteprima non disponibile.";
  document.documentElement.dataset.previewResult = "fail";
}
