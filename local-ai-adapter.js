/* Adattatore AI locale sperimentale.
 * Nessun runtime, modello, fetch, storage o documento viene caricato automaticamente.
 * Il runtime viene fornito esplicitamente solo dal codice di integrazione futuro.
 */
(function (root) {
  "use strict";

  let loader = null;
  let loadedRunner = null;
  let loading = null;
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

  function abortError() {
    const error = new Error("Operazione annullata.");
    error.name = "AbortError";
    return error;
  }

  async function getRunner(signal) {
    if (signal && signal.aborted) throw abortError();
    if (loadedRunner) return loadedRunner;
    if (!loader) throw new Error("Motore AI locale non configurato.");
    if (!loading) {
      loading = Promise.resolve().then(() => loader()).then((runner) => {
        if (typeof runner !== "function") {
          throw new TypeError("Il motore locale non ha restituito una funzione valida.");
        }
        loadedRunner = runner;
        return runner;
      }).finally(() => { loading = null; });
    }
    return await Promise.race([
      loading,
      new Promise((_, reject) => {
        if (!signal) return;
        const onAbort = () => reject(abortError());
        signal.addEventListener("abort", onAbort, { once: true });
        loading.finally(() => signal.removeEventListener("abort", onAbort));
      })
    ]);
  }

  async function analyze(documentText, options) {
    const opts = options || {};
    const signal = opts.signal;
    if (typeof documentText !== "string" || !documentText.trim()) {
      throw new TypeError("Il testo del documento è vuoto.");
    }
    if (documentText.length > maxChars) {
      throw new RangeError("Documento troppo lungo per questa prova locale.");
    }
    if (signal && signal.aborted) throw abortError();

    let timer;
    let onAbort;
    const work = (async () => {
      const runner = await getRunner(signal);
      if (signal && signal.aborted) throw abortError();
      const result = await runner({
        text: documentText,
        task: typeof opts.task === "string" ? opts.task : "document",
        signal: signal || null
      });
      if (signal && signal.aborted) throw abortError();
      if (!result || typeof result !== "object" || Array.isArray(result)) {
        throw new TypeError("Il modello non ha restituito dati strutturati.");
      }
      return result;
    })();

    const guards = [work, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Tempo massimo AI superato.")), timeoutMs);
    })];
    if (signal) guards.push(new Promise((_, reject) => {
      onAbort = () => reject(abortError());
      signal.addEventListener("abort", onAbort, { once: true });
    }));

    try {
      return await Promise.race(guards);
    } finally {
      clearTimeout(timer);
      if (signal && onAbort) signal.removeEventListener("abort", onAbort);
    }
  }

  async function release() {
    const runner = loadedRunner;
    loadedRunner = null;
    if (runner && typeof runner.dispose === "function") {
      await runner.dispose();
    }
  }

  root.LocalDocumentAI = Object.freeze({
    configure: configure,
    analyze: analyze,
    release: release,
    status: function () {
      return Object.freeze({
        configured: typeof loader === "function",
        loaded: typeof loadedRunner === "function",
        loading: !!loading
      });
    }
  });
})(typeof window !== "undefined" ? window : globalThis);
