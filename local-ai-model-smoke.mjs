import { pipeline, env } from "@huggingface/transformers";
import { StructuredOutputProcessor } from "@huggingface/transformers-structured-output";
// Test sperimentale: generazione vincolata allo schema JSON, oltre alla verifica dei valori.

const MODEL_ID = "onnx-community/Qwen3-1.7B-ONNX";
const REVISION = "e1da89f753284b95bd0971c64524f52edc5eb6e3";
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

const outputSchema = {
  type: "object",
  properties: {
    tipo_documento: { type: "string" },
    campi: {
      type: "array",
      items: {
        type: "object",
        properties: { nome: { type: "string" }, valore: { type: "string" } },
        required: ["nome", "valore"],
        additionalProperties: false
      }
    },
    incertezze: {
      type: "array",
      items: {
        type: "object",
        properties: { nome: { type: "string" }, valore: { type: "string" } },
        required: ["nome", "valore"],
        additionalProperties: false
      }
    }
  },
  required: ["tipo_documento", "campi", "incertezze"],
  additionalProperties: false
};
const generateStructured = (prompt, max_new_tokens) => {
  const processor = new StructuredOutputProcessor(generator.tokenizer, {
    type: "json_schema",
    json_schema: outputSchema
  });
  return generator(prompt, {
    max_new_tokens,
    do_sample: false,
    logits_processor: [processor]
  });
};

const prompt = "<|im_start|>system\nSei un estrattore di cedolini. Restituisci solo JSON valido con questa forma: {\"tipo_documento\":\"cedolino\",\"campi\":[{\"nome\":\"Paga base\",\"valore\":\"importo\"}],\"incertezze\":[]}. Estrai ogni voce e il suo importo esattamente come appare. Non copiare i valori dell'esempio. Distingui Paga base, Scatti, Retribuzione e Ferie godute. Non inventare né chiedere conferma.\n<|im_end|>\n<|im_start|>user\n/no_think\n" + sample + "\n<|im_end|>\n<|im_start|>assistant\n";
const output = await generateStructured(prompt, 384);
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
const trickyOutput = await generateStructured(trickyPrompt, 256);
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

// Secondo cedolino sintetico: etichette estese, ordine diverso e importi differenti.
const variant = `PROSPETTO RETRIBUTIVO - NOVEMBRE 2026
SCATTI DI ANZIANITA' EUR 92,15
FERIE GODUTE 4,000 GG EUR 238,98
PAGA BASE CONTRATTUALE EUR 1.512,40
RETRIBUZIONE ORDINARIA 10,000 GG EUR 568,20`;
const variantPrompt = "<|im_start|>system\nEstrai con precisione quattro associazioni. Restituisci solo JSON valido, senza Markdown. Usa questi nomi di campo: PAGA BASE CONTRATTUALE, SCATTI DI ANZIANITA, FERIE GODUTE, RETRIBUZIONE ORDINARIA. Copia per ciascuno l'importo che compare sulla stessa riga. Non inventare e non scambiare gli importi. Struttura: {\"tipo_documento\":\"cedolino\",\"campi\":[{\"nome\":\"etichetta\",\"valore\":\"importo\"}],\"incertezze\":[]}.\n<|im_end|>\n<|im_start|>user\n/no_think\n" + variant + "\n<|im_end|>\n<|im_start|>assistant\n";
console.log("VARIANT_START");
const variantOutput = await generateStructured(variantPrompt, 512);
const variantFull = String(variantOutput?.[0]?.generated_text || "");
const variantAt = variantFull.lastIndexOf("assistant");
const variantRaw = variantAt >= 0 ? variantFull.slice(variantAt + "assistant".length).trim() : variantFull.trim();
const variantClean = variantRaw.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/```(?:json)?/gi, "").trim();
let variantParsed = null;
const variantStart = variantClean.indexOf("{");
if (variantStart >= 0) {
  for (let end = variantClean.lastIndexOf("}"); end > variantStart; end = variantClean.lastIndexOf("}", end - 1)) {
    try {
      const candidate = JSON.parse(variantClean.slice(variantStart, end + 1));
      if (candidate && (Array.isArray(candidate.campi) || Array.isArray(candidate.incertezze))) { variantParsed = candidate; break; }
    } catch {}
  }
}
console.log("VARIANT_RAW_BEGIN");
console.log(variantRaw || "(nessun testo generato)");
console.log("VARIANT_RAW_END");
if (!variantParsed) {
  const retryPrompt = "<|im_start|>system\nRestituisci soltanto un oggetto JSON valido con campi e incertezze. Copia le etichette e gli importi esattamente dalle righe; non aggiungere spiegazioni.\n<|im_end|>\n<|im_start|>user\n" + variant + "\n<|im_end|>\n<|im_start|>assistant\n";
  console.log("VARIANT_RETRY_START");
  const retryOutput = await generateStructured(retryPrompt, 512);
  const retryFull = String(retryOutput?.[0]?.generated_text || "");
  const retryAt = retryFull.lastIndexOf("assistant");
  const retryRaw = retryAt >= 0 ? retryFull.slice(retryAt + "assistant".length).trim() : retryFull.trim();
  const retryClean = retryRaw.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/```(?:json)?/gi, "").trim();
  console.log("VARIANT_RETRY_RAW_BEGIN");
  console.log(retryRaw || "(nessun testo generato)");
  console.log("VARIANT_RETRY_RAW_END");
  const retryStart = retryClean.indexOf("{");
  if (retryStart >= 0) {
    for (let end = retryClean.lastIndexOf("}"); end > retryStart; end = retryClean.lastIndexOf("}", end - 1)) {
      try {
        const candidate = JSON.parse(retryClean.slice(retryStart, end + 1));
        if (candidate && (Array.isArray(candidate.campi) || Array.isArray(candidate.incertezze))) { variantParsed = candidate; break; }
      } catch {}
    }
  }
}
if (!variantParsed) throw new Error("Secondo cedolino: il modello non ha prodotto JSON strutturato neppure al secondo tentativo.");
const variantFields = [
  ...(Array.isArray(variantParsed.campi) ? variantParsed.campi : []),
  ...(Array.isArray(variantParsed.incertezze) ? variantParsed.incertezze : [])
];
const variantValue = (label, pattern) => {
  const field = variantFields.find(x => String(x.nome || "").toLowerCase().includes(label.toLowerCase()));
  return field && pattern.test(String(field.valore || ""));
};
const variantChecks = {
  base: variantValue("PAGA BASE", /1\.512,40/),
  scatti: variantValue("SCATTI", /92,15/),
  ferie: variantValue("FERIE", /238,98/),
  retribuzione: variantValue("RETRIBUZIONE", /568,20/)
};
console.log("VARIANT_CHECK", JSON.stringify(variantChecks));
if (Object.values(variantChecks).some(ok => !ok)) throw new Error("Secondo cedolino: estrazione o associazione errata: " + JSON.stringify(variantChecks));
console.log("VARIANT_INFERENCE_OK");

