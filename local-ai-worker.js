/* Worker isolato per la prova AI. Nessun documento viene caricato su server.
 * Le sole richieste di rete sono libreria/runtime e pesi del modello pubblico.
 */
let generator = null;
let busy = false;
const MODEL_ID = "onnx-community/Qwen3-0.6B-Instruct-ONNX";

self.onmessage = async (event) => {
  const data = event.data || {};
  if (data.type === "load") {
    if (generator) {
      self.postMessage({ type: "ready", model: MODEL_ID });
      return;
    }
    if (busy) return;
    busy = true;
    try {
      self.postMessage({ type: "status", message: "Scarico runtime e modello gratuito sul dispositivo. Il modello è grande: attendi il completamento." });
      const { pipeline, env } = await import("https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2");
      env.allowRemoteModels = true;
      env.allowLocalModels = false;
      env.useBrowserCache = true;
      env.backends.onnx.wasm.numThreads = 1;
      generator = await pipeline("text-generation", MODEL_ID, {
        device: "wasm",
        dtype: "q4"
      });
      self.postMessage({ type: "ready", model: MODEL_ID });
    } catch (error) {
      generator = null;
      self.postMessage({ type: "error", message: String(error && error.message || error) });
    } finally {
      busy = false;
    }
    return;
  }
  if (data.type === "analyze") {
    if (!generator) {
      self.postMessage({ type: "error", message: "Il modello non è ancora caricato." });
      return;
    }
    if (busy) {
      self.postMessage({ type: "error", message: "Attendi il completamento dell'operazione in corso." });
      return;
    }
    const text = typeof data.text === "string" ? data.text.slice(0, 12000) : "";
    if (!text.trim()) {
      self.postMessage({ type: "error", message: "Inserisci del testo di prova." });
      return;
    }
    busy = true;
    try {
      self.postMessage({ type: "status", message: "Analisi eseguita localmente sul dispositivo…" });
      const messages = [
        {
          role: "system",
          content: "Sei un estrattore documentale. Analizza il testo fornito e restituisci esclusivamente un oggetto JSON valido, senza Markdown e senza commenti. Schema: {\"tipo_documento\":string,\"lingua\":string,\"azienda\":string|null,\"persona\":string|null,\"periodo\":string|null,\"campi\":[{\"nome\":string,\"valore\":string,\"fonte\":string}],\"incertezze\":[string]}. Non inventare dati. Se un dato manca, usa null o un array vuoto. Conserva gli importi e le date esattamente come appaiono."
        },
        {
          role: "user",
          content: "Estrai i dati da questo testo, senza aggiungere informazioni:\n\n" + text
        }
      ];
      const output = await generator(messages, {
        max_new_tokens: 320,
        do_sample: false,
        temperature: 0.1
      });
      const generated = output && output[0] && output[0].generated_text;
      const answer = Array.isArray(generated)
        ? generated[generated.length - 1].content
        : String(generated || "");
      self.postMessage({ type: "result", answer });
    } catch (error) {
      self.postMessage({ type: "error", message: String(error && error.message || error) });
    } finally {
      busy = false;
    }
    return;
  }
  if (data.type === "release") {
    generator = null;
    self.postMessage({ type: "released" });
  }
};
