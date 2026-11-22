import { inspectLegacyReconciliation, inspectLegacyExport, inspectLegacySnapshot, inspectLegacyExtras } from "../src/core/legacy/legacy-read-adapter.js";

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
// Reasons and warnings can contain arbitrary legacy field names or values.
// Keep only generic labels in both the visible report and its downloadable form.
const safeReason = () => "Elemento da verificare localmente.";
const safeWarning = () => "Avviso da verificare localmente.";
const safeField = () => "campo da verificare";
const safeSection = () => "sezione da verificare";

fileInput.addEventListener("change", () => {
  const files = [...fileInput.files];
  analyzeButton.disabled = files.length < 1 || files.length > 100 ||
    files.some(file => file.size > 10 * 1024 * 1024);
  errorNode.textContent = "";
  reportNode.hidden = true;
  safeReport = null;
  if (!files.length) text(statusNode, "In attesa dei file.");
  else if (files.length < 1) text(statusNode, "Seleziona almeno un export JSON.");
  else if (files.length > 100) text(statusNode, "Limite superato: massimo 100 file.");
  else if (files.some(file => file.size > 10 * 1024 * 1024)) text(statusNode, "Un file supera il limite di 10 MB.");
  else text(statusNode, files.length + " file selezionati. Nessun file è stato ancora letto.");
});

