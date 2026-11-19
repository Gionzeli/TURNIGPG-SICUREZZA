/* Prototipo AI locale: sola rilevazione capacità, nessun caricamento di modelli.
 * Non legge documenti, non effettua richieste di rete e non modifica l'app.
 * Da integrare solo dopo test reali su dispositivi rappresentativi.
 */
(function (root) {
  "use strict";

  function probe() {
    const nav = root.navigator || {};
    const hasWasm = typeof root.WebAssembly === "object" &&
      typeof root.WebAssembly.validate === "function";
    const hasWebGPU = !!(nav.gpu && typeof nav.gpu.requestAdapter === "function");
    const hasPromptAPI = typeof root.LanguageModel !== "undefined";
    const hasWebNN = !!nav.ml;
    const memory = Number.isFinite(nav.deviceMemory) ? nav.deviceMemory : null;
    const cores = Number.isFinite(nav.hardwareConcurrency) ? nav.hardwareConcurrency : null;

    let tier = "basic";
    if (hasWasm && (hasWebGPU || hasWebNN || hasPromptAPI) &&
        (memory === null || memory >= 4) && (cores === null || cores >= 4)) {
      tier = "candidate";
    }
    if (hasWasm && hasWebGPU && (memory === null || memory >= 8) &&
        (cores === null || cores >= 6)) {
      tier = "accelerated-candidate";
    }

    return Object.freeze({
      secureContext: root.isSecureContext === true,
      wasm: hasWasm,
      webgpu: hasWebGPU,
      webnn: hasWebNN,
      promptAPI: hasPromptAPI,
      deviceMemoryGB: memory,
      logicalCores: cores,
      tier: tier,
      modelReady: false,
      note: "La presenza di un'API non garantisce che un modello sia installato o utilizzabile."
    });
  }

  root.LocalAIEnvironment = Object.freeze({ probe: probe });
})(typeof window !== "undefined" ? window : globalThis);
