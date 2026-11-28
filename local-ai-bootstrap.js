const REQUIRED_ROLES = [
  "pdfjs-browser","pdfjs-worker",
  "tesseract-browser","tesseract-worker","tesseract-core","tesseract-ita","tesseract-eng",
  "paddle-wrapper","paddle-model","onnxruntime-wasm",
  "transformers-runtime","qwen-model"
];

const byRole = new Map();
let runtimeModule = null;

function localPath(item) {
  if (!item || typeof item.path !== "string" ||
      !/^(vendor|models)\/[a-zA-Z0-9._/-]+$/.test(item.path) ||
      item.path.split("/").includes("..")) {
    throw new Error("Percorso asset AI non valido.");
  }
  return "./" + item.path;
}

function loadClassicScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = false;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Componente AI locale non caricabile: " + src));
    document.head.append(script);
  });
}

async function bootstrapLocalAI() {
  const response = await fetch("./local-ai-assets.json", {
    cache: "no-store",
    credentials: "same-origin"
  });
  if (!response.ok) throw new Error("Manifest AI locale non disponibile.");
  const manifest = await response.json();
  if (manifest?.schemaVersion !== 1 || typeof manifest.enabled !== "boolean" ||
      !Array.isArray(manifest.assets)) {
    throw new Error("Manifest AI locale non valido.");
  }
  if (!manifest.enabled) {
    window.LocalAIAssets = Object.freeze({ ready: false, reason: "asset-non-distribuiti" });
    return;
  }
  if (!navigator.serviceWorker?.controller) {
    window.LocalAIAssets = Object.freeze({ ready: false, reason: "installazione-offline-da-completare" });
    return;
  }

  for (const item of manifest.assets) {
    if (!item || !item.role || byRole.has(item.role)) {
      throw new Error("Ruolo AI duplicato o non valido.");
    }
    if (!item.version || !item.license || !item.source ||
        !Number.isSafeInteger(item.sizeBytes) || item.sizeBytes < 1 ||
        !/^[a-f0-9]{64}$/i.test(item.sha256 || "")) {
      throw new Error("Provenienza o integrità mancante per " + (item.path || "asset"));
    }
    byRole.set(item.role, item);
  }
  const missing = REQUIRED_ROLES.filter(role => !byRole.has(role));
  if (missing.length) throw new Error("Pacchetto AI incompleto: " + missing.join(", "));

  // Gli script classici espongono le API browser richieste dai lettori.
  await loadClassicScript(localPath(byRole.get("pdfjs-browser")));
  await loadClassicScript(localPath(byRole.get("tesseract-browser")));
  await loadClassicScript(localPath(byRole.get("paddle-wrapper")));

  const transformerUrl = new URL(localPath(byRole.get("transformers-runtime")), location.href);
  runtimeModule = await import(transformerUrl.href);
  if (runtimeModule?.env?.backends?.onnx?.wasm) {
    runtimeModule.env.backends.onnx.wasm.wasmPaths = "./vendor/onnxruntime/";
  }
  runtimeModule.env.allowRemoteModels = false;
  runtimeModule.env.allowLocalModels = true;
  runtimeModule.env.useBrowserCache = true;
  runtimeModule.env.localModelPath = "./models/";

  const loadQwenRuntime = async () => {
    if (!runtimeModule) throw new Error("Runtime Transformers locale non caricato.");
    return { pipeline: runtimeModule.pipeline, env: runtimeModule.env };
  };

  window.LocalAIAssets = Object.freeze({
    ready: true,
    mode: "bundled-offline",
    loadQwenRuntime
  });
}

try {
  await bootstrapLocalAI();
} catch (error) {
  window.LocalAIAssets = Object.freeze({
    ready: false,
    reason: String(error?.message || error).slice(0, 180)
  });
  console.error("Avvio AI locale interrotto:", window.LocalAIAssets.reason);
}
