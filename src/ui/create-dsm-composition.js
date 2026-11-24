import { createDSMCoreSession } from "../core/database/create-dsm-session.js";

/**
 * Crea un composition root DSM isolato attorno a una connessione già aperta.
 * accountId è un namespace locale, NON un'identità autenticata.
 * Il chiamante trasferisce esplicitamente la proprietà della chiusura DB.
 */
export function createDSMComposition({ db, accountId, mount, closeDatabase } = {}) {
  if (!db || typeof db.transaction !== "function" || !db.objectStoreNames) {
    throw new TypeError("Connessione database DSM non valida.");
  }
  if (typeof accountId !== "string" || !accountId.trim()) {
    throw new TypeError("È richiesto un accountId locale non vuoto.");
  }
  if (typeof mount !== "function") throw new TypeError("La funzione mount è obbligatoria.");
  if (typeof closeDatabase !== "function") {
    throw new TypeError("La funzione proprietaria di chiusura database è obbligatoria.");
  }

  let sessionPromise = null;
  let phase = "created";
  let closeComplete = false;

  async function getSession() {
    sessionPromise ??= createDSMCoreSession({ db, accountId });
    return sessionPromise;
  }

  async function start() {
    if (phase === "active") return api;
    if (phase !== "created") throw new Error("Composition DSM non avviabile nello stato corrente.");
    phase = "mounting";
    const session = await getSession();
    try {
      const registerCleanup = cleanup => {
        if (typeof cleanup !== "function") throw new TypeError("Cleanup vista non valido.");
        let active = true;
        const dispose = async () => {
          if (!active) return;
          await cleanup();
          active = false;
        };
        session.lifecycle.registerDisposable(dispose);
        return dispose;
      };
      const result = await mount(Object.freeze({ session, registerCleanup }));
      if (typeof result === "function") registerCleanup(result);
      phase = "active";
      return api;
    } catch (error) {
      phase = "mount-failed";
      try {
        await teardown();
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], "Mount DSM fallito; teardown incompleto e ripetibile.");
      }
      throw error;
    }
  }

  async function teardown() {
    if (phase === "closed") return;
    phase = "tearing-down";
    const session = await getSession();
    const status = session.lifecycle.getStatus();
    if (status.state === "switching") {
      await session.resumePendingTransition();
    } else if (status.state !== "cleared") {
      await session.logout();
    }
    session.dispose();
    if (!closeComplete) {
      await closeDatabase(db);
      closeComplete = true;
    }
    phase = "closed";
  }

  const api = Object.freeze({
    start,
    teardown,
    get status() { return phase; }
  });
  return api;
}
