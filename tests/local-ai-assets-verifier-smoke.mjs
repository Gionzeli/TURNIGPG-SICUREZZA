import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const verifier = path.join(repoRoot, "tools/verify-local-ai-assets.mjs");
const roles = [
  "pdfjs-browser", "pdfjs-worker",
  "tesseract-browser", "tesseract-worker", "tesseract-core", "tesseract-ita", "tesseract-eng",
  "paddle-wrapper", "paddle-model", "onnxruntime-wasm",
  "transformers-runtime", "qwen-model"
];
const exactPaths = {
  "pdfjs-browser": "vendor/pdfjs/pdf.min.js",
  "pdfjs-worker": "vendor/pdfjs/pdf.worker.min.js",
  "tesseract-browser": "vendor/tesseract/tesseract.min.js",
  "tesseract-worker": "vendor/tesseract/worker.min.js",
  "tesseract-ita": "vendor/tesseract/lang/ita.traineddata.gz",
  "tesseract-eng": "vendor/tesseract/lang/eng.traineddata.gz",
  "paddle-wrapper": "vendor/paddleocr/local-paddleocr.js",
  "transformers-runtime": "vendor/transformers/transformers.min.js",
  "tesseract-core": "vendor/tesseract/core.wasm",
  "paddle-model": "models/paddleocr/pp-ocrv6/model.onnx",
  "onnxruntime-wasm": "vendor/onnxruntime/ort-wasm.wasm",
  "qwen-model": "models/qwen2.5-0.5b-instruct/model.safetensors"
};

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "dsm-local-ai-verifier-"));
  const assets = [];
  for (const role of roles) {
    const assetPath = exactPaths[role];
    const bytes = Buffer.from("synthetic-fixture:" + role);
    const absolute = path.join(root, assetPath);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, bytes);
    assets.push({
      role,
      path: assetPath,
      sizeBytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      version: "fixture-1",
      license: "TEST-ONLY",
      source: "synthetic-fixture"
    });
  }
  return {
    root,
    manifest: { schemaVersion: 1, enabled: true, mode: "bundled-offline", requiredRoles: [...roles], assets }
  };
}

async function check(name, mutate, expectedPass) {
  const f = await fixture();
  try {
    mutate(f.manifest);
    await writeFile(path.join(f.root, "local-ai-assets.json"), JSON.stringify(f.manifest));
    const result = spawnSync(process.execPath, [verifier, "--test-root", f.root], { encoding: "utf8" });
    const passed = result.status === 0;
    if (passed !== expectedPass) {
      throw new Error(name + " — esito inatteso (status " + result.status + "):\n" + result.stdout + result.stderr);
    }
    console.log("PASS — " + name);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
}

await check("fixture sintetica completa accettata", () => {}, true);
await check("requiredRoles alterato rifiutato", m => { m.requiredRoles.pop(); }, false);
await check("ruolo asset duplicato rifiutato", m => { m.assets.push({ ...m.assets[0], path: "vendor/extra/duplicate.js" }); }, false);
await check("ruolo sconosciuto rifiutato", m => { m.assets.push({ ...m.assets[0], role: "unknown-role", path: "vendor/extra/unknown.js" }); }, false);
await check("percorso duplicato rifiutato", m => { m.assets[1].path = m.assets[0].path; }, false);
await check("percorso traversal rifiutato", m => { m.assets[0].path = "vendor/../outside.js"; }, false);
await check("entrypoint non canonico rifiutato", m => { m.assets[0].path = "vendor/pdfjs/other.js"; }, false);
await check("hash errato rifiutato", m => { m.assets[0].sha256 = "0".repeat(64); }, false);
await check("metadati licenza mancanti rifiutati", m => { delete m.assets[0].license; }, false);
await check("ruolo richiesto mancante rifiutato", m => { m.assets.pop(); }, false);
