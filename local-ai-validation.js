/* Verifica locale delle associazioni AI: un valore è accettato solo se compare
 * nella stessa riga del documento sorgente della relativa etichetta.
 * Non effettua rete, OCR, salvataggi o modifiche ai dati dell'app.
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
    return String(value || "")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  function amountTokens(line) {
    const currency = [...line.matchAll(/(?:€|\bEUR\b)\s*([0-9]{1,3}(?:\.[0-9]{3})*,[0-9]{2,5}|[0-9]+,[0-9]{2,5})/gi)]
      .map(match => match[1]);
    if (currency.length) return currency;
    return [...line.matchAll(/\b[0-9]+(?:\.[0-9]{3})*,[0-9]{2,5}\b|\b[0-9]+,[0-9]{2,5}\b/g)]
      .map(match => match[0]);
  }

  function aliasForLine(line) {
    const normalized = normalize(line);
    const matches = [];
    for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
      if (aliases.some(alias => normalized.includes(normalize(alias)))) matches.push(field);
    }
    return matches.length === 1 ? matches[0] : null;
  }

  function verify(sourceText, aiResult) {
    const lines = String(sourceText || "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const aiFields = Array.isArray(aiResult && aiResult.campi) ? aiResult.campi : [];
    const accepted = {};
    const uncertainties = [];
    const seen = new Set();

    for (const item of aiFields) {
      const fieldName = normalize(item && item.nome);
      const field = Object.keys(FIELD_ALIASES).find(key =>
        FIELD_ALIASES[key].some(alias => normalize(alias) === fieldName)
      );
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

      const candidate = String(item && item.valore || "").replace(/\s/g, "");
      const matchingLines = lines.filter(line => aliasForLine(line) === field);
      if (matchingLines.length !== 1) {
        uncertainties.push({ nome: field, motivo: matchingLines.length ? "Etichetta presente in più righe" : "Etichetta non trovata nel testo originale" });
        continue;
      }
      const tokens = amountTokens(matchingLines[0]).map(value => value.replace(/\s/g, ""));
      if (!candidate || !tokens.includes(candidate)) {
        uncertainties.push({ nome: field, motivo: "Importo AI non confermato nella stessa riga dell'etichetta" });
        continue;
      }
      if ((field === "paga_base" || field === "scatti") && !/[,.][0-9]{2}$/.test(candidate)) {
        uncertainties.push({ nome: field, motivo: "Importo incompleto: servono almeno due cifre decimali" });
        continue;
      }
      accepted[field] = candidate;
    }

    return { accepted, uncertainties, complete: uncertainties.length === 0 };
  }

  const api = { verify, FIELD_ALIASES };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LocalAIVerifier = api;
})(typeof self !== "undefined" ? self : globalThis);
