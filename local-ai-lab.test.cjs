/* Controlli statici del laboratorio browser. Esegui con Node 20+. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync("local-ai-lab.html", "utf8");
const worker = fs.readFileSync("local-ai-worker.js", "utf8");
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gi)];
assert.equal(scripts.length, 1, "deve esserci un solo script inline nel laboratorio");
new vm.Script(scripts[0][1], { filename: "local-ai-lab.inline.js" });
new vm.Script(worker, { filename: "local-ai-worker.js" });
assert.match(html, /new Worker\("\.\/local-ai-worker\.js", \{ type: "module" \}\)/);
assert.match(html, /Ho capito che il download può essere grande/);
assert.match(html, /nessun testo inserito viene inviato/i);
assert.match(worker, /onnx-community\/Qwen3-0\.6B-Instruct-ONNX/);
assert.match(worker, /device:\s*"wasm"/);
assert.match(worker, /dtype:\s*"q4"/);
assert.match(worker, /data\.type === "analyze"/);
assert.doesNotMatch(worker, /fetch\s*\(.*text/i);
console.log("OK: script del laboratorio e worker validi; modello avviato solo con messaggio esplicito; backend WASM quantizzato.");