analyzeButton.addEventListener("click", async () => {
  const files = [...fileInput.files];
  if (files.length < 1 || files.length > 100 || files.some(file => file.size > 10 * 1024 * 1024)) {
    analyzeButton.disabled = files.length < 1 || files.length > 100 || files.some(file => file.size > 10 * 1024 * 1024);
    text(statusNode, files.length > 100 ? "Limite superato: massimo 100 file." : "Un file supera il limite di 10 MB.");
    return;
  }
  analyzeButton.disabled = true;
  errorNode.textContent = "";
  text(statusNode, "Analisi locale in corso…");
  try {
    // Never copy user-controlled filenames into the visible or downloadable report.
    // Stable generic labels preserve source traceability without leaking personal filenames.
    const candidates = await Promise.all(files.map(async (file, index) => ({
      source: `Export ${index + 1}`,
      rawJson: await file.text()
    })));
    let result;
    if (candidates.length > 1) {
      const reconciled = inspectLegacyReconciliation(candidates);
      result = {
        mode: reconciled.mode, sourceCount: reconciled.sourceCount,
        migrationReadiness: reconciled.migrationReadiness, sources: reconciled.sources,
        totals: reconciled.totals,
        profileConflicts: reconciled.profileConflicts.map(item => ({ section: safeSection(item.section), field: safeField(item.field), sources: item.values.map(value => value.source) })),
        extraConflicts: reconciled.extraConflicts.map(item => ({ field: safeField(item.field), sources: item.values.map(value => value.source) })),
        identicalGroups: reconciled.identicalRecords.length, idConflictGroups: reconciled.idConflicts.length,
        possibleDuplicateGroups: reconciled.possibleDuplicates.map(item => ({ reason: safeReason(item.reason), copies: item.copies.map(copy => ({ source: copy.source, index: copy.index })) })),
        quarantine: reconciled.quarantine,
        quarantinedShifts: reconciled.quarantinedShifts.map(item => ({ ...item, reason: safeReason(item.reason) })),
        quarantinedTemplates: reconciled.quarantinedTemplates.map(item => ({ ...item, reason: safeReason(item.reason) })),
        quarantinedSkills: reconciled.quarantinedSkills.map(item => ({ ...item, reason: safeReason(item.reason) })),
        warnings: reconciled.warnings.map(safeWarning), writesPerformed: reconciled.writesPerformed,
        automaticMergePerformed: reconciled.automaticMergePerformed
      };
    } else {
      const candidate = candidates[0];
      const parsed = JSON.parse(candidate.rawJson);
      const exportPreview = inspectLegacyExport(candidate.rawJson);
      const snapshot = inspectLegacySnapshot(JSON.stringify({ params: parsed.params, profile: parsed.profile, shifts: parsed.shifts }));
      const extras = parsed.extra === undefined ? null : inspectLegacyExtras(JSON.stringify(parsed.extra));
      const sourceSummary = {
        source: candidate.source, shiftsTotal: snapshot.shifts.total,
        shiftsReady: snapshot.shifts.ready.length, shiftsQuarantined: snapshot.shifts.quarantined.length,
        profileValid: snapshot.profile.valid, profileErrors: snapshot.profile.errors.length,
        extrasPresent: Boolean(extras), extraSkills: extras?.data.skills.length ?? null,
        extraSkillsQuarantined: extras?.skillsQuarantined.length ?? null,
        extraTemplates: extras?.data.templates.length ?? null,
        extraTemplatesQuarantined: extras?.templatesQuarantined.length ?? null,
        extraMonthlyValues: extras ? Object.keys(extras.data.real).length : null,
        warnings: exportPreview.warnings.length,
        importable: snapshot.importable && (!extras || (extras.warnings.length === 0 && extras.templatesQuarantined.length === 0 && extras.skillsQuarantined.length === 0))
      };
      const quarantinedShifts = snapshot.shifts.quarantined.map(item => ({ source: candidate.source, index: item.index, reason: safeReason(item.reason) }));
      const quarantinedTemplates = (extras?.templatesQuarantined ?? []).map(item => ({ source: candidate.source, index: item.index, reason: safeReason(item.reason) }));
      const quarantinedSkills = (extras?.skillsQuarantined ?? []).map(item => ({ source: candidate.source, index: item.index, reason: safeReason(item.reason) }));
      const reviewRequired = !sourceSummary.importable || exportPreview.warnings.length > 0;
      result = {
        mode: "read-only-single-export-preview", sourceCount: 1,
        migrationReadiness: { status: reviewRequired ? "review-required" : "no-conflicts-detected", reviewRequired, automaticImportAllowed: false },
        sources: [sourceSummary],
        totals: { shiftsReady: sourceSummary.shiftsReady, identicalGroups: 0, idConflictGroups: 0, possibleDuplicateGroups: 0, profileConflictFields: 0, extraConflictFields: 0, sourcesWithWarnings: sourceSummary.warnings > 0 ? 1 : 0 },
        profileConflicts: [], extraConflicts: [], identicalGroups: 0, idConflictGroups: 0, possibleDuplicateGroups: [],
        quarantine: { shifts: quarantinedShifts.length, templates: quarantinedTemplates.length, skills: quarantinedSkills.length },
        quarantinedShifts, quarantinedTemplates, quarantinedSkills,
        warnings: exportPreview.warnings.map(message => candidate.source + ": " + safeWarning(message)),
        writesPerformed: false, automaticMergePerformed: false
      };
    }
    safeReport = { generatedAt: new Date().toISOString(), ...result };
    render(safeReport);
    reportNode.hidden = false;
    text(statusNode, "Analisi completata. I file originali non sono stati modificati.");
  } catch (error) {
    reportNode.hidden = true;
    safeReport = null;
    text(errorNode, "Analisi non riuscita: JSON non valido o struttura non conforme. Verifica i file selezionati; nessun contenuto è stato modificato.");
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
    ...report.quarantinedShifts.map(item => ["Turno", item.source, item.index, safeReason(item.reason)]),
    ...report.quarantinedTemplates.map(item => ["Modello", item.source, item.index, safeReason(item.reason)]),
    ...report.quarantinedSkills.map(item => ["Formazione", item.source, item.index, safeReason(item.reason)])
  ];
  quarantineHost.append(quarantineRows.length
    ? table(["Tipo", "Fonte", "Indice", "Motivo"], quarantineRows)
    : element("p", "Nessun elemento in quarantena."));

  const warningsHost = document.querySelector("#warnings");
  clear(warningsHost);
  if (!report.warnings.length) warningsHost.append(element("li", "Nessun avviso."));
  else for (const warning of report.warnings) warningsHost.append(element("li", safeWarning(warning)));
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
