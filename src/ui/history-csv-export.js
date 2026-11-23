const COLUMNS = ["Data e ora", "Elemento", "Azione", "Descrizione", "Revisione"];

function escapeCell(value) {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/** Crea CSV da DTO già sanitizzati; non include ID o payload interni. */
export function buildHistoryCsv(events) {
  if (!Array.isArray(events)) throw new TypeError("Gli eventi devono essere un array.");
  const rows = events.map(event => {
    if (!event || typeof event !== "object") throw new TypeError("Evento non valido.");
    return [event.occurredAt, event.entityLabel, event.actionLabel, event.description, event.revision];
  });
  return [COLUMNS, ...rows].map(row => row.map(escapeCell).join(",")).join("\r\n");
}
