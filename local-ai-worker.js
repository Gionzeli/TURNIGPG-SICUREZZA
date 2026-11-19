/* Worker isolato per la prova AI. Nessun testo del documento viene passato a endpoint applicativi.
 * Le richieste di rete servono a scaricare runtime, tokenizer e pesi pubblici del modello.
 */
let generator = null;
let busy = false;
const MODEL_ID = "onnx-community/Qwen3-0.6B-Instruct-ONNX";
const MODEL_REVISION = "54250909aca286a05b9d013c8af7a21859ee6ead";
const MAX_INPUT_CHARS = 6000;

function extractJsonObject(raw) {
  const text = String(raw || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const start = text.indexOf("{");
  if (start < 0) return null;
  for (let end = text.lastIndexOf("}"); end > start; end = text.lastIndexOf("}", end - 1)) {
    try {
      const value = JSON.parse(text.slice(start, end + 1));
      if (value && typeof value === "object" && !Array.isArray(value)) return value;
    } catch (_) { /* prova un'altra chiusura JSON */ }
  }
  return null;
}

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
      self.postMessage({ type: "status", message: "Scarico runtime, tokenizer e modello gratuito. Il file q4 è circa 997 MB, oltre ai componenti di supporto." });
      const { pipeline, env } = await import("https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2");
      env.allowRemoteModels = true;
      env.allowLocalModels = false;
      env.useBrowserCache = true;
      env.backends.onnx.wasm.numThreads = 1;
      generator = await pipeline("text-generation", MODEL_ID, {
        revision: MODEL_REVISION,
        device: "wasm",
        dtype: "q4"
      });
      self.postMessage({ type: "ready", model: MODEL_ID, revision: MODEL_REVISION });
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
    const text = typeof data.text === "string" ? data.text.slice(0, MAX_INPUT_CHARS) : "";
    if (!text.trim()) {
      self.postMessage({ type: "error", message: "Inserisci del testo di prova." });
      return;
    }
    busy = true;
    try {
      self.postMessage({ type: "status", message: "Analisi eseguita localmente sul dispositivo…" });
      const prompt = "<|im_start|>system\nSei un estrattore di cedolini. Restituisci solo JSON valido con questa forma: {\"tipo_documento\":\"cedolino\",\"campi\":[{\"nome\":\"Paga base\",\"valore\":\"importo\"}],\"incertezze\":[]}. Estrai ogni voce e il suo importo esattamente come appare. Non copiare i valori dell'esempio. Distingui Paga base, Scatti, Retribuzione e Ferie godute. Non inventare né chiedere conferma.\n<|im_end|>\n<|im_start|>user\n" + text + "\n<|im_end|>\n<|im_start|>assistant\n";
      const output = await generator(prompt, {
        max_new_tokens: 256,
        do_sample: false
      });
      const generated = output && output[0] && output[0].generated_text;
      const fullText = String(generated || "");
      const raw = fullText.startsWith(prompt) ? fullText.slice(prompt.length).trim() : fullText.trim();
      const normalized = raw.replace(/\\+"/g, '"').replace(/\\n/g, "\n");
      const parsed = extractJsonObject(normalized);
      self.postMessage({
        type: "result",
        answer: parsed ? JSON.stringify(parsed, null, 2) : raw,
        structured: !!parsed
      });
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
