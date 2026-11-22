import { inspectLegacyReconciliation } from "../src/core/legacy/legacy-read-adapter.js";

const fileInput = document.querySelector("#files");
const analyzeButton = document.querySelector("#analyze");
const downloadButton = document.querySelector("#download");
const statusNode = document.querySelector("#status");
const errorNode = document.querySelector("#error");
const reportNode = document.querySelector("#report");
let safeReport = null;

const text = (node, value) => { node.textContent = String(value); };
const element = (tag, value) => {
  const node = document.createElement(tag);
  if (value !== undefined) text(node, value);
  return node;
};
const table = (headers, rows) => {
  const wrapper = element("div");
  const tableNode = element("table");
  const head = element("thead");
  const headRow = element("tr");
  for (const title of headers) headRow.append(element("th", title));
  head.append(headRow);
  const body = element("tbody");
  for (const row of rows) {
    const tr = element("tr");
    for (const value of row) tr.append(element("td", value ?? "—"));
    body.append(tr);
  }
  tableNode.append(head, body);
  wrapper.append(tableNode);
  return wrapper;
};
const clear = node => { node.replaceChildren(); };

fileInput.addEventListener("change", () => {
  const files = [...fileInput.files];
  analyzeButton.disabled = files.length < 2 || files.length > 100 ||
    files.some(file => file.size > 10 * 1024 * 1024);
  errorNode.textContent = "";
  reportNode.hidden = true;
  safeReport = null;
  if (!files.length) text(statusNode, "In attesa dei file.");
  else if (files.length < 2) text(statusNode, "Seleziona almeno due export per confrontare le fonti.");
  else if (files.length > 100) text(statusNode, "Limite superato: massimo 100 file.");
  else if (files.some(file => file.size > 10 * 1024 * 1024)) text(statusNode, "Un file supera il limite di 10 MB.");
  else text(statusNode, files.length + " file selezionati. Nessun file è stato ancora letto.");
});

analyzeButton.addEventListener("click", async () => {
  const files = [...fileInput.files];
  if (files.length < 2 || files.length > 100) return;
  analyzeButton.disabled = true;
  errorNode.textContent = "";
  text(statusNode, "Analisi locale in corso…");
  try {
    const used = new Map();
    const candidates = await Promise.all(files.map(async (file, index) => {
      let label = file.name.slice(0, 80) || `export-${index + 1}`;
      const count = used.get(label) ?? 0;
      used.set(label, count + 1);
      if (count) label = `${label.slice(0, 70)}-${count + 1}`;
      return { source: label, rawJson: await file.text() };
    }));
    const result = inspectLegacyReconciliation(candidates);
    safeReport = {
      generatedAt: new Date().toISOString(),
      mode: result.mode,
      sourceCount: result.sourceCount,
      migrationReadiness: result.migrationReadiness,
      sources: result.sources,
      totals: result.totals,
      profileConflicts: result.profileConflicts.map(item => ({
        section: item.section, field: item.field, sources: item.values.map(value => value.source)
      })),
      extraConflicts: result.extraConflicts.map(item => ({
        field: item.field, sources: item.values.map(value => value.source)
      })),
      identicalGroups: result.identicalRecords.length,
      idConflictGroups: result.idConflicts.length,
      possibleDuplicateGroups: result.possibleDuplicates.map(item => ({
        reason: item.reason, copies: item.copies.map(copy => ({ source: copy.source, index: copy.index }))
      })),
      quarantine: result.quarantine,
      quarantinedShifts: result.quarantinedShifts,
      quarantinedTemplates: result.quarantinedTemplates,
      quarantinedSkills: result.quarantinedSkills,
      warnings: result.warnings,
      writesPerformed: result.writesPerformed,
      automaticMergePerformed: result.automaticMergePerformed
    };
    render(safeReport);
    reportNode.hidden = false;
    text(statusNode, "Analisi completata. I file originali non sono stati modificati.");
  } catch (error) {
    reportNode.hidden = true;
    safeReport = null;
    text(errorNode, error instanceof Error ? error.message : "Errore durante l'analisi.");
    text(statusNode, "Analisi non completata.");
  } finally {
    analyzeButton.disabled = false;
  }
});

function render(report) {
  const ready = report.migrationReadiness;
  text(document.querySelector("#readiness"),
    ready.reviewRequired
      ? "Revisione necessaria: sono presenti differenze, avvisi o elementi da verificare."
      : "Nessun conflitto rilevato dai controlli eseguiti. Non equivale ad autorizzazione all'importazione.");
  text(document.querySelector("#totals"),
    `Fonti: ${report.sourceCount} · Turni validi esaminati: ${report.totals.shiftsReady} · Conflitti profilo: ${report.totals.profileConflictFields} · Conflitti extra: ${report.totals.extraConflictFields} · Duplicati possibili: ${report.totals.possibleDuplicateGroups}`);

  const sourceRows = report.sources.map(item => [
    item.source, item.shiftsTotal, item.shiftsReady, item.shiftsQuarantined,
    item.profileValid ? "Valido" : "Da verificare",
    item.extraTemplates ?? "—", item.extraTemplatesQuarantined ?? "—",
    item.extraSkills ?? "—", item.extraSkillsQuarantined ?? "—",
    item.extraMonthlyValues ?? "—", item.warnings, item.importable ? "Sì" : "No"
  ]);
  const sourceHost = document.querySelector("#sources");
  clear(sourceHost);
  sourceHost.append(table(["File", "Turni", "Pronti", "In quarantena", "Profilo", "Modelli", "Modelli in quarantena", "Formazione", "Formazione in quarantena", "Valori mensili", "Avvisi", "Importabile*"], sourceRows));
  sourceHost.append(element("p", "*Indicatore tecnico preliminare; non costituisce autorizzazione all'importazione."));

  const conflictHost = document.querySelector("#conflicts");
  clear(conflictHost);
  const conflictRows = [
    ...report.profileConflicts.map(item => ["Profilo / " + item.section, item.field, item.sources.join(", ")]),
    ...report.extraConflicts.map(item => ["Extra", item.field, item.sources.join(", ")])
  ];
  conflictHost.append(conflictRows.length
    ? table(["Categoria", "Campo", "Fonti coinvolte"], conflictRows)
    : element("p", "Nessun conflitto di campi rilevato."));

  const quarantineHost = document.querySelector("#quarantine");
  clear(quarantineHost);
  const quarantineRows = [
    ...report.quarantinedShifts.map(item => ["Turno", item.source, item.index, item.reason]),
    ...report.quarantinedTemplates.map(item => ["Modello", item.source, item.index, item.reason]),
    ...report.quarantinedSkills.map(item => ["Formazione", item.source, item.index, item.reason])
  ];
  quarantineHost.append(quarantineRows.length
    ? table(["Tipo", "Fonte", "Indice", "Motivo"], quarantineRows)
    : element("p", "Nessun elemento in quarantena."));

  const warningsHost = document.querySelector("#warnings");
  clear(warningsHost);
  if (!report.warnings.length) warningsHost.append(element("li", "Nessun avviso."));
  else for (const warning of report.warnings) warningsHost.append(element("li", warning));
}

downloadButton.addEventListener("click", () => {
  if (!safeReport) return;
  const blob = new Blob([JSON.stringify(safeReport, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = element("a");
  link.href = url;
  link.download = "dsm-legacy-report-summary.json";
  link.click();
  URL.revokeObjectURL(url);
});
