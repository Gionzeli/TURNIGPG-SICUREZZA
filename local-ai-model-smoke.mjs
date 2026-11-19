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

const normalized = raw.replace(/\+"/g, '"').replace(/\n/g, "\n");
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

// Caso avverso: il valore degli Scatti non deve essere scambiato per la Paga base.
// È accettabile che il modello segnali una voce come incerta; non è accettabile
// attribuire l'importo 1468,88 alla Paga base quando nel testo segue Scatti.
const tricky = "CEDOLINO DI PROVA\nPaga base: 1,2\nScatti: 1468,88\nRetribuzione: 896,19 per 15 giorni\nFerie godute: 657,21 per 11 giorni";
const trickyPrompt = "<|im_start|>system\nLeggi il testo senza correggerlo o completarlo. Associa ogni importo esclusivamente all'etichetta che lo precede. Non spostare mai un importo da una voce a un'altra. Se l'importo è incompleto, riportalo identico e segnala l'incertezza. Rispondi solo JSON con tipo_documento, campi [{nome,valore}], incertezze [{nome,valore}].\n<|im_end|>\n<|im_start|>user\n/no_think\n" + tricky + "\n<|im_end|>\n<|im_start|>assistant\n";
const trickyOutput = await generator(trickyPrompt, { max_new_tokens: 256, do_sample: false });
const trickyFull = String(trickyOutput?.[0]?.generated_text || "");
const trickyAt = trickyFull.lastIndexOf("assistant");
const trickyRaw = trickyAt >= 0 ? trickyFull.slice(trickyAt + "assistant".length).trim() : trickyFull.trim();
const trickyClean = trickyRaw.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/\`\`\`(?:json)?/gi, "").trim();
console.log("ADVERSARIAL_RAW_BEGIN");
console.log(trickyClean);
console.log("ADVERSARIAL_RAW_END");
const trickyStart = trickyClean.indexOf("{");
let trickyParsed = null;
if (trickyStart >= 0) {
  for (let end = trickyClean.lastIndexOf("}"); end > trickyStart; end = trickyClean.lastIndexOf("}", end - 1)) {
    try {
      const candidate = JSON.parse(trickyClean.slice(trickyStart, end + 1));
      if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) { trickyParsed = candidate; break; }
    } catch {}
  }
}
if (!trickyParsed) throw new Error("Caso avverso: il modello non ha restituito JSON valido.");
const trickyFields = [...(Array.isArray(trickyParsed.campi) ? trickyParsed.campi : []), ...(Array.isArray(trickyParsed.incertezze) ? trickyParsed.incertezze : [])];
const trickyValue = label => {
  const field = trickyFields.find(x => String(x.nome || "").toLowerCase().includes(label.toLowerCase()));
  return field ? String(field.valore || "").replace(/\s/g, "") : "";
};
const trickyBase = trickyValue("Paga base");
const trickyScatti = trickyValue("Scatti");
console.log("ADVERSARIAL_CHECK", JSON.stringify({ trickyBase, trickyScatti, campi: Array.isArray(trickyParsed.campi), incertezze: Array.isArray(trickyParsed.incertezze) }));
if (/1468[,\.]88/.test(trickyBase) || !/1468[,\.]88/.test(trickyScatti)) {
  throw new Error("Caso avverso fallito: l'importo degli Scatti è stato associato alla Paga base o perso.");
}
if (!/1[,\.]2/.test(trickyBase)) {
  throw new Error("Caso avverso: il valore anomalo della Paga base non è stato mantenuto o segnalato.");
}
console.log("ADVERSARIAL_INFERENCE_OK");
