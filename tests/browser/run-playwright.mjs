import { chromium } from "playwright";
import assert from "node:assert/strict";

const browser = await chromium.launch({ headless: true });
let pageErrors = [];
try {
  const page = await browser.newPage();
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto("http://127.0.0.1:8000/tests/browser/", { waitUntil: "load" });
  await page.waitForFunction(() => {
    const summary = document.querySelector("#summary");
    return summary?.dataset.result === "pass" || summary?.dataset.result === "fail";
  }, null, { timeout: 30000 });

  const result = await page.locator("#summary").textContent();
  const status = await page.locator("#summary").getAttribute("data-result");
  const rows = await page.locator("#results li").allTextContents();
  console.log(result);
  for (const row of rows) console.log(row);
  if (pageErrors.length) {
    console.error("Browser page errors:", pageErrors);
    process.exitCode = 1;
  }
  if (status !== "pass") process.exitCode = 1;

  const reportPage = await browser.newPage();
  const reportErrors = [];
  const requestedUrls = [];
  reportPage.on("pageerror", error => reportErrors.push(error.message));
  reportPage.on("request", request => requestedUrls.push(request.url()));
  await reportPage.goto("http://127.0.0.1:8000/tools/legacy-report.html", { waitUntil: "load" });
  const exportOne = {
    app: "Turni Gpg/sicurezza online", params: { "PRIVATE-PARAMETER-NAME-DO-NOT-LEAK": 42 }, profile: {},
    shifts: [
      { id: "shift-private-test", date: "2026-11-10", type: "turno", post: "POSTO-PRIVATO-TEST", start_time: "08:00", end_time: "16:00", hours: 8, "PRIVATE-FIELD-NAME-DO-NOT-LEAK": "private-value" },
      { id: "bad-date", date: "2026-02-30", type: "turno", hours: 8 }
    ],
    extra: { tpl: [{ type: "turno", st: "99:99", en: "16:00" }], skills: [{}], "PRIVATE-EXTRA-KEY-DO-NOT-LEAK": "private-value", real: { "PRIVATE-MONTH-NAME-DO-NOT-LEAK": "invalid" } }
  };
  const exportTwo = {
    app: "Turni Gpg/sicurezza online", params: {}, profile: {}, shifts: [], extra: {}
  };
  await reportPage.locator("#files").setInputFiles([
    { name: "export-principale.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(exportOne)) },
    { name: "export-secondario.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(exportTwo)) }
  ]);
  await reportPage.locator("#analyze").click();
  await reportPage.locator("#report").waitFor({ state: "visible" });
  assert.match(await reportPage.locator("#readiness").textContent(), /Revisione necessaria/);
  assert.doesNotMatch(await reportPage.locator("#quarantine").textContent(), /POSTO-PRIVATO-TEST/);
  assert.doesNotMatch(await reportPage.locator("#conflicts").textContent(), /PRIVATE-EXTRA-KEY-DO-NOT-LEAK/);
  assert.doesNotMatch(await reportPage.locator("#warnings").textContent(), /PRIVATE-EXTRA-KEY-DO-NOT-LEAK|PRIVATE-PARAMETER-NAME-DO-NOT-LEAK|PRIVATE-MONTH-NAME-DO-NOT-LEAK/);
  assert.doesNotMatch(await reportPage.locator("#conflicts").textContent(), /PRIVATE-PARAMETER-NAME-DO-NOT-LEAK/);
  assert.match(await reportPage.locator("#quarantine").textContent(), /Turno/);
  assert.match(await reportPage.locator("#quarantine").textContent(), /Modello/);
  assert.match(await reportPage.locator("#quarantine").textContent(), /Formazione/);
  assert.equal(reportErrors.length, 0, reportErrors.join("; "));
  assert.ok(requestedUrls.every(url => url.startsWith("http://127.0.0.1:8000/")), "Lo strumento ha effettuato richieste esterne.");

  const downloadPromise = reportPage.waitForEvent("download");
  await reportPage.locator("#download").click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const downloadedReport = Buffer.concat(chunks).toString("utf8");
  assert.ok(downloadedReport.includes('"automaticImportAllowed": false'));
  assert.ok(!downloadedReport.includes("POSTO-PRIVATO-TEST"), "Il rapporto scaricato espone dati dei turni.");
  assert.ok(!downloadedReport.includes("shift-private-test"), "Il rapporto scaricato espone ID legacy.");
  assert.ok(!downloadedReport.includes("PRIVATE-FIELD-NAME-DO-NOT-LEAK"), "Il rapporto scaricato espone nomi di campi non mappati.");
  assert.ok(!downloadedReport.includes("PRIVATE-EXTRA-KEY-DO-NOT-LEAK"), "Il rapporto scaricato espone chiavi extra non mappate.");
  assert.ok(!downloadedReport.includes("PRIVATE-PARAMETER-NAME-DO-NOT-LEAK"), "Il rapporto scaricato espone parametri non mappati.");
  assert.ok(!downloadedReport.includes("PRIVATE-MONTH-NAME-DO-NOT-LEAK"), "Il rapporto scaricato espone nomi di valori mensili non validi.");
  assert.ok(!downloadedReport.includes("private-value"), "Il rapporto scaricato espone valori privati.");
  await reportPage.locator("#files").setInputFiles([{
    name: "export-singolo.json", mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({
      app: "Turni Gpg/sicurezza online", params: {}, profile: {},
      shifts: [{ date: "2026-11-10", type: "turno", hours: 8 }], extra: {}
    }))
  }]);
  await reportPage.locator("#analyze").click();
  await reportPage.locator("#report").waitFor({ state: "visible" });
  assert.equal(await reportPage.locator("#private-preview").isVisible(), true,
    "L'anteprima privata non è visibile.");
  assert.equal(await reportPage.locator("#profile-preview").isVisible(), true,
    "L'anteprima del profilo non è visibile.");
  assert.equal(await reportPage.locator("#params-preview").isVisible(), true,
    "L'anteprima dei parametri non è visibile.");
  assert.match(await reportPage.locator("#totals").textContent(), /Turni validi esaminati: 1/);
  assert.match(await reportPage.locator("#readiness").textContent(), /Nessun conflitto rilevato/);
  assert.equal(reportErrors.length, 0, reportErrors.join("; "));
  
  // Invalid JSON must fail closed without rendering parser details or raw payload.
  await reportPage.locator("#files").setInputFiles([{
    name: "invalid.json", mimeType: "application/json", buffer: Buffer.from('{"private-marker":"DO-NOT-LEAK",')
  }]);
  await reportPage.locator("#analyze").click();
  assert.equal(await reportPage.locator("#report").isVisible(), false);
  await reportPage.waitForFunction(() =>
    document.querySelector("#error")?.textContent.includes("JSON non valido o struttura non conforme")
  );
  assert.match(await reportPage.locator("#error").textContent(), /JSON non valido o struttura non conforme/);
  assert.doesNotMatch(await reportPage.locator("#error").textContent(), /DO-NOT-LEAK/);

  // User filenames (which may contain personal data) never enter the report.
  await reportPage.locator("#files").setInputFiles([
    { name: "PERSONAL-FILENAME-DO-NOT-LEAK.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ params: {}, profile: {}, shifts: [] })) },
    { name: "PERSONAL-FILENAME-DO-NOT-LEAK.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ params: {}, profile: {}, shifts: [] })) }
  ]);
  await reportPage.locator("#analyze").click();
  await reportPage.locator("#report").waitFor({ state: "visible" });
  const genericLabels = await reportPage.locator("#sources").textContent();
  assert.match(genericLabels, /Export 1/);
  assert.match(genericLabels, /Export 2/);
  assert.doesNotMatch(genericLabels, /PERSONAL-FILENAME-DO-NOT-LEAK/);
  const genericDownloadPromise = reportPage.waitForEvent("download");
  await reportPage.locator("#download").click();
  const genericDownload = await genericDownloadPromise;
  const genericStream = await genericDownload.createReadStream();
  const genericChunks = [];
  for await (const chunk of genericStream) genericChunks.push(chunk);
  assert.doesNotMatch(Buffer.concat(genericChunks).toString("utf8"), /PERSONAL-FILENAME-DO-NOT-LEAK/);

  // The UI blocks more than 100 files and files larger than 10 MiB before analysis.
  await reportPage.locator("#files").setInputFiles(Array.from({ length: 101 }, (_, index) => ({
    name: `limite-${index}.json`, mimeType: "application/json", buffer: Buffer.from("{}")
  })));
  assert.equal(await reportPage.locator("#analyze").isDisabled(), true);
  assert.match(await reportPage.locator("#status").textContent(), /massimo 100 file/);
  await reportPage.locator("#files").setInputFiles([{
    name: "troppo-grande.json", mimeType: "application/json",
    buffer: Buffer.alloc(10 * 1024 * 1024 + 1, 32)
  }]);
  assert.equal(await reportPage.locator("#analyze").isDisabled(), true);
  assert.match(await reportPage.locator("#status").textContent(), /supera il limite di 10 MB/);

  const historyPage = await browser.newPage();
  const historyErrors = [];
  const historyRequests = [];
  historyPage.on("pageerror", error => historyErrors.push(error.message));
  historyPage.on("request", request => historyRequests.push(request.url()));
  await historyPage.goto("http://127.0.0.1:8000/tests/browser/history-preview.html", { waitUntil: "load" });
  await historyPage.waitForFunction(() => document.documentElement.dataset.previewResult === "pass" ||
    document.documentElement.dataset.previewResult === "fail");
  assert.equal(await historyPage.locator("#history-events .dsm-history-item").count(), 3,
    "La prima pagina deve mostrare tre eventi.");
  assert.match(await historyPage.locator("#page-indicator").textContent(), /Pagina 1 di 2/);
  assert.equal(await historyPage.locator("#page-previous").isDisabled(), true);
  assert.equal(await historyPage.locator("#page-next").isDisabled(), false);
  assert.match(await historyPage.locator("#history-events").textContent(), /Impostazione modificato/);
  await historyPage.locator("#page-next").click();
  assert.equal(await historyPage.locator("#history-events .dsm-history-item").count(), 3,
    "La seconda pagina deve mostrare gli eventi rimanenti.");
  assert.match(await historyPage.locator("#page-indicator").textContent(), /Pagina 2 di 2/);
  assert.equal(await historyPage.locator("#page-next").isDisabled(), true);
  assert.match(await historyPage.locator("#history-events").textContent(), /Profilo modificato/);
  assert.match(await historyPage.locator("#history-events").textContent(), /Turno creato/);
  await historyPage.locator("#filter-sort").selectOption("oldest");
  assert.match(await historyPage.locator("#history-events").textContent(), /Turno creato/,
    "L'ordinamento crescente non mostra gli eventi più vecchi per primi.");
  assert.match(await historyPage.locator("#page-indicator").textContent(), /Pagina 1 di 2/);
  await historyPage.locator("#filter-sort").selectOption("newest");
  assert.match(await historyPage.locator("#history-events").textContent(), /Impostazione modificato/,
    "L'ordinamento decrescente non ripristina gli eventi più recenti.");
  assert.equal(await historyPage.locator("#history-events .dsm-history-item").count(), 3);
  assert.match(await historyPage.locator("#history-status").textContent(), /6 di 6 eventi dimostrativi/);
  assert.match(await historyPage.locator("#history-events").textContent(), /Impostazione modificato/);
  assert.match(await historyPage.locator(".notice").textContent(), /eventi inventati/);
  assert.equal(historyErrors.length, 0, historyErrors.join("; "));
  assert.ok(historyRequests.every(url => url.startsWith("http://127.0.0.1:8000/")),
    "L'anteprima cronologia ha effettuato richieste esterne.");
  await historyPage.locator("#filter-entity").selectOption("Profilo");
  assert.equal(await historyPage.locator("#history-events .dsm-history-item").count(), 2,
    "Filtro elemento non corretto.");
  assert.match(await historyPage.locator("#history-status").textContent(), /2 di 6/);
  await historyPage.locator("#filter-action").selectOption("Creato");
  assert.equal(await historyPage.locator("#history-events .dsm-history-item").count(), 1,
    "Filtro combinato elemento/azione non corretto.");
  await historyPage.locator("#filter-entity").selectOption("all");
  await historyPage.locator("#filter-action").selectOption("Eliminato");
  assert.equal(await historyPage.locator("#history-events .dsm-history-item").count(), 1,
    "Filtro azione non corretto.");
  await historyPage.locator("#filter-action").selectOption("all");
  await historyPage.locator("#filter-from").fill("2026-11-22");
  await historyPage.locator("#filter-to").fill("2026-11-23");
  assert.equal(await historyPage.locator("#history-events .dsm-history-item").count(), 4,
    "Filtro intervallo date non corretto.");
  await historyPage.locator("#filter-entity").selectOption("Profilo");
  assert.equal(await historyPage.locator("#history-events .dsm-history-item").count(), 2,
    "Filtro combinato date/elemento non corretto.");
  await historyPage.locator("#filter-from").fill("2026-11-24");
  await historyPage.locator("#filter-to").fill("2026-11-22");
  assert.equal(await historyPage.locator("#history-events .dsm-history-item").count(), 0,
    "Intervallo date invertito non bloccato.");
  assert.match(await historyPage.locator("#history-status").textContent(), /intervallo non valido/i);
  await historyPage.locator("#clear-filters").click();
  assert.equal(await historyPage.locator("#history-events .dsm-history-item").count(), 3,
    "Azzera filtri non ripristina la prima pagina degli eventi.");
  assert.match(await historyPage.locator("#page-indicator").textContent(), /Pagina 1 di 2/);
  assert.match(await historyPage.locator("#history-status").textContent(), /6 di 6/);
  await historyPage.locator("#filter-search").fill("profilo");
  assert.equal(await historyPage.locator("#history-events .dsm-history-item").count(), 2,
    "Ricerca testuale case-insensitive non corretta.");
  await historyPage.locator("#filter-search").fill("  TURNO  ");
  assert.equal(await historyPage.locator("#history-events .dsm-history-item").count(), 3,
    "Ricerca testuale non ignora maiuscole e spazi esterni.");
  await historyPage.locator("#filter-search").fill("profilo creato");
  assert.equal(await historyPage.locator("#history-events .dsm-history-item").count(), 1,
    "Ricerca testuale su descrizione non corretta.");
  await historyPage.locator("#filter-search").fill("testo inesistente");
  assert.equal(await historyPage.locator("#history-events .dsm-history-item").count(), 0,
    "Ricerca senza risultati non corretta.");
  await historyPage.locator("#filter-search").fill("2026-11-22");
  assert.equal(await historyPage.locator("#history-events .dsm-history-item").count(), 2,
    "Ricerca per data non corretta.");
  await historyPage.locator("#filter-search").fill("revisione 2");
  assert.equal(await historyPage.locator("#history-events .dsm-history-item").count(), 0,
    "La ricerca non deve inventare contenuti non presenti nella descrizione.");
  await historyPage.locator("#clear-filters").click();
  assert.equal(await historyPage.locator("#history-events .dsm-history-item").count(), 6,
    "Azzera non cancella la ricerca testuale.");
  console.log("PASS — isolated history preview: synthetic data, service DTO, safe rendering, no external requests");
  await historyPage.close();

  console.log("PASS — local legacy report page: privacy, quarantine, sanitized download, single preview, invalid JSON, duplicate names, and file limits");
  await reportPage.close();
} finally {
  await browser.close();
}
