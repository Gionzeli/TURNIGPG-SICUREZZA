const DEFAULT_RENEWAL_LEAD_MS = 60_000;

function authorizationIdentity(value) {
  if (!value || typeof value.uid !== "string" || !value.uid ||
      typeof value.accountId !== "string" || !value.accountId) {
    throw new TypeError("Identità Firebase non valida.");
  }
  return Object.freeze({ uid: value.uid, accountId: value.accountId });
}

function sameIdentity(left, right) {
  return left?.uid === right?.uid && left?.accountId === right?.accountId;
}

/**
 * Epoch-guarded, fail-closed renewal coordinator.
 *
 * This module is deliberately standalone: callers supply the trusted resolver
 * and principal installer. It does not observe Firebase Auth, access Firestore,
 * persist tokens, or wire itself into the production composition root.
 */
export function createFirebaseAuthRenewalCoordinator({
  getIdentity,
  resolveAuthorization,
  installPrincipal,
  clearPrincipal,
  now = () => Date.now(),
  renewalLeadMs = DEFAULT_RENEWAL_LEAD_MS,
  schedule = (callback, delay) => setTimeout(callback, delay),
  cancelSchedule = handle => clearTimeout(handle)
} = {}) {
  if (typeof getIdentity !== "function" ||
      typeof resolveAuthorization !== "function" ||
      typeof installPrincipal !== "function" ||
      typeof clearPrincipal !== "function" ||
      typeof now !== "function" ||
      typeof schedule !== "function" ||
      typeof cancelSchedule !== "function" ||
      !Number.isFinite(renewalLeadMs) || renewalLeadMs < 0) {
    throw new TypeError("Configurazione coordinatore rinnovo Firebase non valida.");
  }

  let state = "inactive";
  let epoch = 0;
  let disposed = false;
  let inFlight = null;
  let timer = null;
  let activeIdentity = null;
  let activeExpiry = null;

  function cancelTimer() {
    if (timer !== null) {
      cancelSchedule(timer);
      timer = null;
    }
  }

  function clearActive() {
    cancelTimer();
    activeIdentity = null;
    activeExpiry = null;
    clearPrincipal();
  }

  function scheduleRenewal(identity, expiry, capturedEpoch) {
    cancelTimer();
    const delay = Math.max(0, expiry - now() - renewalLeadMs);
    timer = schedule(() => {
      timer = null;
      if (disposed || epoch !== capturedEpoch || state !== "active" ||
          !sameIdentity(activeIdentity, identity)) return;
      void renew("scheduled").catch(() => {});
    }, delay);
  }

  function renew(reason = "manual") {
    if (disposed) return Promise.reject(new Error("Coordinatore rinnovo dismesso."));
    if (inFlight) return inFlight;

    let identity;
    try {
      identity = authorizationIdentity(getIdentity());
    } catch (error) {
      clearActive();
      state = "blocked";
      return Promise.reject(error);
    }

    const capturedEpoch = epoch;
    if (state === "active" && !sameIdentity(activeIdentity, identity)) {
      epoch += 1;
      clearActive();
    }
    const requestEpoch = epoch;
    state = "refreshing";
    cancelTimer();

    const task = (async () => {
      try {
        const principal = await resolveAuthorization(Object.freeze({
          uid: identity.uid,
          accountId: identity.accountId,
          reason
        }));
        const currentIdentity = authorizationIdentity(getIdentity());
        if (disposed || requestEpoch !== epoch) return null;
        if (!sameIdentity(identity, currentIdentity)) {
          epoch += 1;
          state = "inactive";
          clearActive();
          return null;
        }
        if (!principal || principal.uid !== identity.uid ||
            principal.accountId !== identity.accountId ||
            !Number.isFinite(principal.expiresAt) || principal.expiresAt <= now()) {
          throw new Error("Autorizzazione Firebase rinnovata non valida.");
        }
        installPrincipal(principal);
        activeIdentity = identity;
        activeExpiry = principal.expiresAt;
        state = "active";
        scheduleRenewal(identity, activeExpiry, requestEpoch);
        return principal;
      } catch (error) {
        if (!disposed && requestEpoch === epoch) {
          clearActive();
          state = "blocked";
        }
        throw error;
      }
    })();
    inFlight = task;
    task.finally(() => {
      if (inFlight === task) inFlight = null;
    }).catch(() => {});
    return task;
  }

  function invalidate(reason = "identity-change") {
    if (disposed) return false;
    epoch += 1;
    // Detach the stale request so a new identity can renew immediately.
    // Its captured epoch prevents a late result from installing authorization.
    inFlight = null;
    clearActive();
    state = "inactive";
    return Object.freeze({ invalidated: true, reason, epoch });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    epoch += 1;
    clearActive();
    state = "disposed";
  }

  return Object.freeze({
    renew,
    invalidate,
    dispose,
    getStatus() {
      return Object.freeze({
        state,
        epoch,
        inFlight: inFlight !== null,
        expiresAt: activeExpiry,
        identity: activeIdentity
      });
    }
  });
}
