import { chromium } from "playwright";
import assert from "node:assert/strict";
import { buildHistoryCsv } from "../../src/ui/history-csv-export.js";
import { runFirebaseAuthAdapterTests } from "./firebase-auth-adapter.test.js";
import { runFirebaseLifecycleTests } from "./firebase-lifecycle.test.js";
import { runFirebaseAuthRenewalTests } from "./firebase-auth-renewal.test.js";

const firebaseAdapterTestCount = await runFirebaseAuthAdapterTests();
console.log(`PASS — ${firebaseAdapterTestCount} test adapter Firebase sintetici`);
const firebaseLifecycleTestCount = await runFirebaseLifecycleTests();
console.log(`PASS — ${firebaseLifecycleTestCount} test lifecycle Firebase sintetici`);
const firebaseRenewalTestCount = await runFirebaseAuthRenewalTests();
console.log(`PASS — ${firebaseRenewalTestCount} test rinnovo Firebase sintetici`);

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
  page.on("pageerror", error => pageErrors.push(error.stack || error.message));
  const fixtureRequests = [];
  page.on("request", request => fixtureRequests.push(request.url()));
  await page.goto("http://127.0.0.1:8000/tests/browser/", { waitUntil: "load" });
  const fixturePolicy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
  assert.ok(fixturePolicy?.includes("default-src 'none'") &&
    fixturePolicy.includes("script-src 'self'") &&
    fixturePolicy.includes("connect-src 'none'") &&
    fixturePolicy.includes("form-action 'none'"),
    "La fixture IndexedDB non applica la Content Security Policy restrittiva.");
  try {
    await page.waitForFunction(() => {
      const summary = document.querySelector("#summary");
      return summary?.dataset.result === "pass" || summary?.dataset.result === "fail";
    }, null, { timeout: 30000 });
  } catch (error) {
    console.error("IndexedDB browser fixture diagnostics:", {
      pageErrors,
      summary: await page.locator("#summary").textContent().catch(() => null),
      results: await page.locator("#results li").allTextContents().catch(() => [])
    });
    throw error;
  }

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
  assert.ok(fixtureRequests.every(url => url.startsWith("http://127.0.0.1:8000/")),
    "La fixture IndexedDB ha richiesto risorse da un'origine esterna.");
  console.log("PASS — IndexedDB fixture CSP blocks external resource requests");

  // Exercise real BroadcastChannel delivery between two same-origin browser pages.
  const crossTabContext = await browser.newContext();
  const crossTabPageA = await crossTabContext.newPage();
  const crossTabPageB = await crossTabContext.newPage();
  const crossTabUrl = "http://127.0.0.1:8000/tests/browser/history-page-test.html";
  await Promise.all([
    crossTabPageA.goto(crossTabUrl, { waitUntil: "load" }),
    crossTabPageB.goto(crossTabUrl, { waitUntil: "load" })
  ]);
  const channelName = `dsm-cross-tab-ci-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  async function installCrossTabProbe(targetPage, tabId) {
    return targetPage.evaluate(async ({ channelName, tabId }) => {
      const {
        createAccountContext,
        createAccountLifecycleCoordinator,
        createAccountLifecycleCrossTabBridge
      } = await import("/src/core/database/index.js");
      const accountContext = createAccountContext();
      const lifecycle = createAccountLifecycleCoordinator({ accountContext });
      const initial = await lifecycle.beginTransition("initialize");
      lifecycle.activateLocal(initial, "synthetic-cross-tab-ci-account");
      const channel = new BroadcastChannel(channelName);
      const bridge = createAccountLifecycleCrossTabBridge({ lifecycleCoordinator: lifecycle, channel, tabId });
      window.__dsmCrossTabProbe = { lifecycle, bridge, channel };
      return lifecycle.getStatus();
    }, { channelName, tabId });
  }
  await Promise.all([
    installCrossTabProbe(crossTabPageA, "ci-browser-tab-A"),
    installCrossTabProbe(crossTabPageB, "ci-browser-tab-B")
  ]);
  await crossTabPageA.evaluate(async () => {
    const token = await window.__dsmCrossTabProbe.lifecycle.beginTransition("switch");
    window.__dsmCrossTabProbe.lifecycle.activateLocal(token, "synthetic-cross-tab-next-account");
  });
  await crossTabPageB.waitForFunction(
    () => window.__dsmCrossTabProbe?.lifecycle.getStatus().state === "cleared",
    null,
    { timeout: 5000 }
  );
  const crossTabResult = await crossTabPageB.evaluate(() => ({
    state: window.__dsmCrossTabProbe.lifecycle.getStatus().state,
    pending: window.__dsmCrossTabProbe.bridge.getStatus().pendingRemote
  }));
  assert.deepEqual(crossTabResult, { state: "cleared", pending: false },
    "La scheda reale non ha invalidato la sessione dopo il messaggio BroadcastChannel.");
  await Promise.all([crossTabPageA, crossTabPageB].map(targetPage => targetPage.evaluate(() => {
    window.__dsmCrossTabProbe.bridge.dispose();
    window.__dsmCrossTabProbe.channel.close();
  })));
  await crossTabContext.close();
  console.log("PASS — real BroadcastChannel invalidation between two same-origin browser pages");

  const learningPage = await browser.newPage();
  const learningErrors = [];
  const learningRequests = [];
  learningPage.on("pageerror", error => learningErrors.push(error.message));
  learningPage.on("request", request => learningRequests.push(request.url()));
  await learningPage.goto("http://127.0.0.1:8000/tests/browser/local-learning.html", { waitUntil: "load" });
  await learningPage.waitForFunction(() => document.querySelector("#summary")?.dataset.result === "pass" ||
    document.querySelector("#summary")?.dataset.result === "fail", null, { timeout: 10000 });
  assert.equal(await learningPage.locator("#summary").getAttribute("data-result"), "pass",
    await learningPage.locator("#summary").textContent());
  assert.equal(learningErrors.length, 0, learningErrors.join("; "));
  assert.ok(learningRequests.every(url => url.startsWith("http://127.0.0.1:8000/")),
    "La modalità apprendimento ha effettuato richieste esterne.");
  console.log(await learningPage.locator("#summary").textContent());
  await learningPage.close();

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
  await reportPage.locator("#files").evaluate(input => {
    const transfer = new DataTransfer();
    for (let index = 0; index < 6; index++) {
      transfer.items.add(new File([new Uint8Array(9 * 1024 * 1024)], `totale-${index}.json`, {
        type: "application/json"
      }));
    }
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  assert.equal(await reportPage.locator("#analyze").isDisabled(), true);
  assert.match(await reportPage.locator("#status").textContent(), /massimo 50 MB per tutti i file/);

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
  assert.match(await historyPage.locator("#history-events").textContent(), /Impostazione modificata/);
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
  assert.match(await historyPage.locator("#history-events").textContent(), /Impostazione modificata/,
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
  assert.match(await historyPage.locator("#history-events").textContent(), /Impostazione modificata/);
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
  assert.equal(await liveHistoryPage.locator(".dsm-history-item").count(), 3,
    "Ricerca per categoria sulla pagina DSM non corretta.");
  await liveHistoryPage.locator(".dsm-history-filters input[type=search]").fill("");
  await liveHistoryPage.locator(".dsm-history-filters select").nth(0).selectOption("Turno");
  assert.equal(await liveHistoryPage.locator(".dsm-history-item").count(), 3,
    "Filtro categoria sulla pagina DSM non corretto.");
  await liveHistoryPage.locator(".dsm-history-filters select").nth(0).selectOption("Assenza");
  assert.equal(await liveHistoryPage.locator(".dsm-history-item").count(), 3,
    "Filtro assenze sulla pagina DSM non corretto.");
  assert.ok((await liveHistoryPage.locator(".dsm-history-item").allTextContents()).every(text => text.includes("Assenza")),
    "Il filtro assenze mostra eventi di altre categorie.");
  await liveHistoryPage.locator(".dsm-history-filters select").nth(0).selectOption("Tutti");
  const dsmSelects = liveHistoryPage.locator(".dsm-history-filters select");
  await dsmSelects.nth(1).selectOption("Creato");
  assert.equal(await liveHistoryPage.locator(".dsm-history-item").count(), 4,
    "Filtro azione non corretto.");
  await dsmSelects.nth(1).selectOption("Tutte");
  await liveHistoryPage.locator(".dsm-history-filters input[type=date]").nth(0).fill("2026-11-24");
  assert.equal(await liveHistoryPage.locator(".dsm-history-item").count(), 0,
    "Filtro data iniziale non corretto.");
  await liveHistoryPage.locator(".dsm-history-filters input[type=date]").nth(0).fill("");
  await liveHistoryPage.locator(".dsm-history-filters input[type=date]").nth(1).fill("2026-11-22");
  assert.match(await liveHistoryPage.locator(".dsm-history-status").textContent(), /0 di 12 eventi/);
  await liveHistoryPage.locator(".dsm-history-filters input[type=date]").nth(1).fill("");
  await liveHistoryPage.locator(".dsm-history-filters input[type=date]").nth(0).fill("2026-11-24");
  await liveHistoryPage.locator(".dsm-history-filters input[type=date]").nth(1).fill("2026-11-22");
  assert.match(await liveHistoryPage.locator(".dsm-history-status").textContent(), /Intervallo non valido/);
  await liveHistoryPage.locator(".dsm-history-filters input[type=date]").nth(0).fill("");
  await liveHistoryPage.locator(".dsm-history-filters input[type=date]").nth(1).fill("");
  await dsmSelects.nth(2).selectOption("oldest");
  assert.match(await liveHistoryPage.locator(".dsm-history-item time").first().getAttribute("datetime"), /T12:00:00/);
  await dsmSelects.nth(2).selectOption("newest");
  assert.match(await liveHistoryPage.locator(".dsm-history-item time").first().getAttribute("datetime"), /T12:11:00/);
  await dsmSelects.nth(3).selectOption("25");
  assert.equal(await liveHistoryPage.locator(".dsm-history-item").count(), 12,
    "Dimensione pagina 25 non applicata.");
  assert.match(await liveHistoryPage.locator(".dsm-history-pagination span").textContent(), /Pagina 1 di 1/);
  await dsmSelects.nth(3).selectOption("10");
  await liveHistoryPage.locator(".dsm-history-pagination button").nth(1).click();
  assert.equal(await liveHistoryPage.locator(".dsm-history-item").count(), 2,
    "Navigazione alla pagina successiva non corretta.");
  await liveHistoryPage.locator(".dsm-history-pagination button").nth(0).click();
  assert.equal(await liveHistoryPage.locator(".dsm-history-item").count(), 10,
    "Navigazione alla pagina precedente non corretta.");
  await liveHistoryPage.locator(".dsm-history-filters button").nth(0).click();
  assert.equal(await liveHistoryPage.locator(".dsm-history-item").count(), 10,
    "Reset filtri non ripristina la pagina iniziale.");
  assert.equal(await dsmSelects.nth(3).inputValue(), "10",
    "Reset non ripristina la dimensione pagina predefinita.");
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
  const lifecycle = await liveHistoryPage.evaluate(() => {
    const controller = window.__historyPageController;
    const searchControl = window.__historySearchControl;
    const statusNode = window.__historyStatusNode;
    const previousStatus = statusNode.textContent;
    controller.destroy();
    controller.destroy();
    const containerCleared = document.querySelector("#history-root").childElementCount === 0;
    searchControl.value = "turno";
    searchControl.dispatchEvent(new Event("input", { bubbles: true }));
    return { containerCleared, listenerRemoved: statusNode.textContent === previousStatus };
  });
  assert.equal(lifecycle.containerCleared, true, "destroy() deve svuotare il contenitore.");
  assert.equal(lifecycle.listenerRemoved, true, "destroy() deve rimuovere i listener.");
  console.log("PASS — DSM history page: HistoryService integration, filters, pagination, safe CSV export, destroy lifecycle, no external requests");
  await liveHistoryPage.close();

  const demoPage = await browser.newPage();
  const demoErrors = [];
  const demoRequests = [];
  demoPage.on("pageerror", error => demoErrors.push(error.message));
  demoPage.on("request", request => demoRequests.push(request.url()));
  await demoPage.goto("http://127.0.0.1:8000/tests/browser/composition-demo.html", { waitUntil: "load" });
  const demoPolicy = await demoPage.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
  assert.ok(demoPolicy?.includes("default-src 'none'") &&
    demoPolicy.includes("script-src 'self'") &&
    demoPolicy.includes("style-src 'self'") &&
    demoPolicy.includes("connect-src 'none'") &&
    demoPolicy.includes("form-action 'none'"),
    "La fixture composition demo non applica la CSP restrittiva prevista.");
  await demoPage.waitForFunction(() => document.documentElement.dataset.demoResult === "ready" ||
    document.documentElement.dataset.demoResult === "error", null, { timeout: 15000 });
  assert.equal(await demoPage.locator("body .demo-banner").count(), 1);
  assert.match(await demoPage.locator(".demo-banner").textContent(), /account locale non autenticato/i);
  assert.match(await demoPage.locator("#demo-status").textContent(), /3 eventi sintetici caricati/);
  assert.equal(await demoPage.locator("#demo-history .dsm-history-item").count(), 3);
  assert.equal(await demoPage.locator("#demo-close").isDisabled(), false);
  assert.equal(demoErrors.length, 0, demoErrors.join("; "));
  assert.ok(demoRequests.every(url => url.startsWith("http://127.0.0.1:8000/")),
    "La fixture composition demo ha richiesto risorse esterne.");
  const demoDatabaseName = await demoPage.evaluate(() => window.__dsmDemoDatabaseName);
  await demoPage.locator("#demo-close").click();
  await demoPage.waitForFunction(() => document.documentElement.dataset.demoResult === "closed", null, { timeout: 10000 });
  assert.equal(await demoPage.locator("#demo-history").evaluate(node => node.childElementCount), 0,
    "Il teardown demo non ha svuotato la vista cronologia.");
  assert.match(await demoPage.locator("#demo-status").textContent(), /database temporaneo cancellato/);
  const remainingDemoDatabases = await demoPage.evaluate(async () =>
    (await indexedDB.databases()).map(database => database.name));
  assert.ok(!remainingDemoDatabases.includes(demoDatabaseName),
    "Il database temporaneo della demo non è stato cancellato.");
  assert.equal(demoErrors.length, 0, demoErrors.join("; "));
  console.log("PASS — isolated composition demo: synthetic-only banner, real history view, teardown, IndexedDB deletion, strict CSP, no external requests");
  await demoPage.close();

  const failedDemoPage = await browser.newPage();
  const failedDemoErrors = [];
  const failedDemoRequests = [];
  failedDemoPage.on("pageerror", error => failedDemoErrors.push(error.message));
  failedDemoPage.on("request", request => failedDemoRequests.push(request.url()));
  await failedDemoPage.goto("http://127.0.0.1:8000/tests/browser/composition-demo.html?fail-mount", { waitUntil: "load" });
  await failedDemoPage.waitForFunction(() => document.documentElement.dataset.demoResult === "error" ||
    document.documentElement.dataset.demoResult === "cleanup-error", null, { timeout: 15000 });
  assert.equal(await failedDemoPage.locator("#demo-close").isDisabled(), true);
  assert.match(await failedDemoPage.locator("#demo-status").textContent(), /database temporaneo è stato chiuso e rimosso/);
  const failedDemoDatabaseName = await failedDemoPage.evaluate(() => window.__dsmDemoDatabaseName);
  const remainingFailedDemoDatabases = await failedDemoPage.evaluate(async () =>
    (await indexedDB.databases()).map(database => database.name));
  assert.ok(!remainingFailedDemoDatabases.includes(failedDemoDatabaseName),
    "Il fallimento di mount ha lasciato il database demo temporaneo.");
  assert.equal(failedDemoErrors.length, 0, failedDemoErrors.join("; "));
  assert.ok(failedDemoRequests.every(url => url.startsWith("http://127.0.0.1:8000/")),
    "Il percorso di errore demo ha richiesto risorse esterne.");
  console.log("PASS — isolated composition demo startup failure: teardown and temporary IndexedDB deletion");
  await failedDemoPage.close();

  console.log("PASS — local legacy report page: privacy, quarantine, sanitized download, single preview, invalid JSON, duplicate names, and file limits");
  await reportPage.close();
} finally {
  await browser.close();
}
