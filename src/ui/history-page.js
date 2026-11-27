import { renderHistoryEvents } from "./history-viewer.js";
import { buildHistoryCsv } from "./history-csv-export.js";

const ENTITIES = Object.freeze(["Tutti", "Turno", "Profilo", "Impostazione", "Assenza"]);
const ACTIONS = Object.freeze(["Tutte", "Creato", "Modificato", "Eliminato"]);
const PAGE_SIZES = Object.freeze([10, 25, 50]);

function element(tag, attributes = {}, text = null) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (key === "className") node.className = value;
    else if (key === "type" || key === "name" || key === "id" || key === "value" || key === "placeholder") node.setAttribute(key, value);
    else if (key === "disabled") node.disabled = Boolean(value);
  }
  if (text !== null) node.textContent = text;
  return node;
}

function field(labelText, control) {
  const label = element("label", { className: "dsm-history-field" });
  label.append(element("span", {}, labelText), control);
  return label;
}

function select(options, values = options) {
  const node = element("select");
  options.forEach((label, index) => {
    const option = element("option", { value: values[index] }, label);
    node.append(option);
  });
  return node;
}

function localDay(value) {
  return String(value).slice(0, 10);
}

function matches(event, filters) {
  const day = localDay(event.occurredAt);
  const query = filters.search.trim().toLocaleLowerCase("it");
  return (!filters.from || day >= filters.from) &&
    (!filters.to || day <= filters.to) &&
    (filters.entity === "Tutti" || event.entityLabel === filters.entity) &&
    (filters.action === "Tutte" || event.actionLabel === filters.action) &&
    (!query || [event.entityLabel, event.actionLabel, event.description, day, String(event.revision)]
      .some(value => value.toLocaleLowerCase("it").includes(query)));
}

/**
 * Monta la cronologia DSM usando esclusivamente HistoryService.
 * Il chiamante deve fornire un servizio già associato all'account autorizzato.
 * Restituisce destroy() per rimuovere listener e contenuto.
 */
