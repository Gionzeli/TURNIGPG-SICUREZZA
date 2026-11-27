/**
 * Bridges the existing Firebase sign-in to the canonical DSM account model.
 * Account membership is discovered and revalidated by trusted callable endpoints.
 * This controller never reads legacy /members documents and never imports records.
 */
export function mountDSMCanonicalAccountBridge(container, {
  auth,
  onAuthStateChanged,
  listCanonicalAccounts,
  resolveAuthorization,
  listOwnEmployeeShifts,
  readOwnEmployeeEmploymentProfile,
  createAuthAdapter,
  openDatabase,
  closeDatabase,
  createSession
} = {}) {
  const required = [auth, onAuthStateChanged, listCanonicalAccounts, resolveAuthorization,
    listOwnEmployeeShifts, createAuthAdapter, openDatabase, closeDatabase, createSession];
  if (!container || required.some(value => !value) ||
      typeof onAuthStateChanged !== "function" ||
      typeof listCanonicalAccounts !== "function" ||
      typeof resolveAuthorization !== "function" ||
      typeof listOwnEmployeeShifts !== "function" ||
      typeof createAuthAdapter !== "function" ||
      typeof openDatabase !== "function" ||
      typeof closeDatabase !== "function" ||
      typeof createSession !== "function") {
    throw new TypeError("Configurazione collegamento account DSM non valida.");
  }

  const title = document.createElement("h3");
  title.textContent = "Collegamento account DSM";
  const status = document.createElement("p");
  status.className = "hint";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const select = document.createElement("select");
  select.setAttribute("aria-label", "Account DSM canonico");
  select.disabled = true;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "pri";
  button.textContent = "Verifica e collega account";
  button.disabled = true;
  const note = document.createElement("p");
  note.className = "hint";
  note.textContent = "Dopo la verifica puoi consultare esclusivamente i turni associati al tuo Employee canonico. La consultazione non importa né modifica dati.";

  const profilePanel = document.createElement("section");
  profilePanel.className = "card";
  profilePanel.hidden = true;
  const profileTitle = document.createElement("h3");
  profileTitle.textContent = "Il mio profilo lavorativo";
  const profileStatus = document.createElement("p");
  profileStatus.className = "hint";
  profileStatus.setAttribute("role", "status");
  profileStatus.setAttribute("aria-live", "polite");
  const profileResults = document.createElement("dl");
  profilePanel.append(profileTitle, profileStatus, profileResults);

  const shiftsPanel = document.createElement("section");
  shiftsPanel.className = "card";
  shiftsPanel.hidden = true;
  const shiftsTitle = document.createElement("h3");
  shiftsTitle.textContent = "I miei turni";
  const shiftsIntro = document.createElement("p");
  shiftsIntro.className = "hint";
  shiftsIntro.textContent = "Consulta i turni del tuo Employee canonico in un intervallo di date. La consultazione è di sola lettura; le modifiche ricevute dall'azienda saranno gestite tramite il flusso personale di verifica e approvazione.";
  const shiftsForm = document.createElement("form");
  shiftsForm.className = "row";
  const fromLabel = document.createElement("label");
  fromLabel.textContent = "Dal";
  const fromInput = document.createElement("input");
  fromInput.type = "date";
  fromInput.required = true;
  fromInput.setAttribute("aria-label", "Data iniziale");
  fromLabel.append(fromInput);
  const toLabel = document.createElement("label");
  toLabel.textContent = "Al";
  const toInput = document.createElement("input");
  toInput.type = "date";
  toInput.required = true;
  toInput.setAttribute("aria-label", "Data finale");
  toLabel.append(toInput);
  const searchButton = document.createElement("button");
  searchButton.type = "submit";
  searchButton.className = "pri";
  searchButton.textContent = "Cerca i miei turni";
  shiftsForm.append(fromLabel, toLabel, searchButton);
  const shiftsStatus = document.createElement("p");
  shiftsStatus.className = "hint";
  shiftsStatus.setAttribute("role", "status");
  shiftsStatus.setAttribute("aria-live", "polite");
  const shiftsResults = document.createElement("div");
  shiftsResults.setAttribute("aria-live", "polite");
  shiftsPanel.append(shiftsTitle, shiftsIntro, shiftsForm, shiftsStatus, shiftsResults);

  container.replaceChildren(title, status, select, button, note, profilePanel, shiftsPanel);

  let disposed = false;
  let generation = 0;
  let shiftQueryGeneration = 0;
  let profileQueryGeneration = 0;
  let selectionRevision = 0;
  let selectedAccountId = null;
  let availableAccounts = [];
  let db = null;
  let session = null;
  let sessionPromise = null;
  let authAdapter = null;
  let authUnsubscribe = null;
  let activationPromise = null;

  const setStatus = message => { if (!disposed) status.textContent = message; };
  const accountSelection = () => ({
    accountId: selectedAccountId,
    revision: selectionRevision
  });
  const activeFirebaseAccountId = () => {
    const active = session?.accountContext.getActive();
    return active?.identitySource === "firebase" ? active.accountId : null;
  };

  function clearProfileView() {
    profileQueryGeneration += 1;
    profilePanel.hidden = true;
    profileStatus.textContent = "";
    profileResults.replaceChildren();
  }

  function renderEmploymentProfile(result) {
    profileResults.replaceChildren();
    const rows = [
      ["ID Employee", result.employeeId],
      ["CCNL", result.employmentProfile?.ccnl],
      ["Sezione", result.employmentProfile?.section],
      ["Livello", result.employmentProfile?.level],
      ["Mansione", result.employmentProfile?.role],
      ["Decorrenza dichiarata", result.employmentProfile?.effectiveDate]
    ];
    for (const [label, value] of rows) {
      const term = document.createElement("dt");
      term.textContent = label;
      const description = document.createElement("dd");
      description.textContent = value === null || value === undefined || value === "" ? "Non disponibile" : String(value);
      profileResults.append(term, description);
    }
  }

  function loadEmploymentProfile(accountId) {
    if (typeof readOwnEmployeeEmploymentProfile !== "function") return;
    const current = ++profileQueryGeneration;
    profilePanel.hidden = false;
    profileStatus.textContent = "Caricamento del profilo lavorativo…";
    profileResults.replaceChildren();
    Promise.resolve().then(() => readOwnEmployeeEmploymentProfile({ accountId })).then(result => {
      if (disposed || current !== profileQueryGeneration || activeFirebaseAccountId() !== accountId || selectedAccountId !== accountId) return;
      if (!result || typeof result.employeeId !== "string" || !result.employmentProfile || typeof result.employmentProfile !== "object") {
        throw new Error("Risposta profilo non valida.");
      }
      renderEmploymentProfile(result);
      profileStatus.textContent = "Profilo canonico in sola lettura. I valori non sono modificabili da questa schermata.";
    }).catch(() => {
      if (!disposed && current === profileQueryGeneration) {
        profileResults.replaceChildren();
        profileStatus.textContent = "Profilo non disponibile o accesso non autorizzato. Nessun dato locale è stato importato.";
      }
    });
  }

  function clearShiftResults() {
    shiftsResults.replaceChildren();
  }

  function hideShiftView() {
    shiftQueryGeneration += 1;
    shiftsPanel.hidden = true;
    shiftsForm.reset();
    clearShiftResults();
    shiftsStatus.textContent = "Collega un account DSM verificato per consultare i tuoi turni.";
    searchButton.disabled = false;
  }

  function showShiftView() {
    shiftsPanel.hidden = false;
    shiftsStatus.textContent = "Seleziona l'intervallo di date e avvia la ricerca.";
  }

  function renderShifts(items) {
    clearShiftResults();
    if (!items.length) {
      shiftsResults.append(document.createTextNode("Nessun turno trovato nell'intervallo selezionato."));
      return;
    }
    const table = document.createElement("table");
    const head = document.createElement("thead");
    const headerRow = document.createElement("tr");
    for (const label of ["Data", "Tipo", "Postazione", "Inizio", "Fine", "Ore"]) {
      const cell = document.createElement("th");
      cell.scope = "col";
      cell.textContent = label;
      headerRow.append(cell);
    }
    head.append(headerRow);
    const body = document.createElement("tbody");
    for (const item of items) {
      const row = document.createElement("tr");
      const values = [
        item.date,
        item.type,
        item.post ?? "",
        item.start_time ?? "",
        item.end_time ?? "",
        typeof item.hours === "number" ? String(item.hours) : ""
      ];
      for (const value of values) {
        const cell = document.createElement("td");
        cell.textContent = String(value ?? "");
        row.append(cell);
      }
      body.append(row);
    }
    table.append(head, body);
    shiftsResults.append(table);
  }

  authAdapter = createAuthAdapter({
    auth,
    onAuthStateChanged,
    resolveAuthorization,
    getAccountSelectionSnapshot: accountSelection
  });

  function resetAccounts(message) {
    availableAccounts = [];
    selectedAccountId = null;
    selectionRevision += 1;
    select.replaceChildren();
    select.disabled = true;
    button.disabled = true;
    hideShiftView();
    clearProfileView();
    setStatus(message);
  }

  async function onUserChanged(user) {
    const current = ++generation;
    resetAccounts("Verifica dell'account Firebase…");
    if (!user) {
      setStatus("Accedi dall'area account già presente nell'app per continuare.");
      return;
    }
    if (user.emailVerified !== true) {
      setStatus("Prima di collegare DSM devi verificare l'indirizzo email.");
      return;
    }
    try {
      const accounts = await listCanonicalAccounts();
      if (disposed || current !== generation) return;
      if (!Array.isArray(accounts)) throw new Error("Risposta account non valida.");
      availableAccounts = accounts.filter(item =>
        item && typeof item.accountId === "string" &&
        /^[A-Za-z0-9_-]{1,128}$/.test(item.accountId) &&
        typeof item.role === "string");
      if (!availableAccounts.length) {
        setStatus("Accesso Firebase riconosciuto, ma non esiste ancora un'appartenenza DSM canonica attiva per questo account. L'accesso legacy non viene convertito automaticamente.");
        return;
      }
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Seleziona un account DSM autorizzato";
      select.append(placeholder);
      for (const item of availableAccounts) {
        const option = document.createElement("option");
        option.value = item.accountId;
        option.textContent = `${item.accountId} — ${item.role}`;
        select.append(option);
      }
      select.disabled = false;
      setStatus("Appartenenze DSM canoniche trovate. Seleziona l'account da collegare.");
    } catch {
      if (!disposed && current === generation) {
        setStatus("Impossibile verificare le appartenenze DSM. Nessun accesso è stato attivato.");
      }
    }
  }

  authUnsubscribe = onAuthStateChanged(auth, user => {
    void onUserChanged(user);
  }, () => resetAccounts("Stato Firebase non verificabile. Accesso DSM negato."));

  const onSelectChange = async () => {
    const nextAccountId = availableAccounts.some(item => item.accountId === select.value)
      ? select.value : null;
    selectedAccountId = nextAccountId;
    selectionRevision += 1;
    hideShiftView();
    clearProfileView();
    const active = session?.accountContext.getActive();
    if (active?.identitySource === "firebase" && active.accountId !== nextAccountId) {
      button.disabled = true;
      setStatus("Disconnessione dell'account DSM precedente…");
      try {
        await session.logout();
        setStatus("Account precedente disconnesso. Puoi verificare la nuova selezione.");
      } catch {
        setStatus("Cambio account non completato. Il nuovo account resta bloccato finché la sessione precedente non è stata chiusa.");
        return;
      }
    }
    button.disabled = !selectedAccountId || Boolean(activationPromise);
  };
  select.addEventListener("change", onSelectChange);

  shiftsForm.addEventListener("submit", async event => {
    event.preventDefault();
    const accountId = activeFirebaseAccountId();
    const fromDate = fromInput.value;
    const toDate = toInput.value;
    if (!accountId || accountId !== selectedAccountId) {
      hideShiftView();
      setStatus("Sessione DSM non attiva. Verifica nuovamente l'account.");
      return;
    }
    if (!fromDate || !toDate || !/^\d{4}-\d{2}-\d{2}$/.test(fromDate) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(toDate) || toDate < fromDate) {
      shiftsStatus.textContent = "Intervallo non valido: controlla la data iniziale e finale.";
      return;
    }
    const current = ++shiftQueryGeneration;
    clearShiftResults();
    shiftsStatus.textContent = "Ricerca dei tuoi turni in corso…";
    searchButton.disabled = true;
    try {
      const query = { accountId, fromDate, toDate };
      const items = await listOwnEmployeeShifts(query);
      if (disposed || current !== shiftQueryGeneration ||
          activeFirebaseAccountId() !== accountId || selectedAccountId !== accountId) return;
      if (!Array.isArray(items) || items.length > 200) {
        throw new Error("Risposta turni non valida.");
      }
      renderShifts(items);
      shiftsStatus.textContent = `Ricerca completata: ${items.length} turni trovati.`;
    } catch {
      if (!disposed && current === shiftQueryGeneration) {
        clearShiftResults();
        shiftsStatus.textContent = "Non è stato possibile caricare i turni. Verifica l'accesso e riprova.";
      }
    } finally {
      if (!disposed && current === shiftQueryGeneration) searchButton.disabled = false;
    }
  });

  button.addEventListener("click", async () => {
    if (disposed || !selectedAccountId || activationPromise) return;
    const selected = availableAccounts.find(item => item.accountId === selectedAccountId);
    if (!selected) return;
    button.disabled = true;
    setStatus("Verifica server-side dell'identità e dell'appartenenza DSM…");
    const task = (async () => {
      if (!sessionPromise) {
        sessionPromise = (async () => {
          db = await openDatabase();
          return createSession({ db, firebaseAuthAdapter: authAdapter });
        })();
      }
      session = await sessionPromise;
      const result = await session.activateFirebase();
      if (disposed) return;
      if (!result || result.state !== "active" || result.accountId !== selected.accountId ||
          session.accountContext.getActive()?.identitySource !== "firebase" ||
          selectedAccountId !== selected.accountId) {
        throw new Error("Il contesto DSM non corrisponde all'account selezionato.");
      }
      setStatus(`Identità verificata e account DSM ${selected.accountId} collegato. Puoi consultare i tuoi dati personali autorizzati.`);
      showShiftView();
      loadEmploymentProfile(selected.accountId);
    })();
    activationPromise = task;
    try {
      await task;
    } catch {
      hideShiftView();
      setStatus("Collegamento non riuscito o autorizzazione revocata. Nessun dato operativo è stato importato.");
    } finally {
      activationPromise = null;
      if (!disposed) button.disabled = !selectedAccountId;
    }
  });

  return Object.freeze({
    async destroy() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      shiftQueryGeneration += 1;
      clearProfileView();
      authUnsubscribe?.();
      select.removeEventListener("change", onSelectChange);
      authAdapter.dispose();
      try { await activationPromise; } catch {}
      try {
        if (session) await session.dispose();
      } finally {
        if (db) await closeDatabase();
      }
      container.replaceChildren();
    }
  });
}
