const ACCOUNT_ID = "turnigpg-sicurezza";

function element(tag, className, text) {
  const value = document.createElement(tag);
  if (className) value.className = className;
  if (text !== undefined) value.textContent = text;
  return value;
}
function field(labelText, type, value = "") {
  const label = element("label", "", labelText);
  const input = element("input");
  input.type = type;
  input.value = value;
  input.required = true;
  label.append(input);
  return { label, input };
}

/** User-facing invitation controls. Authorization remains exclusively server-side. */
export function mountDSMMembershipInvitePage(container, {
  auth, proposeInvite, approveInvite, claimInvite
} = {}) {
  if (!container || !auth || typeof proposeInvite !== "function" ||
      typeof approveInvite !== "function" || typeof claimInvite !== "function") {
    throw new TypeError("Configurazione inviti DSM non valida.");
  }
  const heading = element("h3", "", "Inviti collaboratori DSM");
  const explanation = element("p", "hint",
    "L'invito richiede due amministratori distinti. Il collaboratore deve accedere con l'indirizzo verificato a cui è stato destinato. Nessun indirizzo email viene mostrato o salvato in chiaro.");
  const status = element("p", "hint", "Le operazioni sono disponibili solo con identità Firebase verificata.");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  const account = field("Account ID", "text", ACCOUNT_ID);
  account.input.readOnly = true;
  const inviteId = field("Codice invito (scegline uno univoco)", "text");
  inviteId.input.maxLength = 128;
  inviteId.input.pattern = "[A-Za-z0-9_-]{1,128}";
  const siteId = field("ID sede attiva", "text");
  siteId.input.maxLength = 128;
  siteId.input.pattern = "[A-Za-z0-9_-]{1,128}";
  const email = field("Email del collaboratore", "email");
  email.input.maxLength = 254;

  const propose = element("button", "pri", "Proponi invito");
  propose.type = "button";
  const approve = element("button", "", "Approva invito (secondo amministratore)");
  approve.type = "button";
  const adminForm = element("section", "card");
  adminForm.append(element("h4", "", "Amministratori"), account.label, inviteId.label,
    siteId.label, email.label, propose, approve);

  const claimCode = field("Codice invito ricevuto", "text");
  claimCode.input.maxLength = 128;
  claimCode.input.pattern = "[A-Za-z0-9_-]{1,128}";
  const claim = element("button", "pri", "Riscatta invito");
  claim.type = "button";
  const claimForm = element("section", "card");
  claimForm.append(element("h4", "", "Collaboratore"), account.label.cloneNode(true), claimCode.label, claim);

  container.replaceChildren(heading, explanation, adminForm, claimForm, status);
  let disposed = false;
  let busy = false;

  function identityReady() {
    return !disposed && auth.currentUser && auth.currentUser.emailVerified === true;
  }
  function setBusy(value) {
    busy = value;
    for (const button of [propose, approve, claim]) button.disabled = value || !identityReady();
  }
  async function run(action, success) {
    if (busy || !identityReady()) {
      status.textContent = "Accedi con un account Firebase e verifica l'indirizzo email.";
      return;
    }
    setBusy(true);
    status.textContent = "Operazione in corso. Le autorizzazioni vengono verificate dal server…";
    try {
      await action();
      if (!disposed) status.textContent = success;
    } catch {
      if (!disposed) status.textContent = "Operazione rifiutata o non disponibile. Verifica account, invito, scadenza e autorizzazioni.";
    } finally {
      if (!disposed) setBusy(false);
    }
  }
  const onPropose = () => run(() => proposeInvite({
    accountId: ACCOUNT_ID, inviteId: inviteId.input.value.trim(),
    siteId: siteId.input.value.trim(), email: email.input.value.trim()
  }), "Proposta registrata. Comunica il codice invito al secondo amministratore secondo la procedura interna.");
  const onApprove = () => run(() => approveInvite({
    accountId: ACCOUNT_ID, inviteId: inviteId.input.value.trim()
  }), "Approvazione registrata. Il collaboratore può riscattare il codice dopo aver verificato la propria email Firebase.");
  const onClaim = () => run(() => claimInvite({
    accountId: ACCOUNT_ID, inviteId: claimCode.input.value.trim()
  }), "Invito riscattato. La membership canonica è stata attivata; l'associazione Employee resta un passaggio separato.");
  propose.addEventListener("click", onPropose);
  approve.addEventListener("click", onApprove);
  claim.addEventListener("click", onClaim);
  setBusy(false);

  return Object.freeze({
    destroy() {
      if (disposed) return;
      disposed = true;
      propose.removeEventListener("click", onPropose);
      approve.removeEventListener("click", onApprove);
      claim.removeEventListener("click", onClaim);
      container.replaceChildren();
    }
  });
}