export async function mountHistoryPage(container, { historyService, pageSize = 25, lifecycleCoordinator = null } = {}) {
  if (!container || typeof container.replaceChildren !== "function") {
    throw new TypeError("Contenitore cronologia non valido.");
  }
  if (!historyService || typeof historyService.getRecentEvents !== "function") {
    throw new TypeError("HistoryService non disponibile.");
  }
  if (!PAGE_SIZES.includes(pageSize)) throw new TypeError("Dimensione pagina non valida.");
  if (lifecycleCoordinator && (
    typeof lifecycleCoordinator.capture !== "function" ||
    typeof lifecycleCoordinator.isCurrent !== "function" ||
    typeof lifecycleCoordinator.subscribe !== "function"
  )) throw new TypeError("Coordinatore lifecycle non valido.");
  const lifecycleCapture = lifecycleCoordinator ? lifecycleCoordinator.capture() : null;

  const heading = element("h1", {}, "Cronologia delle modifiche");
  const description = element("p", { className: "dsm-history-intro" },
    "Registro delle operazioni DSM. Sono mostrati solo eventi e descrizioni sanificate.");
  const filtersNode = element("div", { className: "dsm-history-filters" });
  const search = element("input", { type: "search", placeholder: "Cerca nella cronologia" });
  const from = element("input", { type: "date" });
  const to = element("input", { type: "date" });
  const entity = select(ENTITIES);
  const action = select(ACTIONS);
  const sort = select(["Più recenti", "Più vecchi"], ["newest", "oldest"]);
  const size = select(["10 eventi", "25 eventi", "50 eventi"], ["10", "25", "50"]);
  size.value = String(pageSize);
  const reset = element("button", { type: "button" }, "Azzera filtri");
  const exportButton = element("button", { type: "button", disabled: true }, "Esporta CSV");
  filtersNode.append(
    field("Ricerca", search), field("Dal giorno", from), field("Al giorno", to),
    field("Elemento", entity), field("Azione", action), field("Ordine", sort),
    field("Eventi per pagina", size), reset, exportButton
  );

  const status = element("p", { className: "dsm-history-status" }, "Caricamento cronologia…");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const eventsNode = element("div", { className: "dsm-history-results" });
  const pagination = element("nav", { className: "dsm-history-pagination" });
  pagination.setAttribute("aria-label", "Pagine cronologia");
  const previous = element("button", { type: "button", disabled: true }, "Precedente");
  const indicator = element("span", {}, "Pagina 1 di 1");
  const next = element("button", { type: "button", disabled: true }, "Successiva");
  pagination.append(previous, indicator, next);
  container.replaceChildren(heading, description, filtersNode, status, eventsNode, pagination);

  let events = [];
  let filtered = [];
  let currentPage = 1;
  let destroyed = false;
  const listeners = [];
  let unsubscribeLifecycle = null;
  let destroyedHandle = false;
  const on = (node, eventName, callback) => {
    node.addEventListener(eventName, callback);
    listeners.push(() => node.removeEventListener(eventName, callback));
  };
  const getFilters = () => ({
    search: search.value,
    from: from.value,
    to: to.value,
    entity: entity.value,
    action: action.value
  });

  function render(resetPage = true) {
    if (destroyed) return;
    if (resetPage) currentPage = 1;
    const filters = getFilters();
    if (filters.from && filters.to && filters.from > filters.to) {
      filtered = [];
      status.textContent = "Intervallo non valido: la data iniziale supera quella finale.";
    } else {
      filtered = events.filter(event => matches(event, filters));
      status.textContent = `${filtered.length} di ${events.length} eventi`;
    }
    filtered.sort((a, b) => {
      const delta = Date.parse(a.occurredAt) - Date.parse(b.occurredAt);
      const stable = delta || String(a.id).localeCompare(String(b.id));
      return sort.value === "oldest" ? stable : -stable;
    });
    const perPage = Number(size.value);
    const pageCount = Math.max(1, Math.ceil(filtered.length / perPage));
    currentPage = Math.min(currentPage, pageCount);
    const start = (currentPage - 1) * perPage;
    renderHistoryEvents(eventsNode, filtered.slice(start, start + perPage));
    indicator.textContent = `Pagina ${currentPage} di ${pageCount}`;
    previous.disabled = currentPage === 1;
    next.disabled = currentPage === pageCount;
    exportButton.disabled = filtered.length === 0;
  }

  const refresh = () => render(true);
  for (const control of [from, to, entity, action, sort, size]) on(control, "change", refresh);
  on(search, "input", refresh);
  on(reset, "click", () => {
    search.value = "";
    from.value = "";
    to.value = "";
    entity.value = "Tutti";
    action.value = "Tutte";
    sort.value = "newest";
    size.value = String(pageSize);
    render();
  });
  on(previous, "click", () => { if (currentPage > 1) { currentPage--; render(false); } });
  on(next, "click", () => { currentPage++; render(false); });
  on(exportButton, "click", () => {
    if (!filtered.length) return;
    const blob = new Blob(["\uFEFF", buildHistoryCsv(filtered)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = element("a");
    link.download = "cronologia-dsm.csv";
    link.href = url;
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    status.textContent = `Esportati ${filtered.length} eventi filtrati.`;
  });

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    listeners.forEach(remove => remove());
    unsubscribeLifecycle?.();
    unsubscribeLifecycle = null;
    container.replaceChildren();
  }

  if (lifecycleCoordinator) {
    unsubscribeLifecycle = lifecycleCoordinator.subscribe(event => {
      if (event.type === "transition-start" || event.type === "context-cleared") destroy();
    });
  }

  try {
    events = await historyService.getRecentEvents(200);
    if (destroyed || (lifecycleCapture && !lifecycleCoordinator.isCurrent(lifecycleCapture))) {
      destroy();
      destroyedHandle = true;
    } else {
      if (!Array.isArray(events)) throw new TypeError("Risposta cronologia non valida.");
      render();
    }
  } catch {
    if (destroyed) destroyedHandle = true;
    if (!destroyed) status.textContent = "Impossibile caricare la cronologia. Verifica l'accesso e riprova.";
    eventsNode.replaceChildren();
    exportButton.disabled = true;
    previous.disabled = true;
    next.disabled = true;
    if (!destroyed) {
      destroy();
      throw new Error("Caricamento cronologia DSM non riuscito.");
    }
  }

  return Object.freeze({ refresh, get destroyed() { return destroyed || destroyedHandle; }, destroy });
}
