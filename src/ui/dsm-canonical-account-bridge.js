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
  createAuthAdapter,
  openDatabase,
  closeDatabase,
  createSession
} = {}) {
  const required = [auth, onAuthStateChanged, listCanonicalAccounts, resolveAuthorization,
    createAuthAdapter, openDatabase, closeDatabase, createSession];
  if (!container || required.some(value => !value) ||
      typeof onAuthStateChanged !== "function" ||
      typeof listCanonicalAccounts !== "function" ||
      typeof resolveAuthorization !== "function" ||
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
  note.textContent = "Il collegamento abilita soltanto il contesto account locale DSM. Non importa dati e non abilita API Employee non ancora implementate.";
  container.replaceChildren(title, status, select, button, note);

  let disposed = false;
  let generation = 0;
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

  select.addEventListener("change", () => {
    selectedAccountId = availableAccounts.some(item => item.accountId === select.value)
      ? select.value : null;
    selectionRevision += 1;
    button.disabled = !selectedAccountId || Boolean(activationPromise);
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
      if (!result || result.state !== "active" || result.identitySource !== "firebase" ||
          result.accountId !== selected.accountId) {
        throw new Error("Il contesto DSM non corrisponde all'account selezionato.");
      }
      setStatus(`Identità verificata e account DSM ${selected.accountId} collegato. Dati operativi e API Employee restano disabilitati finché non saranno completati e verificati.`);
    })();
    activationPromise = task;
    try {
      await task;
    } catch {
      setStatus("Collegamento non riuscito o autorizzazione revocata. Nessun dato operativo è stato importato.");
    } finally {
      activationPromise = null;
      if (!disposed) button.disabled = !selectedAccountId;
    }
  });

  return Object.freeze({
    destroy() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      authUnsubscribe?.();
      authAdapter.dispose();
      select.removeEventListener("change", () => {});
      button.removeEventListener("click", () => {});
      const cleanup = async () => {
        if (session) await session.dispose();
        if (db) await closeDatabase();
      };
      void cleanup().catch(() => {});
      container.replaceChildren();
    }
  });
}
