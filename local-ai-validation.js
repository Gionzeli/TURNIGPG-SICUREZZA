/* Verifica locale delle associazioni AI contro il testo sorgente.
 * Nessuna rete, OCR, persistenza o modifica ai dati dell'app.
 */
(function (root) {
  "use strict";
  const FIELD_ALIASES = {
    paga_base: ["paga base", "paga base contrattuale", "minimo tabellare"],
    scatti: ["scatti", "scatti di anzianita", "scatti anzianita"],
    retribuzione: ["retribuzione", "retribuzione ordinaria"],
    ferie_godute: ["ferie godute", "ferie fruite"]
  };
  function normalize(value) {
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }
  function amountTokens(line) {
    const pattern = /\b[0-9]{1,3}(?:\.[0-9]{3})*,[0-9]{2,5}\b|\b[0-9]+,[0-9]{2,5}\b/g;
    const currency = [...line.matchAll(/(?:€|\bEUR\b)\s*([0-9]{1,3}(?:\.[0-9]{3})*,[0-9]{2,5}|[0-9]+,[0-9]{2,5})/gi)].map(m => m[1]);
    return currency.length ? currency : [...line.matchAll(pattern)].map(m => m[0]);
  }
  function aliasForLine(line) {
    const normalized = normalize(line);
    const matches = [];
    for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
      if (aliases.some(alias => normalized.includes(normalize(alias)))) matches.push(field);
    }
    return matches.length === 1 ? matches[0] : null;
  }
  function sourceAmounts(lines, index, field) {
    const sameLine = amountTokens(lines[index]);
    if (sameLine.length) return sameLine;
    // Alcuni cedolini stampano l'etichetta e l'importo su due righe distinte.
    // Accetta solo la riga immediatamente successiva, se contiene un unico importo
    // e non introduce una nuova voce: non attraversa mai un'altra etichetta.
    const next = lines[index + 1];
    if (next && !aliasForLine(next)) {
      const nextAmounts = amountTokens(next);
      if (nextAmounts.length === 1) return nextAmounts;
    }
    return [];
  }
  function numericValue(value) {
    let text = String(value || "").replace(/\\s/g, "");
    if (text.includes(",")) text = text.replace(/\\./g, "").replace(",", ".");
    const number = Number(text);
    return Number.isFinite(number) ? number : null;
  }
  function verify(sourceText, aiResult) {
    const lines = String(sourceText || "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const aiFields = Array.isArray(aiResult && aiResult.campi) ? aiResult.campi : [];
    const accepted = {}, uncertainties = [], seen = new Set();
    for (const item of aiFields) {
      const fieldName = normalize(item && item.nome);
      const field = Object.keys(FIELD_ALIASES).find(key =>
        FIELD_ALIASES[key].some(alias => normalize(alias) === fieldName));
      if (!field) {
        uncertainties.push({ nome: String(item && item.nome || "Voce sconosciuta"), motivo: "Etichetta non riconosciuta" });
        continue;
      }
      if (seen.has(field)) {
        uncertainties.push({ nome: field, motivo: "Voce duplicata nell'output AI" });
        delete accepted[field];
        continue;
      }
      seen.add(field);
      const matching = [];
      lines.forEach((line, index) => { if (aliasForLine(line) === field) matching.push(index); });
      if (matching.length !== 1) {
        uncertainties.push({ nome: field, motivo: matching.length ? "Etichetta presente in più righe" : "Etichetta non trovata nel testo originale" });
        continue;
      }
      const candidate = String(item && item.valore || "").replace(/\s/g, "");
      const tokens = sourceAmounts(lines, matching[0], field).map(value => value.replace(/\s/g, ""));
      const candidateNumber = numericValue(candidate);
      const matched = !!candidate && tokens.some(token => {
        const sourceNumber = numericValue(token);
        return sourceNumber !== null && candidateNumber !== null &&
          Math.abs(sourceNumber - candidateNumber) < 0.000001;
      });
      if (!matched) {
        uncertainties.push({ nome: field, motivo: "Importo AI non confermato accanto all'etichetta nel testo originale" });
        continue;
      }
      if ((field === "paga_base" || field === "scatti") &&
          (!/[,.][0-9]{2,5}$/.test(candidate) || !tokens.some(token => /[,.][0-9]{2,5}$/.test(token)))) {
        uncertainties.push({ nome: field, motivo: "Importo incompleto: servono almeno due cifre decimali" });
        continue;
      }
      accepted[field] = candidate;
    }
    return { accepted, uncertainties, complete: uncertainties.length === 0 && aiFields.length > 0 };
  }
  const api = { verify, FIELD_ALIASES };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LocalAIVerifier = api;
})(typeof self !== "undefined" ? self : globalThis);
