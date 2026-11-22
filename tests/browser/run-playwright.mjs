import { chromium } from "playwright";

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
} finally {
  await browser.close();
}
