import { DatabaseError, DB_ERROR_CODES } from "../database/database-errors.js";

const MESSAGE_TYPE = "dsm-account-transition";
const MESSAGE_VERSION = 1;
const TAB_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export function createAccountLifecycleCrossTabBridge({ lifecycleCoordinator, channel, tabId } = {}) {
  if (!lifecycleCoordinator ||
      typeof lifecycleCoordinator.beginTransition !== "function" ||
      typeof lifecycleCoordinator.clear !== "function" ||
      typeof lifecycleCoordinator.getStatus !== "function" ||
      typeof lifecycleCoordinator.subscribe !== "function") {
    throw new DatabaseError(DB_ERROR_CODES.VALIDATION_FAILED, "Coordinatore lifecycle non valido.");
  }
  if (!channel || typeof channel.postMessage !== "function" ||
      typeof channel.addEventListener !== "function" ||
      typeof channel.removeEventListener !== "function") {
    throw new DatabaseError(DB_ERROR_CODES.VALIDATION_FAILED, "Canale cross-tab non valido.");
  }
  if (typeof tabId !== "string" || !TAB_ID_PATTERN.test(tabId)) {
    throw new DatabaseError(DB_ERROR_CODES.VALIDATION_FAILED, "Identificativo scheda non valido.");
  }

  let sequence = 0;
  let disposed = false;
  let applyingRemote = false;
  let pendingRemote = false;
  let pendingToken = null;
  const lastSequenceBySender = new Map();

  function publishTransition() {
    sequence += 1;
    try {
      channel.postMessage({
        type: MESSAGE_TYPE,
        version: MESSAGE_VERSION,
        senderId: tabId,
        sequence
      });
    } catch {
      // Broadcast is best-effort. It is not an authentication or security boundary.
    }
  }

  async function applyRemoteInvalidation() {
    if (disposed || !pendingRemote || applyingRemote) return;
    const status = lifecycleCoordinator.getStatus();
    if (status.state === "switching") return;
    if (status.state === "cleared") {
      pendingRemote = false;
      pendingToken = null;
      return;
    }

    applyingRemote = true;
    try {
      pendingToken = await lifecycleCoordinator.beginTransition("switch");
      if (!lifecycleCoordinator.getStatus().cleanupComplete) return;
      lifecycleCoordinator.clear(pendingToken);
      pendingToken = null;
      pendingRemote = false;
    } catch {
      // Keep the pending marker/token so the caller can retry explicitly.
    } finally {
      applyingRemote = false;
    }
  }

  function onMessage(event) {
    const message = event?.data;
    if (disposed || !message || typeof message !== "object" ||
        message.type !== MESSAGE_TYPE || message.version !== MESSAGE_VERSION ||
        typeof message.senderId !== "string" || !TAB_ID_PATTERN.test(message.senderId) ||
        message.senderId === tabId ||
        !Number.isSafeInteger(message.sequence) || message.sequence < 1) return;

    const last = lastSequenceBySender.get(message.senderId) || 0;
    if (message.sequence <= last) return;
    lastSequenceBySender.set(message.senderId, message.sequence);
    pendingRemote = true;
    void applyRemoteInvalidation();
  }

  const unsubscribeLifecycle = lifecycleCoordinator.subscribe(event => {
    if (disposed) return;
    if (event.type === "transition-start" && !applyingRemote) publishTransition();
    if (event.type === "context-active" && pendingRemote) void applyRemoteInvalidation();
    if (event.type === "context-cleared" && !applyingRemote) {
      pendingRemote = false;
      pendingToken = null;
    }
  });
  channel.addEventListener("message", onMessage);

  return Object.freeze({
    getStatus() {
      return Object.freeze({
        disposed,
        pendingRemote,
        cleanupPending: Boolean(pendingToken)
      });
    },

    async retryPendingInvalidation() {
      if (disposed) throw new DatabaseError(DB_ERROR_CODES.ACCESS_DENIED, "Bridge cross-tab dismesso.");
      if (!pendingRemote) return lifecycleCoordinator.getStatus();
      if (!pendingToken) {
        await applyRemoteInvalidation();
        if (!pendingToken && pendingRemote) {
          return lifecycleCoordinator.getStatus();
        }
      }
      if (pendingToken) {
        const complete = await lifecycleCoordinator.retryCleanup(pendingToken);
        if (!complete) return lifecycleCoordinator.getStatus();
        lifecycleCoordinator.clear(pendingToken);
        pendingToken = null;
        pendingRemote = false;
      }
      return lifecycleCoordinator.getStatus();
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      channel.removeEventListener("message", onMessage);
      unsubscribeLifecycle();
      lastSequenceBySender.clear();
    }
  });
}
