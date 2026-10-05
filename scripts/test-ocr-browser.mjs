import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const source = await readFile(new URL("../public/wystawiacz/part-number-ocr.js", import.meta.url));
const server = createServer((req, res) => {
  if (req.url === "/ocr.js") { res.setHeader("Content-Type", "text/javascript"); res.end(source); return; }
  res.setHeader("Content-Type", "text/html");
  res.end('<button id="scanPartNumbers">Scan</button><button id="cancelPartNumberScan" class="hidden">Cancel</button><p id="partNumberScanStatus"></p><div id="partNumberCandidates"></div><script src="/ocr.js"></script>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.addScriptTag({ url: "https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js" });
  await page.evaluate(() => {
    const create = window.Tesseract.createWorker;
    window.Tesseract.createWorker = async (...args) => {
      const worker = await create(...args);
      const recognize = worker.recognize;
      worker.recognize = async (...input) => {
        const result = await recognize(...input);
        window.rawOcrText = result.data.text;
        return result;
      };
      return worker;
    };
  });
  await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 1100; canvas.height = 250;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "white"; ctx.fillRect(0, 0, 1100, 250);
    ctx.fillStyle = "black"; ctx.font = "64px Arial";
    ctx.fillText("P/N: 5NA 803 881 F", 40, 130);
    const blob = await new Promise(resolve => canvas.toBlob(resolve));
    window.fixture = { productId: "test", photos: [{ name: "label.png", file: new File([blob], "label.png", { type: "image/png" }) }] };
    window.chosen = "";
    window.PartNumberOcr.mount({ getSelection: () => ({ ...window.fixture, photos: window.fixture.photos.map(photo => ({ ...photo })) }), choose: number => { window.chosen = number; } });
  });
  await page.locator("#scanPartNumbers").click();
  await page.waitForFunction(() => !document.getElementById("scanPartNumbers").disabled, { timeout: 120000 });
  const status = await page.locator("#partNumberScanStatus").innerText();
  const candidates = await page.locator(".part-number-candidate strong").allTextContents();
  console.log({ status, candidates, errors, raw: await page.evaluate(() => window.rawOcrText) });
  assert.ok(candidates.includes("5NA803881F"), "Real OCR should read the synthetic part label");
  assert.equal(await page.evaluate(() => window.chosen), "", "OCR must not select automatically");
  await page.locator(".part-number-candidate").filter({ hasText: "5NA803881F" }).click();
  assert.equal(await page.evaluate(() => window.chosen), "5NA803881F");
  await page.evaluate(() => { window.fixture.productId = "other"; window.chosen = ""; });
  await page.locator(".part-number-candidate").filter({ hasText: "5NA803881F" }).click();
  assert.equal(await page.evaluate(() => window.chosen), "");
  assert.equal(await page.locator(".part-number-candidate").count(), 0);
  await page.locator("#scanPartNumbers").click();
  await page.waitForFunction(() => document.getElementById("partNumberScanStatus").textContent.startsWith("Odczyt 1/"));
  await page.locator("#cancelPartNumberScan").click();
  await page.waitForFunction(() => !document.getElementById("scanPartNumbers").disabled, { timeout: 10000 });
  assert.equal(await page.locator("#partNumberScanStatus").innerText(), "Odczyt przerwany.");
  assert.deepEqual(errors, []);
  console.log("Real browser OCR and click/stale-offer protection passed.");
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
