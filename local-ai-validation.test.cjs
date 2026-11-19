const assert = require("node:assert/strict");
const { verify } = require("./local-ai-validation.js");

const ordinary = `Paga base: 1.468,88
Scatti: 84,52
Retribuzione: 896,19 per 15 giorni
Ferie godute: 657,21 per 11 giorni`;
const ordinaryAI = { campi: [
  { nome: "Paga base", valore: "1.468,88" },
  { nome: "Scatti", valore: "84,52" },
  { nome: "Retribuzione", valore: "896,19" },
  { nome: "Ferie godute", valore: "657,21" }
]};
const ordinaryResult = verify(ordinary, ordinaryAI);
assert.deepEqual(ordinaryResult.accepted, {
  paga_base: "1.468,88", scatti: "84,52",
  retribuzione: "896,19", ferie_godute: "657,21"
});
assert.equal(ordinaryResult.complete, true);

const adversarial = `Paga base: 1,2
Scatti: 1468,88`;
const adversarialResult = verify(adversarial, { campi: [
  { nome: "Paga base", valore: "1468,88" },
  { nome: "Scatti", valore: "1468,88" }
]});
assert.equal(adversarialResult.accepted.paga_base, undefined);
assert.equal(adversarialResult.accepted.scatti, "1468,88");
assert.equal(adversarialResult.complete, false);

const reordered = `SCATTI DI ANZIANITA' EUR 92,15
FERIE GODUTE 4,000 GG EUR 238,98
PAGA BASE CONTRATTUALE EUR 1.512,40
RETRIBUZIONE ORDINARIA 10,000 GG EUR 568,20`;
const reorderedResult = verify(reordered, { campi: [
  { nome: "Paga base contrattuale", valore: "1.512,40" },
  { nome: "Scatti di anzianita", valore: "92,15" },
  { nome: "Ferie godute", valore: "238,98" },
  { nome: "Retribuzione ordinaria", valore: "568,20" }
]});
assert.deepEqual(reorderedResult.accepted, {
  paga_base: "1.512,40", scatti: "92,15",
  ferie_godute: "238,98", retribuzione: "568,20"
});
assert.equal(reorderedResult.complete, true);

const wrongCrossAssociation = verify(reordered, { campi: [
  { nome: "Paga base", valore: "92,15" },
  { nome: "Scatti", valore: "1.512,40" }
]});
assert.equal(wrongCrossAssociation.accepted.paga_base, undefined);
assert.equal(wrongCrossAssociation.accepted.scatti, undefined);
assert.equal(wrongCrossAssociation.complete, false);

console.log("OK: validazione ancorata alla riga sorgente; importi incrociati e incompleti rifiutati.");
