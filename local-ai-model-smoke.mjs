import { pipeline, env } from "@huggingface/transformers";

const MODEL_ID = "onnx-community/Qwen3-0.6B-Instruct-ONNX";
const REVISION = "54250909aca286a05b9d013c8af7a21859ee6ead";
const sample = `CEDOLINO DI PROVA
Azienda: Esempio Servizi S.r.l.
Periodo: Ottobre 2026
Paga base: 1.468,88
Scatti: 84,52
Retribuzione: 896,19 per 15 giorni
Ferie godute: 657,21 per 11 giorni`;

env.allowRemoteModels = true;
env.allowLocalModels = false;
env.useBrowserCache = false;
env.backends.onnx.wasm.numThreads = 1;

console.log("MODEL", MODEL_ID, "REVISION", REVISION);
console.log("START_DOWNLOAD_AND_LOAD");
const generator = await pipeline("text-generation", MODEL_ID, {
  revision: REVISION,
  device: "cpu",
  dtype: "q4"
});
console.log("MODEL_READY");

const prompt = "<|im_start|>system\nSei un estrattore di cedolini. Restituisci solo JSON valido con questa forma: {\"tipo_documento\":\"cedolino\",\"campi\":[{\"nome\":\"Paga base\",\"valore\":\"importo\"}],\"incertezze\":[]}. Estrai ogni voce e il suo importo esattamente come appare. Non copiare i valori dell'esempio. Distingui Paga base, Scatti, Retribuzione e Ferie godute. Non inventare né chiedere conferma.\n<|im_end|>\n<|im_start|>user\n/no_think\n" + sample + "\n<|im_end|>\n<|im_start|>assistant\n";
const output = await generator(prompt, { max_new_tokens: 384, do_sample: false });
const generated = output?.[0]?.generated_text;
const fullText = String(generated || "");
const assistantAt = fullText.lastIndexOf("assistant");
const raw = assistantAt >= 0 ? fullText.slice(assistantAt + "assistant".length).trim() : fullText.trim();
console.log("RAW_OUTPUT_BEGIN");
console.log(raw);
console.log("RAW_OUTPUT_END");

const normalized = raw.replace(/\\+"/g, '"').replace(/\\n/g, "\n");
const cleaned = normalized.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
let parsed = null;
const start = cleaned.indexOf("{");
if (start >= 0) {
  for (let end = cleaned.lastIndexOf("}"); end > start; end = cleaned.lastIndexOf("}", end - 1)) {
    try {
      const candidate = JSON.parse(cleaned.slice(start, end + 1));
      if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
        parsed = candidate;
        break;
      }
    } catch {}
  }
}
if (!parsed || !Array.isArray(parsed.campi)) {
  throw new Error("Il modello non ha restituito JSON strutturato con campi[].");
}
const valueFor = label => {
  const field = parsed.campi.find(x => String(x.nome || "").trim().toLowerCase() === label.toLowerCase());
  return field ? String(field.valore || "") : "";
};
const checks = {
  hasBase: /1\.468,88/.test(valueFor("Paga base")),
  hasScatti: /84,52/.test(valueFor("Scatti")),
  hasRetribuzione: /896,19/.test(valueFor("Retribuzione")),
  hasFerie: /657,21/.test(valueFor("Ferie godute"))
};
console.log("QUALITY_CHECK", JSON.stringify(checks));
if (Object.values(checks).some(ok => !ok)) {
  throw new Error("Estrazione incompleta o importo associato all'etichetta sbagliata: " + JSON.stringify(checks));
}
console.log("STRUCTURED_INFERENCE_OK");



// Triggered CI validation after workflow installation. Retry 7.
