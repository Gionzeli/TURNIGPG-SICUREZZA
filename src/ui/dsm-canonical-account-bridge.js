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
  listOwnEmployeeShiftProposals,
  approveOwnEmployeeShiftProposal,
  rejectOwnEmployeeShiftProposal,
  proposeOwnEmployeeShiftChanges,
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

  const proposalPanel = document.createElement("section");
  proposalPanel.className = "card"; proposalPanel.hidden = true;
  const proposalTitle = document.createElement("h3"); proposalTitle.textContent = "Verifica le modifiche ai tuoi turni";
  const proposalIntro = document.createElement("p"); proposalIntro.className = "hint";
  proposalIntro.textContent = "Le proposte diventano effettive solo dopo la tua approvazione. Il responsabile non approva i tuoi turni.";
  const proposalForm = document.createElement("form"); proposalForm.className = "row";
  const operationLabel = document.createElement("label"); operationLabel.textContent = "Tipo di modifica";
  const operationInput = document.createElement("select"); operationInput.setAttribute("aria-label", "Tipo di modifica");
  for (const [value, label] of [["create", "Aggiungi turno"], ["update", "Modifica turno esistente"], ["delete", "Elimina turno esistente"]]) { const option = document.createElement("option"); option.value = value; option.textContent = label; operationInput.append(option); }
  operationLabel.append(operationInput);
  const targetLabel = document.createElement("label"); targetLabel.textContent = "Turno da modificare";
  const targetInput = document.createElement("select"); targetInput.setAttribute("aria-label", "Turno da modificare");
  const targetPlaceholder = document.createElement("option"); targetPlaceholder.value = ""; targetPlaceholder.textContent = "Cerca prima i tuoi turni"; targetInput.append(targetPlaceholder); targetLabel.append(targetInput);
  const proposalDateLabel = document.createElement("label"); proposalDateLabel.textContent = "Data turno";
  const proposalDateInput = document.createElement("input"); proposalDateInput.type = "date"; proposalDateInput.setAttribute("aria-label", "Data turno"); proposalDateLabel.append(proposalDateInput);
  const proposalTypeLabel = document.createElement("label"); proposalTypeLabel.textContent = "Tipo turno";
  const proposalTypeInput = document.createElement("select"); proposalTypeInput.setAttribute("aria-label", "Tipo turno");
  const unchangedType = document.createElement("option"); unchangedType.value = ""; unchangedType.textContent = "Seleziona tipo / lascia invariato"; proposalTypeInput.append(unchangedType);
  for (const value of ["turno", "turno_riposo", "riposo", "riposo_compensativo", "ferie", "permesso", "malattia"]) { const option = document.createElement("option"); option.value = value; option.textContent = value; proposalTypeInput.append(option); } proposalTypeLabel.append(proposalTypeInput);
  const proposalPostLabel = document.createElement("label"); proposalPostLabel.textContent = "Postazione";
  const proposalPostInput = document.createElement("input"); proposalPostInput.type = "text"; proposalPostInput.maxLength = 80; proposalPostInput.placeholder = "Postazione ricevuta"; proposalPostInput.setAttribute("aria-label", "Postazione proposta"); proposalPostLabel.append(proposalPostInput);
  const proposalStartLabel = document.createElement("label"); proposalStartLabel.textContent = "Inizio";
  const proposalStartInput = document.createElement("input"); proposalStartInput.type = "time"; proposalStartInput.setAttribute("aria-label", "Inizio proposto"); proposalStartLabel.append(proposalStartInput);
  const proposalEndLabel = document.createElement("label"); proposalEndLabel.textContent = "Fine";
  const proposalEndInput = document.createElement("input"); proposalEndInput.type = "time"; proposalEndInput.setAttribute("aria-label", "Fine proposta"); proposalEndLabel.append(proposalEndInput);
  const proposalHoursLabel = document.createElement("label"); proposalHoursLabel.textContent = "Ore";
  const proposalHoursInput = document.createElement("input"); proposalHoursInput.type = "number"; proposalHoursInput.min = "0"; proposalHoursInput.max = "48"; proposalHoursInput.step = "0.25"; proposalHoursInput.placeholder = "Ore"; proposalHoursInput.setAttribute("aria-label", "Ore proposte"); proposalHoursLabel.append(proposalHoursInput);
  const proposalSubmit = document.createElement("button"); proposalSubmit.type = "submit"; proposalSubmit.className = "pri"; proposalSubmit.textContent = "Invia proposta personale";
  proposalForm.append(operationLabel, targetLabel, proposalDateLabel, proposalTypeLabel, proposalPostLabel, proposalStartLabel, proposalEndLabel, proposalHoursLabel, proposalSubmit);
  const updateProposalFormMode = () => { const mode = operationInput.value; targetLabel.hidden = mode === "create"; proposalDateLabel.hidden = mode !== "create"; proposalDateInput.required = mode === "create"; const hideFields = mode === "delete"; for (const element of [proposalTypeLabel, proposalPostLabel, proposalStartLabel, proposalEndLabel, proposalHoursLabel]) element.hidden = hideFields; proposalTypeInput.required = mode === "create"; };
  operationInput.addEventListener("change", updateProposalFormMode); updateProposalFormMode();
  const proposalStatus = document.createElement("p"); proposalStatus.className = "hint";
  proposalStatus.setAttribute("role", "status"); proposalStatus.setAttribute("aria-live", "polite");
  const proposalResults = document.createElement("div"); proposalResults.setAttribute("aria-live", "polite");
  proposalPanel.append(proposalTitle, proposalIntro, proposalForm, proposalStatus, proposalResults);
  container.replaceChildren(title, status, select, button, note, profilePanel, shiftsPanel, proposalPanel);

  let disposed = false;
  let generation = 0;
  let shiftQueryGeneration = 0;
  let proposalQueryGeneration = 0;
  let latestShiftItems = [];
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

  function clearProposalView() { proposalPanel.hidden = true; proposalResults.replaceChildren(); proposalStatus.textContent = ""; }
  async function loadOwnProposals(accountId) {
    if (typeof listOwnEmployeeShiftProposals !== "function" || typeof approveOwnEmployeeShiftProposal !== "function" || typeof rejectOwnEmployeeShiftProposal !== "function") return;
    const current = ++proposalQueryGeneration;
    proposalPanel.hidden = false; proposalStatus.textContent = "Caricamento delle proposte personali…"; proposalResults.replaceChildren();
    try {
      const items = await listOwnEmployeeShiftProposals({ accountId });
      if (!Array.isArray(items) || items.length > 50) throw new Error("Invalid proposal response.");
      if (disposed || current !== proposalQueryGeneration || activeFirebaseAccountId() !== accountId || selectedAccountId !== accountId) return;
      proposalResults.replaceChildren();
      if (!Array.isArray(items) || !items.length) proposalResults.append(document.createTextNode("Non hai proposte di modifica in attesa."));
      for (const proposal of (Array.isArray(items) ? items : [])) {
        const article = document.createElement("article"); article.className = "card";
        const heading = document.createElement("h4"); heading.textContent = "Proposta " + proposal.proposalId;
        const origin = proposal.source === "employer_email" ? "PDF da email aziendale verificata" : proposal.source === "employee_manual" ? "inserimento manuale" : "origine non riconosciuta";
        const detail = document.createElement("p"); detail.textContent = proposal.status + " — " + proposal.changeCount + " variazioni — origine: " + origin;
        article.append(heading, detail);
        for (let changeIndex = 0; changeIndex < (proposal.changes ?? []).length; changeIndex++) {
          const change = proposal.changes[changeIndex];
          const before = proposal.before?.[changeIndex] ?? null;
          const line = document.createElement("p");
          if (change.operation === "create") {
            line.textContent = "Nuovo turno: " + (change.shift?.date ?? "") + ", " + (change.shift?.type ?? "") + ", " + (change.shift?.post ?? "") + ", " + (change.shift?.start_time ?? "") + "-" + (change.shift?.end_time ?? "");
            article.append(line);
          } else if (change.operation === "delete") {
            line.textContent = "Eliminazione turno: " + (before?.date ?? "") + ", " + (before?.type ?? "") + ", " + (before?.post ?? "") + ", " + (before?.start_time ?? "") + "-" + (before?.end_time ?? "");
            article.append(line);
          } else {
            line.textContent = "Modifica turno del " + (before?.date ?? "") + " (revisione " + change.expectedRevision + ")";
            article.append(line);
            for (const [field, value] of Object.entries(change.changes ?? {})) {
              const diff = document.createElement("p");
              diff.textContent = field + ": " + String(before?.[field] ?? "—") + " → " + String(value);
              article.append(diff);
            }
          }
        }
        if (proposal.status === "pending") {
          const approve = document.createElement("button"); approve.type = "button"; approve.className = "pri"; approve.textContent = "Approva e aggiorna il calendario";
          approve.addEventListener("click", async () => {
            approve.disabled = true; proposalStatus.textContent = "Verifica e applicazione atomica in corso…";
            try { await approveOwnEmployeeShiftProposal({ accountId, proposalId: proposal.proposalId }); proposalStatus.textContent = "Modifica approvata e calendario aggiornato."; await loadOwnProposals(accountId); if (fromInput.value && toInput.value) shiftsForm.requestSubmit(); }
            catch { proposalStatus.textContent = "Approvazione non riuscita: la proposta resta invariata. Verifica la revisione e riprova."; approve.disabled = false; }
          });
          const reject = document.createElement("button"); reject.type = "button"; reject.textContent = "Rifiuta";
          reject.addEventListener("click", async () => {
            reject.disabled = true; proposalStatus.textContent = "Registrazione del rifiuto…";
            try { await rejectOwnEmployeeShiftProposal({ accountId, proposalId: proposal.proposalId }); proposalStatus.textContent = "Proposta rifiutata."; await loadOwnProposals(accountId); }
            catch { proposalStatus.textContent = "Non è stato possibile registrare il rifiuto."; reject.disabled = false; }
          });
          article.append(approve, reject);
        }
        proposalResults.append(article);
      }
      proposalStatus.textContent = "Proposte caricate: " + items.length + ".";
    } catch { if (!disposed && current === proposalQueryGeneration) { proposalResults.replaceChildren(); proposalStatus.textContent = "Proposte non disponibili. Verifica accesso e riprova."; } }
  }

  function clearShiftResults() {
    shiftsResults.replaceChildren();
  }

  function hideShiftView() {
    shiftQueryGeneration += 1;
    proposalQueryGeneration += 1;
    clearProposalView();
    latestShiftItems = [];
    targetInput.replaceChildren();
    const noTarget = document.createElement("option"); noTarget.value = ""; noTarget.textContent = "Cerca prima i tuoi turni"; targetInput.append(noTarget);
    proposalForm.reset(); updateProposalFormMode();
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
    latestShiftItems = Array.isArray(items) ? items : [];
    targetInput.replaceChildren();
    const emptyTarget = document.createElement("option"); emptyTarget.value = ""; emptyTarget.textContent = latestShiftItems.length ? "Seleziona il turno" : "Cerca prima i tuoi turni"; targetInput.append(emptyTarget);
    for (const shift of latestShiftItems) { const option = document.createElement("option"); option.value = shift.shiftId; option.textContent = shift.date + " — " + shift.type + " — " + (shift.post ?? "") + " — rev. " + shift.revision; targetInput.append(option); }
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

  proposalForm.addEventListener("submit", async event => {
    event.preventDefault();
    const accountId = activeFirebaseAccountId();
    if (!accountId || accountId !== selectedAccountId || typeof proposeOwnEmployeeShiftChanges !== "function") { proposalStatus.textContent = "Sessione personale non attiva o invio proposta non disponibile."; return; }
    const operation = operationInput.value;
    let change;
    if (operation === "create") {
      if (!proposalDateInput.value || !proposalTypeInput.value) { proposalStatus.textContent = "Inserisci data e tipo del nuovo turno."; return; }
      const shift = { date: proposalDateInput.value, type: proposalTypeInput.value };
      if (proposalPostInput.value) shift.post = proposalPostInput.value;
      if (proposalStartInput.value || proposalEndInput.value) { if (!proposalStartInput.value || !proposalEndInput.value) { proposalStatus.textContent = "Inserisci entrambe le ore del turno."; return; } shift.start_time = proposalStartInput.value; shift.end_time = proposalEndInput.value; }
      if (proposalHoursInput.value !== "") shift.hours = Number(proposalHoursInput.value);
      change = { operation, shift };
    } else {
      const target = latestShiftItems.find(item => item.shiftId === targetInput.value);
      if (!target) { proposalStatus.textContent = "Seleziona un turno presente nel tuo calendario caricato."; return; }
      if (operation === "delete") change = { operation, shiftId: target.shiftId, expectedRevision: target.revision };
      else {
        const changes = {};
        if (proposalTypeInput.value) changes.type = proposalTypeInput.value;
        if (proposalPostInput.value) changes.post = proposalPostInput.value;
        if (proposalStartInput.value || proposalEndInput.value) { if (!proposalStartInput.value || !proposalEndInput.value) { proposalStatus.textContent = "Inserisci entrambe le ore del turno."; return; } changes.start_time = proposalStartInput.value; changes.end_time = proposalEndInput.value; }
        if (proposalHoursInput.value !== "") changes.hours = Number(proposalHoursInput.value);
        if (!Object.keys(changes).length) { proposalStatus.textContent = "Inserisci almeno un campo da modificare."; return; }
        change = { operation, shiftId: target.shiftId, expectedRevision: target.revision, changes };
      }
    }
    proposalSubmit.disabled = true; proposalStatus.textContent = "Invio della proposta personale…";
    try { await proposeOwnEmployeeShiftChanges({ accountId, source: "employee_manual", changes: [change] }); proposalForm.reset(); updateProposalFormMode(); proposalStatus.textContent = "Proposta inviata. Il calendario non cambia finché non la approvi."; await loadOwnProposals(accountId); }
    catch { proposalStatus.textContent = "Proposta non inviata. Controlla i dati e riprova."; }
    finally { proposalSubmit.disabled = false; }
  });

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
      void loadOwnProposals(selected.accountId);
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
      proposalQueryGeneration += 1;
      clearProposalView();
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
