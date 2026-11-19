/* Esegui con: node local-ai-adapter.test.cjs */
const assert = require("node:assert/strict");
require("./local-ai-adapter.js");

(async () => {
  const api = globalThis.LocalDocumentAI;
  assert.deepEqual(api.status(), { configured: false, loaded: false, loading: false });

  await assert.rejects(() => api.analyze("test"), /non configurato/);
  assert.throws(() => api.configure({}), /caricatore locale/);

  let loads = 0;
  api.configure({
    loadModel: async () => {
      loads++;
      return async ({ text, task }) => ({ task, chars: text.length });
    },
    timeoutMs: 5000
  });
  assert.equal(api.status().loaded, false, "il modello non deve caricarsi alla configurazione");

  const result = await api.analyze("cedolino di prova");
  assert.deepEqual(result, { task: "document", chars: 17 });
  assert.equal(loads, 1);
  assert.equal(api.status().loaded, true);

  await assert.rejects(() => api.analyze(""), /vuoto/);
  await api.release();
  assert.equal(api.status().loaded, false);
  console.log("OK: caricamento solo su richiesta, output strutturato e rilascio modello.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
