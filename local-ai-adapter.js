/* Adattatore AI locale sperimentale.
 * Non contiene runtime, modello, endpoint cloud o caricamento automatico.
 * Il caricatore deve fornire esplicitamente un runtime eseguito sul dispositivo.
 */
(function (root) {
  "use strict";

  let loader = null;
  let loadedRunner = null;
  let loading = null;
  let lifecycleController = null;
  let timeoutMs = 30000;
  let maxChars = 120000;

  function configure(options) {
    if (!options || typeof options.loadModel !== "function") {
      throw new TypeError("È necessario fornire un caricatore locale esplicito.");
    }
    if (loadedRunner || loading) {
      throw new Error("Rilascia prima il modello attivo per riconfigurare il motore.");
    }
    loader = options.loadModel;
    timeoutMs = Number.isFinite(options.timeoutMs)
      ? Math.min(120000, Math.max(1000, options.timeoutMs)) : 30000;
    maxChars = Number.isFinite(options.maxChars)
      ? Math.min(200000, Math.max(1000, options.maxChars)) : 120000;
  }

  function abortError(message) {
    const error = new Error(message || "Operazione annullata.");
    error.name = "AbortError";
    return error;
  }

  function getRunner(signal) {
    if (signal && signal.aborted) return Promise.reject(abortError());
    if (loadedRunner) return Promise.resolve(loadedRunner);
    if (!loader) return Promise.reject(new Error("Motore AI locale non configurato."));
    if (!loading) {
      lifecycleController = new AbortController();
      const loadSignal = lifecycleController.signal;
      loading = Promise.resolve()
        .then(() => loader({ signal: loadSignal }))
        .then((runner) => {
          if (loadSignal.aborted) throw abortError();
          if (typeof runner !== "function") {
            throw new TypeError("Il motore locale non ha restituito una funzione valida.");
          }
          loadedRunner = runner;
          return runner;
        })
        .finally(() => { loading = null; });
      // Evita rejection non gestite se un chiamante annulla mentre il caricamento continua.
      loading.catch(() => {});
    }
    return loading;
  }

  async function analyze(documentText, options) {
    const opts = options || {};
    if (typeof documentText !== "string" || !documentText.trim()) {
      throw new TypeError("Il testo del documento è vuoto.");
    }
    if (documentText.length > maxChars) {
      throw new RangeError("Documento troppo lungo per questa prova locale.");
    }
    if (opts.signal && opts.signal.aborted) throw abortError();

    const controller = new AbortController();
    const externalSignal = opts.signal;
    const forwardAbort = () => controller.abort();
    if (externalSignal) externalSignal.addEventListener("abort", forwardAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let timedOut = false;
    const timeoutCheck = setInterval(() => {
      if (controller.signal.aborted && !(externalSignal && externalSignal.aborted)) timedOut = true;
    }, 25);

    try {
      const runner = await getRunner(controller.signal);
      if (controller.signal.aborted) {
        if (timedOut) throw new Error("Tempo massimo AI superato.");
        throw abortError();
      }
      const result = await runner({
        text: documentText,
        task: typeof opts.task === "string" ? opts.task : "document",
        signal: controller.signal
      });
      if (controller.signal.aborted) {
        if (timedOut) throw new Error("Tempo massimo AI superato.");
        throw abortError();
      }
      if (!result || typeof result !== "object" || Array.isArray(result)) {
        throw new TypeError("Il modello non ha restituito dati strutturati.");
      }
      return result;
    } catch (error) {
      if (controller.signal.aborted && timedOut) throw new Error("Tempo massimo AI superato.");
      if (controller.signal.aborted && !(error && error.name === "AbortError")) throw abortError();
      throw error;
    } finally {
      clearTimeout(timer);
      clearInterval(timeoutCheck);
      if (externalSignal) externalSignal.removeEventListener("abort", forwardAbort);
    }
  }

  async function release() {
    if (lifecycleController) lifecycleController.abort();
    const pending = loading;
    if (pending) {
      try { await pending; } catch (_) { /* annullamento/caricamento fallito: rilascio comunque */ }
    }
    const runner = loadedRunner;
    loadedRunner = null;
    loading = null;
    lifecycleController = null;
    if (runner && typeof runner.dispose === "function") await runner.dispose();
  }

  root.LocalDocumentAI = Object.freeze({
    configure,
    analyze,
    release,
    status: () => Object.freeze({
      configured: typeof loader === "function",
      loaded: typeof loadedRunner === "function",
      loading: !!loading
    })
  });
})(typeof window !== "undefined" ? window : globalThis);
