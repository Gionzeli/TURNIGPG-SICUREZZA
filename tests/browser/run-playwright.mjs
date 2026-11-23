import { chromium } from "playwright";
import assert from "node:assert/strict";
import { buildHistoryCsv } from "../../src/ui/history-csv-export.js";

const csvSafetyCases = [
  ["=1+1", "\"'=1+1\""],
  ["+SUM(A1:A2)", "\"'+SUM(A1:A2)\""],
  ["-1+2", "\"'-1+2\""],
  ["@SUM(A1)", "\"'@SUM(A1)\""],
  ["\tformula", "\"'\tformula\""],
  ["\rformula", "\"'\rformula\""],
  ["\nformula", "\"'\nformula\""],
  ['test "quoted", value', '"test ""quoted"", value"']
];
for (const [value, expected] of csvSafetyCases) {
  const csv = buildHistoryCsv([{
    occurredAt: "2026-11-23T09:45:00.000Z",
    entityLabel: "Profilo",
    actionLabel: "Modificato",
    description: value,
    revision: 2
  }]);
  assert.equal(csv.split("\r\n")[1], ['"2026-11-23T09:45:00.000Z"', '"Profilo"', '"Modificato"', expected, '"2"'].join(","),
    `CSV escaping non corretto per il caso ${JSON.stringify(value)}`);
}
assert.throws(() => buildHistoryCsv(null), /array/);
console.log("PASS — CSV serializer: formula prefixes, quotes, and invalid input");

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
  const historyCsvPromise = historyPage.waitForEvent("download");
  await historyPage.locator("#export-csv").click();
  const historyCsvDownload = await historyCsvPromise;
  assert.equal(historyCsvDownload.suggestedFilename(), "cronologia-demo.csv");
  const historyCsvStream = await historyCsvDownload.createReadStream();
  const historyCsvChunks = [];
  for await (const chunk of historyCsvStream) historyCsvChunks.push(chunk);
  const historyCsvBuffer = Buffer.concat(historyCsvChunks);
  assert.deepEqual([...historyCsvBuffer.subarray(0, 3)], [0xEF, 0xBB, 0xBF],
    "CSV must start with the actual UTF-8 BOM.");
  const historyCsv = historyCsvBuffer.toString("utf8").replace(/^\uFEFF/, "");
  const historyCsvLines = historyCsv.split(/\r?\n/);
  assert.equal(historyCsvLines.length, 7, "L'export deve includere tutti i sei risultati, non solo la pagina visibile.");
  assert.equal(historyCsvLines[0], '"Data e ora","Elemento","Azione","Descrizione","Revisione"');
  assert.match(historyCsv, /"Impostazione","Modificato"/);
  assert.match(historyCsv, /"Profilo","Creato"/);
  assert.doesNotMatch(historyCsv, /demo-event-|demo-profile|demo-shift|demo-setting|accountId|entityId/);
  assert.match(await historyPage.locator("#history-status").textContent(), /Esportati 6 eventi/);
  await historyPage.locator("#filter-entity").selectOption("Profilo");
  const filteredCsvPromise = historyPage.waitForEvent("download");
  await historyPage.locator("#export-csv").click();
  const filteredCsvDownload = await filteredCsvPromise;
  const filteredCsvStream = await filteredCsvDownload.createReadStream();
  const filteredCsvChunks = [];
  for await (const chunk of filteredCsvStream) filteredCsvChunks.push(chunk);
  const filteredCsv = Buffer.concat(filteredCsvChunks).toString("utf8");
  assert.equal(filteredCsv.split(/\r?\n/).length, 3, "L'export deve rispettare i filtri attivi.");
  assert.match(filteredCsv, /"Profilo"/);
  assert.doesNotMatch(filteredCsv, /"Turno"|"Impostazione"|demo-profile/);
  await historyPage.locator("#filter-entity").selectOption("all");
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
  await historyPage.locator("#filter-page-size").selectOption("5");
  assert.equal(await historyPage.locator("#history-events .dsm-history-item").count(), 5,
    "La dimensione pagina 5 non viene applicata.");
  assert.match(await historyPage.locator("#page-indicator").textContent(), /Pagina 1 di 2/);
  await historyPage.locator("#page-next").click();
  assert.equal(await historyPage.locator("#history-events .dsm-history-item").count(), 1,
    "L'ultima pagina con dimensione 5 non contiene il solo evento rimanente.");
  await historyPage.locator("#filter-page-size").selectOption("10");
  assert.equal(await historyPage.locator("#history-events .dsm-history-item").count(), 6,
    "La dimensione pagina 10 non mostra tutti gli eventi.");
  assert.match(await historyPage.locator("#page-indicator").textContent(), /Pagina 1 di 1/);
  assert.equal(await historyPage.locator("#page-next").isDisabled(), true);
  await historyPage.locator("#filter-page-size").selectOption("3");
  assert.equal(await historyPage.locator("#history-events .dsm-history-item").count(), 3,
    "Il ripristino a 3 eventi non è corretto.");
  assert.match(await historyPage.locator("#page-indicator").textContent(), /Pagina 1 di 2/);
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
  assert.equal(await historyPage.locator("#history-events .dsm-history-item").count(), 3,
    "La prima pagina del filtro intervallo date non è corretta.");
  assert.match(await historyPage.locator("#history-status").textContent(), /4 di 6 eventi dimostrativi/);
  await historyPage.locator("#filter-entity").selectOption("Profilo");
  assert.equal(await historyPage.locator("#history-events .dsm-history-item").count(), 2,
    "Filtro combinato date/elemento non corretto.");
  await historyPage.locator("#filter-from").fill("2026-11-24");
  await historyPage.locator("#filter-to").fill("2026-11-22");
  assert.equal(await historyPage.locator("#history-events .dsm-history-item").count(), 0,
    "Intervallo date invertito non bloccato.");
  assert.match(await historyPage.locator("#history-status").textContent(), /intervallo non valido/i);
  assert.equal(await historyPage.locator("#export-csv").isDisabled(), true,
    "L'esportazione deve essere disabilitata se i filtri non producono risultati.");
  await historyPage.locator("#clear-filters").click();
  assert.equal(await historyPage.locator("#history-events .dsm-history-item").count(), 3,
    "Azzera filtri non ripristina la prima pagina degli eventi.");
  assert.match(await historyPage.locator("#page-indicator").textContent(), /Pagina 1 di 2/);
  assert.match(await historyPage.locator("#history-status").textContent(), /6 di 6/);
  assert.equal(await historyPage.locator("#export-csv").isDisabled(), false,
    "L'esportazione deve riattivarsi dopo aver azzerato i filtri.");
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
  assert.equal(await historyPage.locator("#history-events .dsm-history-item").count(), 3,
    "Azzera non cancella la ricerca testuale o non torna alla prima pagina.");
  assert.match(await historyPage.locator("#page-indicator").textContent(), /Pagina 1 di 2/);
  console.log("PASS — isolated history preview: synthetic data, service DTO, safe rendering, no external requests");
  await historyPage.close();

  const liveHistoryPage = await browser.newPage();
  const liveHistoryErrors = [];
  const liveHistoryRequests = [];
  liveHistoryPage.on("pageerror", error => liveHistoryErrors.push(error.message));
  liveHistoryPage.on("request", request => liveHistoryRequests.push(request.url()));
  await liveHistoryPage.goto("http://127.0.0.1:8000/tests/browser/history-page-test.html", { waitUntil: "load" });
  await liveHistoryPage.waitForFunction(() => document.documentElement.dataset.pageResult === "pass" ||
    document.documentElement.dataset.pageResult === "fail");
  assert.equal(await liveHistoryPage.locator(".dsm-history-item").count(), 10,
    "La pagina DSM deve mostrare 10 eventi iniziali.");
  assert.match(await liveHistoryPage.locator(".dsm-history-status").textContent(), /12 di 12 eventi/);
  assert.match(await liveHistoryPage.locator(".dsm-history-pagination span").textContent(), /Pagina 1 di 2/);
  await liveHistoryPage.locator(".dsm-history-filters input[type=search]").fill("profilo");
  assert.equal(await liveHistoryPage.locator(".dsm-history-item").count(), 4,
    "Ricerca per categoria sulla pagina DSM non corretta.");
  await liveHistoryPage.locator(".dsm-history-filters input[type=search]").fill("");
  await liveHistoryPage.locator(".dsm-history-filters select").nth(0).selectOption("Turno");
  assert.equal(await liveHistoryPage.locator(".dsm-history-item").count(), 4,
    "Filtro categoria sulla pagina DSM non corretto.");
  await liveHistoryPage.locator(".dsm-history-filters select").nth(0).selectOption("Tutti");
  const dsmCsvPromise = liveHistoryPage.waitForEvent("download");
  await liveHistoryPage.locator(".dsm-history-filters button").nth(1).click();
  const dsmCsv = await dsmCsvPromise;
  assert.equal(dsmCsv.suggestedFilename(), "cronologia-dsm.csv");
  const dsmCsvStream = await dsmCsv.createReadStream();
  const dsmCsvChunks = [];
  for await (const chunk of dsmCsvStream) dsmCsvChunks.push(chunk);
  const dsmCsvBuffer = Buffer.concat(dsmCsvChunks);
  assert.deepEqual([...dsmCsvBuffer.subarray(0, 3)], [0xEF, 0xBB, 0xBF],
    "L'export DSM deve iniziare con BOM UTF-8 reale.");
  const dsmCsvText = dsmCsvBuffer.toString("utf8").replace(/^\uFEFF/, "");
  assert.equal(dsmCsvText.split(/\r?\n/).length, 13,
    "L'export DSM deve contenere tutti i risultati filtrati, non solo la pagina visibile.");
  assert.doesNotMatch(dsmCsvText, /synthetic-|page-test-|entityId|accountId/);
  assert.equal(liveHistoryErrors.length, 0, liveHistoryErrors.join("; "));
  assert.ok(liveHistoryRequests.every(url => url.startsWith("http://127.0.0.1:8000/")),
    "La pagina cronologia DSM ha effettuato richieste esterne.");
  console.log("PASS — DSM history page: HistoryService integration, filters, pagination, safe CSV export, no external requests");
  await liveHistoryPage.close();

  console.log("PASS — local legacy report page: privacy, quarantine, sanitized download, single preview, invalid JSON, duplicate names, and file limits");
  await reportPage.close();
} finally {
  await browser.close();
}
