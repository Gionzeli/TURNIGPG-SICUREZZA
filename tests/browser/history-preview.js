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
const pagination = {
  previous: document.querySelector("#page-previous"),
  next: document.querySelector("#page-next"),
  indicator: document.querySelector("#page-indicator")
};
const controls = {
  from: document.querySelector("#filter-from"),
  to: document.querySelector("#filter-to"),
  entity: document.querySelector("#filter-entity"),
  action: document.querySelector("#filter-action"),
  search: document.querySelector("#filter-search"),
  sort: document.querySelector("#filter-sort"),
  pageSize: document.querySelector("#filter-page-size"),
  clear: document.querySelector("#clear-filters"),
  export: document.querySelector("#export-csv")
};
let pageSize = Number(controls.pageSize.value);
let currentPage = 1;
let lastFilteredEvents = [];

function filterEvents(events) {
  const from = controls.from.value;
  const to = controls.to.value;
  const entity = controls.entity.value;
  const action = controls.action.value;
  const query = controls.search.value.trim().toLocaleLowerCase("it");
  if (from && to && from > to) {
    status.textContent = "Intervallo non valido: la data iniziale supera quella finale.";
    lastFilteredEvents = [];
    container.replaceChildren();
    pagination.previous.disabled = true;
    pagination.next.disabled = true;
    pagination.indicator.textContent = "Pagina 1 di 1";
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
  filtered.sort((a, b) => {
    const difference = Date.parse(a.occurredAt) - Date.parse(b.occurredAt);
    const stableOrder = difference || a.id.localeCompare(b.id);
    return controls.sort.value === "oldest" ? stableOrder : -stableOrder;
  });
  lastFilteredEvents = filtered;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  currentPage = Math.min(currentPage, pageCount);
  const start = (currentPage - 1) * pageSize;
  const visibleEvents = filtered.slice(start, start + pageSize);
  const count = renderHistoryEvents(container, visibleEvents);
  status.textContent = `${filtered.length} di ${events.length} eventi dimostrativi · pagina ${currentPage} di ${pageCount}`;
  pagination.indicator.textContent = `Pagina ${currentPage} di ${pageCount}`;
  pagination.previous.disabled = currentPage === 1;
  pagination.next.disabled = currentPage === pageCount;
  return count;
}

try {
  const service = new HistoryService({ repository: demoRepository });
  const events = await service.getRecentEvents(50);
  const refresh = (resetPage = true) => {
    if (resetPage) currentPage = 1;
    pageSize = Number(controls.pageSize.value);
    return filterEvents(events);
  };
  for (const control of [controls.from, controls.to, controls.entity, controls.action, controls.sort, controls.pageSize]) {
    control.addEventListener("change", () => refresh());
  }
  controls.search.addEventListener("input", () => refresh());
  pagination.previous.addEventListener("click", () => {
    if (currentPage > 1) { currentPage -= 1; refresh(false); }
  });
  pagination.next.addEventListener("click", () => {
    currentPage += 1;
    refresh(false);
  });
  controls.export.addEventListener("click", () => {
    const columns = ["Data e ora", "Elemento", "Azione", "Descrizione", "Revisione"];
    const escapeCell = value => {
      let text = String(value ?? "");
      if (/^[=+\\-@\\t\\r]/.test(text)) text = `"'${text}`;
      return `"${text.replace(/"/g, '""')}"`;
    };
    const rows = lastFilteredEvents.map(event => [event.occurredAt, event.entityLabel, event.actionLabel, event.description, event.revision]);
    const csv = [columns, ...rows].map(row => row.map(escapeCell).join(",")).join("\\r\\n");
    const blob = new Blob(["\\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "cronologia-demo.csv";
    link.click();
    URL.revokeObjectURL(url);
    status.textContent = `Esportati ${rows.length} eventi dimostrativi filtrati.`;
  });
  controls.clear.addEventListener("click", () => {
    controls.from.value = "";
    controls.to.value = "";
    controls.entity.value = "all";
    controls.action.value = "all";
    controls.search.value = "";
    controls.sort.value = "newest";
    controls.pageSize.value = "3";
    pageSize = 3;
    refresh();
  });
  refresh();
  document.documentElement.dataset.previewResult = "pass";
} catch {
  status.textContent = "Anteprima non disponibile.";
  document.documentElement.dataset.previewResult = "fail";
}
