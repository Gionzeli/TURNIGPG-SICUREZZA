import { createHash } from "node:crypto";
import { readFile, lstat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "local-ai-assets.json");
const requiredRoles = [
  "pdfjs-browser", "pdfjs-worker",
  "tesseract-browser", "tesseract-worker", "tesseract-core", "tesseract-ita", "tesseract-eng",
  "paddle-wrapper", "paddle-model", "onnxruntime-wasm",
  "transformers-runtime", "qwen-model"
];
const requireReady = process.argv.includes("--require-ready");
const exactPaths = {
  "pdfjs-browser": "vendor/pdfjs/pdf.min.js",
  "pdfjs-worker": "vendor/pdfjs/pdf.worker.min.js",
  "tesseract-browser": "vendor/tesseract/tesseract.min.js",
  "tesseract-worker": "vendor/tesseract/worker.min.js",
  "tesseract-ita": "vendor/tesseract/lang/ita.traineddata.gz",
  "tesseract-eng": "vendor/tesseract/lang/eng.traineddata.gz",
  "paddle-wrapper": "vendor/paddleocr/local-paddleocr.js",
  "transformers-runtime": "vendor/transformers/transformers.min.js"
};

function fail(message) {
  console.error("ERRORE PACCHETTO AI LOCALE:", message);
  process.exitCode = 1;
}

let manifest;
try {
  manifest = JSON.parse(await readFile(manifestPath, "utf8"));
} catch (error) {
  fail("local-ai-assets.json non leggibile: " + error.message);
  process.exit();
}

if (manifest.schemaVersion !== 1 || typeof manifest.enabled !== "boolean" || !Array.isArray(manifest.assets)) {
  fail("schema manifest non valido");
  process.exit();
}
if (!manifest.enabled) {
  console.log("AI LOCALE NON DISTRIBUITA: il manifest è disabilitato; nessun asset verrà scaricato all'avvio.");
  if (requireReady) fail("release bloccata: asset locali non ancora confezionati");
  process.exit();
}

const seenRoles = new Set();
const seenPaths = new Set();
for (const item of manifest.assets) {
  if (!item || typeof item.role !== "string" || typeof item.path !== "string") {
    fail("voce asset incompleta");
    continue;
  }
  if (!/^(vendor|models)\/[a-zA-Z0-9._/-]+$/.test(item.path) ||
      item.path.split("/").some(segment => !segment || segment === "." || segment === "..")) {
    fail("percorso non consentito: " + item.path);
    continue;
  }
  if (seenPaths.has(item.path)) {
    fail("percorso duplicato: " + item.path);
    continue;
  }
  seenPaths.add(item.path);
  seenRoles.add(item.role);
  if (exactPaths[item.role] && item.path !== exactPaths[item.role]) {
    fail("percorso inatteso per " + item.role + ": " + item.path);
  }
  if (item.role === "tesseract-core" && !item.path.startsWith("vendor/tesseract/")) fail("core Tesseract fuori directory");
  if (item.role === "paddle-model" && !item.path.startsWith("models/paddleocr/pp-ocrv6/")) fail("modello PaddleOCR fuori directory");
  if (item.role === "onnxruntime-wasm" && !item.path.startsWith("vendor/onnxruntime/")) fail("ONNX Runtime fuori directory");
  if (item.role === "qwen-model" && !item.path.startsWith("models/qwen2.5-0.5b-instruct/")) fail("modello Qwen fuori directory");
  if (!Number.isSafeInteger(item.sizeBytes) || item.sizeBytes < 1 ||
      !/^[a-f0-9]{64}$/i.test(item.sha256 || "") ||
      typeof item.version !== "string" || !item.version.trim() ||
      typeof item.license !== "string" || !item.license.trim() ||
      typeof item.source !== "string" || !item.source.trim()) {
    fail("metadati/versione/licenza/origine/hash mancanti: " + item.path);
    continue;
  }
  const absolute = path.resolve(root, item.path);
  if (!absolute.startsWith(root + path.sep)) {
    fail("percorso fuori dal progetto: " + item.path);
    continue;
  }
  try {
    const fileStat = await lstat(absolute);
    if (fileStat.isSymbolicLink() || !fileStat.isFile() || fileStat.size !== item.sizeBytes) {
      fail("dimensione o tipo file errato: " + item.path);
      continue;
    }
    const bytes = await readFile(absolute);
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest.toLowerCase() !== item.sha256.toLowerCase()) {
      fail("SHA-256 errato: " + item.path);
    }
  } catch {
    fail("asset mancante: " + item.path);
  }
}
const missing = requiredRoles.filter(role => !seenRoles.has(role));
if (missing.length) fail("ruoli mancanti: " + missing.join(", "));
if (!process.exitCode) console.log("PASS: tutti gli asset AI locali hanno versione, licenza, origine, dimensione e SHA-256 verificati.");
