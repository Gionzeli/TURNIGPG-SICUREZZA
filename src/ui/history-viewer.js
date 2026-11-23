const ALLOWED_ACTIONS = new Set(["Creato", "Modificato", "Eliminato"]);
const ALLOWED_ENTITIES = new Set(["Turno", "Profilo", "Impostazione"]);

function formatDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Data non disponibile";
  return new Intl.DateTimeFormat("it-IT", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

/**
 * Renderizza esclusivamente il DTO sanitizzato prodotto da HistoryService.
 * Usa textContent e non inserisce mai HTML proveniente dai dati.
 */
export function renderHistoryEvents(container, events) {
  if (!container || typeof container.replaceChildren !== "function") {
    throw new TypeError("Contenitore cronologia non valido.");
  }
  if (!Array.isArray(events)) throw new TypeError("La cronologia deve essere un array.");

  const list = document.createElement("ol");
  list.className = "dsm-history-list";
  list.setAttribute("aria-label", "Cronologia delle modifiche");

  if (events.length === 0) {
    const empty = document.createElement("p");
    empty.className = "dsm-history-empty";
    empty.textContent = "Nessuna attività registrata.";
    container.replaceChildren(empty);
    return 0;
  }

  for (const event of events) {
    if (!event || typeof event !== "object" ||
        !ALLOWED_ENTITIES.has(event.entityLabel) ||
        !ALLOWED_ACTIONS.has(event.actionLabel) ||
        typeof event.description !== "string" ||
        typeof event.occurredAt !== "string" ||
        !Number.isSafeInteger(event.revision)) {
      throw new TypeError("Evento cronologico non valido.");
    }

    const item = document.createElement("li");
    item.className = "dsm-history-item";

    const title = document.createElement("strong");
    title.textContent = event.description;

    const time = document.createElement("time");
    time.dateTime = event.occurredAt;
    time.textContent = formatDate(event.occurredAt);

    const revision = document.createElement("span");
    revision.className = "dsm-history-revision";
    revision.textContent = `Revisione ${event.newRevision ?? event.revision}`;

    item.append(title, time, revision);
    list.append(item);
  }

  container.replaceChildren(list);
  return events.length;
}
