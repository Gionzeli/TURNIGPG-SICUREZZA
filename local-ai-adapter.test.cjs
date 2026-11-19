/* Esegui con: node local-ai-adapter.test.cjs */
const assert = require("node:assert/strict");
require("./local-ai-adapter.js");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const api = globalThis.LocalDocumentAI;
  assert.deepEqual(api.status(), { configured: false, loaded: false, loading: false });
  await assert.rejects(() => api.analyze("test"), /non configurato/);
  assert.throws(() => api.configure({}), /caricatore locale/);

  let loads = 0;
  let disposed = 0;
  api.configure({
    loadModel: async () => {
      loads++;
      return Object.assign(async ({ text, task }) => ({ task, chars: text.length }), {
        dispose: async () => { disposed++; }
      });
    },
    timeoutMs: 5000
  });
  assert.equal(api.status().loaded, false, "il modello non deve caricarsi alla configurazione");
  assert.deepEqual(await api.analyze("cedolino di prova"), { task: "document", chars: 17 });
  assert.equal(loads, 1);
  assert.equal(api.status().loaded, true);
  await assert.rejects(() => api.analyze(""), /vuoto/);
  await api.release();
  assert.equal(api.status().loaded, false);
  assert.equal(disposed, 1);

  api.configure({
    loadModel: async () => async () => new Promise((_, reject) => {
      const error = new Error("stopped");
      error.name = "AbortError";
      // Il runner deve poter interrompere il lavoro quando il timeout scatta.
      arguments;
      setTimeout(() => reject(error), 0);
    }),
    timeoutMs: 1000
  });
  await assert.rejects(() => api.analyze("test"), /Tempo massimo AI superato/);
  await api.release();

  const external = new AbortController();
  api.configure({
    loadModel: async () => async ({ signal }) => new Promise((_, reject) => {
      signal.addEventListener("abort", () => {
        const error = new Error("stopped");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    }),
    timeoutMs: 5000
  });
  const pending = api.analyze("documento", { signal: external.signal });
  await delay(10);
  external.abort();
  await assert.rejects(pending, (error) => error && error.name === "AbortError");
  await api.release();

  api.configure({
    loadModel: async () => { throw new Error("errore caricamento"); },
    timeoutMs: 5000
  });
  await assert.rejects(() => api.analyze("test"), /errore caricamento/);
  await api.release();

  console.log("OK: caricamento su richiesta, output, dispose, timeout, annullamento e errore loader.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
