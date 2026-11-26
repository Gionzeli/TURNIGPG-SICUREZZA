const ACCOUNT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const ROLE_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;

function deny(message) {
  const error = new Error(message);
  error.code = "DSM_FIREBASE_AUTH_DENIED";
  return error;
}

function freezePrincipal(authorization, user) {
  const principal = authorization.principal;
  return Object.freeze({
    uid: user.uid,
    email: typeof user.email === "string" ? user.email : null,
    accountId: principal.accountId,
    role: principal.role,
    permissions: Object.freeze([...principal.permissions]),
    expiresAt: authorization.expiresAt,
    identityProvider: "firebase",
    authorizationSource: "server"
  });
}

/**
 * Isolated Firebase Auth adapter.
 *
 * resolveAuthorization MUST call a trusted server endpoint that verifies the
 * Firebase ID token (including revocation) and resolves current membership.
 * A client-side Firestore read or a UI event is not an authorization source.
 *
 * This adapter intentionally does not activate DSM's local-only account
 * context. Its principal is an adapter result, not a core session capability.
 */
export function createFirebaseAuthAdapter({
  auth,
  onAuthStateChanged,
  resolveAuthorization,
  getAccountSelectionSnapshot,
  now = () => Date.now()
} = {}) {
  if (!auth || typeof auth !== "object" ||
      typeof onAuthStateChanged !== "function" ||
      typeof resolveAuthorization !== "function" ||
      typeof getAccountSelectionSnapshot !== "function" ||
      typeof now !== "function") {
    throw new TypeError("Configurazione adapter Firebase non valida.");
  }

  let currentUser = null;
  let initialized = false;
  let disposed = false;
  let generation = 0;
  let unsubscribeAuth = null;
  let initialResolve;
  let initialReject;
  const initialState = new Promise((resolve, reject) => {
    initialResolve = resolve;
    initialReject = reject;
  });

  const listeners = new Set();

  function handleAuthState(user) {
    if (disposed) return;
    currentUser = user ?? null;
    generation += 1;
    if (!initialized) {
      initialized = true;
      initialResolve();
    }
    for (const listener of [...listeners]) {
      try { listener(Object.freeze({ authenticated: Boolean(currentUser), generation })); }
      catch { /* Observer failures must not affect auth state. */ }
    }
  }

  try {
    unsubscribeAuth = onAuthStateChanged(auth, handleAuthState, error => {
      if (!initialized) {
        initialized = true;
        initialReject(error);
      }
    });
  } catch (error) {
    initialized = true;
    initialReject(error);
  }

  async function getPrincipal() {
    if (disposed) throw deny("Adapter Firebase dismesso.");
    await initialState;
    if (disposed) throw deny("Adapter Firebase dismesso.");

    const user = currentUser;
    const capturedGeneration = generation;
    if (!user) return null;
    if (typeof user.uid !== "string" || !/^[A-Za-z0-9._:@-]{1,160}$/.test(user.uid)) {
      throw deny("Identità Firebase non valida.");
    }
    if (user.emailVerified !== true) {
      throw deny("Indirizzo email non verificato.");
    }
    if (typeof user.getIdToken !== "function") {
      throw deny("Token Firebase non disponibile.");
    }

    let idToken;
    try {
      // Force refresh; the server endpoint must independently verify revocation.
      idToken = await user.getIdToken(true);
    } catch {
      throw deny("Impossibile aggiornare la sessione Firebase.");
    }
    if (typeof idToken !== "string" || idToken.length < 16) {
      throw deny("Token Firebase non valido.");
    }

    let authorization;
    let selectedAccount;
    try {
      selectedAccount = await getAccountSelectionSnapshot();
      if (!selectedAccount || typeof selectedAccount !== "object" ||
          typeof selectedAccount.accountId !== "string" ||
          !ACCOUNT_ID_PATTERN.test(selectedAccount.accountId) ||
          !Number.isSafeInteger(selectedAccount.revision) || selectedAccount.revision < 0) {
        throw deny("Snapshot selezione account non valido.");
      }
      authorization = await resolveAuthorization({
        accountId: selectedAccount.accountId,
        uid: user.uid,
        idToken
      });
    } catch {
      throw deny("Autorizzazione account non disponibile.");
    }

    // A newer auth event or account selection wins over every late response.
    if (disposed || generation !== capturedGeneration || currentUser !== user) return null;
    let currentAccountSelection;
    try {
      currentAccountSelection = await getAccountSelectionSnapshot();
    } catch {
      throw deny("Selettore account non disponibile dopo l'autorizzazione.");
    }
    if (disposed || generation !== capturedGeneration || currentUser !== user) return null;
    if (!currentAccountSelection ||
        currentAccountSelection.accountId !== selectedAccount.accountId ||
        currentAccountSelection.revision !== selectedAccount.revision) return null;

    const principal = authorization?.principal;
    if (!authorization || authorization.authorizationSource !== "server" ||
        !principal || principal.uid !== user.uid ||
        (principal.status !== undefined && principal.status !== "active") ||
        principal.accountId !== selectedAccount.accountId ||
        typeof principal.accountId !== "string" ||
        !ACCOUNT_ID_PATTERN.test(principal.accountId) ||
        typeof principal.role !== "string" ||
        !ROLE_PATTERN.test(principal.role) ||
        !Array.isArray(principal.permissions) ||
        principal.permissions.some(permission =>
          typeof permission !== "string" || permission.length === 0 || permission.length > 128) ||
        !Number.isFinite(authorization.expiresAt) ||
        authorization.expiresAt <= now()) {
      throw deny("Appartenenza o autorizzazione non valida.");
    }

    return freezePrincipal(authorization, user);
  }

  return Object.freeze({
    getPrincipal,
    subscribe(listener) {
      if (disposed) throw deny("Adapter Firebase dismesso.");
      if (typeof listener !== "function") throw new TypeError("Listener non valido.");
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      currentUser = null;
      try { unsubscribeAuth?.(); } finally { listeners.clear(); }
    }
  });
}
