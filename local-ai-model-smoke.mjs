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
  device: "wasm",
  dtype: "q4"
});
console.log("MODEL_READY");

const messages = [
  {
    role: "system",
    content: "Sei un estrattore documentale. Restituisci un solo oggetto JSON valido, senza Markdown né testo prima o dopo. Schema: {\"tipo_documento\":string,\"lingua\":string,\"azienda\":string|null,\"persona\":string|null,\"periodo\":string|null,\"campi\":[{\"nome\":string,\"valore\":string,\"fonte\":string}],\"incertezze\":[string]}. Non inventare dati. Se un dato manca, usa null o un array vuoto. Conserva importi e date esattamente come appaiono."
  },
  { role: "user", content: "Estrai i dati da questo testo, senza aggiungere informazioni:\\n\\n" + sample }
];
const output = await generator(messages, { max_new_tokens: 384, do_sample: false });
const generated = output?.[0]?.generated_text;
const raw = Array.isArray(generated)
  ? String(generated.at(-1)?.content || "")
  : String(generated || "");
console.log("RAW_OUTPUT_BEGIN");
console.log(raw);
console.log("RAW_OUTPUT_END");

const cleaned = raw.replace(/<think>[\\s\\S]*?<\\/think>/gi, "").trim();
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
const flat = parsed.campi.map(x => `${x.nome || ""}: ${x.valore || ""}`).join("\\n");
const hasBase = /1468[,.]88/.test(flat);
const hasScatti = /84[,.]52/.test(flat);
const hasRetribuzione = /896[,.]19/.test(flat);
const hasFerie = /657[,.]21/.test(flat);
console.log("QUALITY_CHECK", JSON.stringify({ hasBase, hasScatti, hasRetribuzione, hasFerie, fieldCount: parsed.campi.length }));
console.log("STRUCTURED_INFERENCE_OK");
