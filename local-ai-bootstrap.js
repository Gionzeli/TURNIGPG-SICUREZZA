const REQUIRED_ROLES = [
  "pdfjs-browser","pdfjs-worker",
  "tesseract-browser","tesseract-worker","tesseract-core","tesseract-ita","tesseract-eng",
  "paddle-wrapper","paddle-model","onnxruntime-wasm",
  "transformers-runtime","qwen-model"
];

const byRole = new Map();
const knownRoles = new Set(REQUIRED_ROLES);
const EXPECTED_ENTRYPOINTS = {
  "pdfjs-browser": "vendor/pdfjs/pdf.min.js",
  "pdfjs-worker": "vendor/pdfjs/pdf.worker.min.js",
  "tesseract-browser": "vendor/tesseract/tesseract.min.js",
  "tesseract-worker": "vendor/tesseract/worker.min.js",
  "tesseract-ita": "vendor/tesseract/lang/ita.traineddata.gz",
  "tesseract-eng": "vendor/tesseract/lang/eng.traineddata.gz",
  "paddle-wrapper": "vendor/paddleocr/local-paddleocr.js",
  "transformers-runtime": "vendor/transformers/transformers.min.js"
};
let runtimeModule = null;

function localPath(item) {
  if (!item || typeof item.path !== "string" ||
      !/^(vendor|models)\/[a-zA-Z0-9._/-]+$/.test(item.path) ||
      item.path.split("/").some(segment => !segment || segment === "." || segment === "..")) {
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

  const seenPaths = new Set();
  for (const item of manifest.assets) {
    if (!item || typeof item.role !== "string" || !knownRoles.has(item.role)) {
      throw new Error("Ruolo AI sconosciuto o non valido.");
    }
    const path = localPath(item);
    if (seenPaths.has(item.path)) throw new Error("Percorso AI duplicato: " + item.path);
    seenPaths.add(item.path);
    if (EXPECTED_ENTRYPOINTS[item.role] && item.path !== EXPECTED_ENTRYPOINTS[item.role]) {
      throw new Error("Percorso entrypoint inatteso per " + item.role);
    }
    if ((item.role === "tesseract-core" && !item.path.startsWith("vendor/tesseract/")) ||
        (item.role === "paddle-model" && !item.path.startsWith("models/paddleocr/pp-ocrv6/")) ||
        (item.role === "onnxruntime-wasm" && !item.path.startsWith("vendor/onnxruntime/")) ||
        (item.role === "qwen-model" && !item.path.startsWith("models/qwen2.5-0.5b-instruct/"))) {
      throw new Error("Percorso fuori directory per " + item.role);
    }
    const url = new URL(path, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith(new URL("./", location.href).pathname)) {
      throw new Error("Asset AI fuori dall'origine/percorso dell'app.");
    }
    if (!byRole.has(item.role)) byRole.set(item.role, []);
    byRole.get(item.role).push(item);
    if (typeof item.version !== "string" || !item.version.trim() ||
        typeof item.license !== "string" || !item.license.trim() ||
        typeof item.source !== "string" || !item.source.trim() ||
        !Number.isSafeInteger(item.sizeBytes) || item.sizeBytes < 1 ||
        !/^[a-f0-9]{64}$/i.test(item.sha256 || "")) {
      throw new Error("Provenienza o integrità mancante per " + (item.path || "asset"));
    }
  }
  const missing = REQUIRED_ROLES.filter(role => !byRole.get(role)?.length);
  if (missing.length) throw new Error("Pacchetto AI incompleto: " + missing.join(", "));
  const first = role => byRole.get(role)[0];
  for (const [role, expectedPath] of Object.entries(EXPECTED_ENTRYPOINTS)) {
    if (!byRole.get(role).some(item => item.path === expectedPath)) {
      throw new Error("Percorso asset non coerente per " + role + ": atteso " + expectedPath);
    }
  }
  if (!byRole.get("paddle-model").every(item => item.path.startsWith("models/paddleocr/pp-ocrv6/")) ||
      !byRole.get("onnxruntime-wasm").every(item => item.path.startsWith("vendor/onnxruntime/")) ||
      !byRole.get("tesseract-core").every(item => item.path.startsWith("vendor/tesseract/")) ||
      !byRole.get("transformers-runtime").some(item => item.path === "vendor/transformers/transformers.min.js") ||
      !byRole.get("qwen-model").every(item => item.path.startsWith("models/qwen2.5-0.5b-instruct/"))) {
    throw new Error("Percorsi di modello/runtime non coerenti con il contratto offline.");
  }

  // Gli script classici espongono le API browser richieste dai lettori.
  await loadClassicScript(localPath(first("pdfjs-browser")));
  await loadClassicScript(localPath(first("tesseract-browser")));
  await loadClassicScript(localPath(first("paddle-wrapper")));

  const transformerUrl = new URL(localPath(first("transformers-runtime")), location.href);
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
