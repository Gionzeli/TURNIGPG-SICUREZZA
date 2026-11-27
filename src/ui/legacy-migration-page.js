import { inspectLegacyExport } from "../core/legacy/legacy-read-adapter.js";

function node(tag, className, text) {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text !== undefined) item.textContent = text;
  return item;
}

function metric(label, value) {
  const card = node("div", "kpi");
  card.append(node("small", "", label), node("b", "", String(value)));
  return card;
}

/**
 * Read-only migration checkpoint embedded in the existing application.
 * The selected backup is inspected in memory only: no LocalStorage,
 * IndexedDB, Firestore, upload, or automatic import is performed.
 */
export function mountLegacyMigrationPage(container) {
  if (!container || typeof container.replaceChildren !== "function") {
    throw new TypeError("Contenitore migrazione DSM non valido.");
  }

  const heading = node("h1", "", "Preparazione migrazione DSM");
  const intro = node("p", "hint",
    "Analizza un backup esportato dall'app esistente e individua i dati pronti, le anomalie e gli elementi da verificare prima del passaggio al nuovo core.");
  const privacy = node("p", "hint",
    "Analisi locale e di sola lettura: il file non viene caricato, salvato o importato. Nessun dato viene modificato.");
  const bridge = node("section", "card");
  bridge.id = "dsm-canonical-account-root";
  if (window.TURNI_DSM_CANONICAL_AUTH_ENABLED === true) {
    bridge.append(node("p", "hint", "Inizializzazione del collegamento account DSM…"));
  } else {
    bridge.append(
      node("h3", "", "Collegamento identità canonica"),
      node("p", "hint", "Il ponte con l'autenticazione Firebase e la verifica server-side delle appartenenze è predisposto nel codice. È disattivato in questa build: non viene contattato il progetto Firebase reale e non viene attivato alcun account.")
    );
  }
  const form = node("form", "card noprint");
  const label = node("label", "", "Seleziona un backup JSON dell'app");
  const file = node("input");
  file.type = "file";
  file.accept = ".json,application/json";
  file.required = true;
  file.setAttribute("aria-label", "Seleziona un backup JSON");
  label.append(file);
  const actions = node("div", "row");
  const analyze = node("button", "pri", "Analizza backup");
  analyze.type = "submit";
  const reset = node("button", "", "Azzera");
  reset.type = "reset";
  actions.append(analyze, reset);
  const status = node("p", "hint", "Seleziona il backup esportato per iniziare.");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const results = node("section", "");
  results.setAttribute("aria-live", "polite");
  form.append(label, actions);
  container.replaceChildren(heading, intro, privacy, bridge, form, status, results);

  if (window.TURNI_DSM_CANONICAL_AUTH_ENABLED === true) {
    import("./dsm-canonical-account-bootstrap.js").catch(() => {
      const message = node("p", "hint", "Collegamento account non disponibile. L'accesso DSM resta negato.");
      bridge.append(message);
    });
  }

  let disposed = false;
  let generation = 0;

  function clearResults() {
    results.replaceChildren();
  }

  function render(preview) {
    clearResults();
    const readiness = preview.snapshot.importable && preview.warnings.length === 0 &&
      (!preview.extras || (
        preview.extras.credentialsDetected === false &&
        preview.extras.skillsQuarantined === 0 &&
        preview.extras.templatesQuarantined === 0 &&
        preview.warnings.length === 0
      ));
    const state = node("div", "card");
    state.append(
      node("h3", "", readiness ? "Backup pronto per la revisione d'importazione" : "Revisione necessaria prima dell'importazione"),
      node("p", "hint", "Questa analisi non esegue ancora alcuna scrittura nel database DSM.")
    );
    const stats = node("div", "kpis");
    stats.append(
      metric("Turni nel backup", preview.snapshot.shiftsTotal),
      metric("Turni validi", preview.snapshot.shiftsReady),
      metric("Turni da verificare", preview.snapshot.shiftsQuarantined),
      metric("Profilo", preview.snapshot.profileValid ? "Valido" : "Da verificare")
    );
    results.append(state, stats);

    if (preview.extras) {
      const extraStats = node("div", "kpis");
      extraStats.append(
        metric("Qualifiche", preview.extras.skills),
        metric("Qualifiche da verificare", preview.extras.skillsQuarantined),
        metric("Modelli turno", preview.extras.templates),
        metric("Modelli da verificare", preview.extras.templatesQuarantined),
        metric("Valori mensili", preview.extras.monthlyValues),
        metric("Credenziali legacy rilevate", preview.extras.credentialsDetected ? "Sì" : "No")
      );
      results.append(node("h3", "", "Altri dati rilevati"), extraStats);
    }

    if (preview.warnings.length) {
      const warningCard = node("div", "card");
      warningCard.append(node("h3", "", "Elementi da controllare"));
      const list = node("ul", "");
      for (const warning of preview.warnings) list.append(node("li", "", warning));
      warningCard.append(list);
      results.append(warningCard);
    } else {
      results.append(node("p", "hint", "Nessuna anomalia rilevata dal controllo preliminare."));
    }
  }

  async function onSubmit(event) {
    event.preventDefault();
    const current = ++generation;
    clearResults();
    const selected = file.files?.[0];
    if (!selected) {
      status.textContent = "Seleziona prima un file JSON.";
      return;
    }
    if (selected.size > 5 * 1024 * 1024) {
      status.textContent = "Il file supera il limite di 5 MB previsto per l'analisi preliminare.";
      return;
    }
    status.textContent = "Analisi locale del backup in corso…";
    analyze.disabled = true;
    try {
      const raw = await selected.text();
      if (disposed || current !== generation) return;
      const preview = inspectLegacyExport(raw);
      if (disposed || current !== generation) return;
      render(preview);
      status.textContent = "Analisi completata. Il backup originale non è stato modificato.";
    } catch {
      if (!disposed && current === generation) {
        status.textContent = "Backup non riconosciuto o non valido. Verifica che sia un export JSON dell'app e riprova.";
      }
    } finally {
      if (!disposed && current === generation) analyze.disabled = false;
    }
  }

  function onReset() {
    generation++;
    clearResults();
    status.textContent = "Analisi azzerata. Seleziona un backup per iniziare.";
  }

  form.addEventListener("submit", onSubmit);
  form.addEventListener("reset", onReset);

  return Object.freeze({
    destroy() {
      if (disposed) return;
      disposed = true;
      generation++;
      form.removeEventListener("submit", onSubmit);
      form.removeEventListener("reset", onReset);
      container.replaceChildren();
    }
  });
}

const root = document.getElementById("dsm-migration-root");
if (root) mountLegacyMigrationPage(root);
