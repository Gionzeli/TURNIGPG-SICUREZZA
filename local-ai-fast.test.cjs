const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("local-reader.js", "utf8");
const sandbox = { window: {}, console, setTimeout, clearTimeout };
vm.runInNewContext(source, sandbox, { filename: "local-reader.js" });
const reader = sandbox.window.LocalDocAI;
assert.equal(typeof reader.parsePayslip, "function");

const fields = [["paga_base"], ["scatti"]];
const sample = `Paga base
1.468,88000
Scatti
84,52000
1.553,40000`;
const result = reader.parsePayslip(sample, fields);
assert.equal(result.paga_base, 1468.88);
assert.equal(result.scatti, 84.52);

const malformed = reader.parsePayslip("Paga base 1,2\nScatti 1468,88", fields);
assert.equal(malformed.paga_base, undefined);
assert.equal(malformed.scatti, 1468.88);

console.log("OK: lettura rapida locale di Paga base e Scatti su righe separate; valore base incompleto rifiutato.");
