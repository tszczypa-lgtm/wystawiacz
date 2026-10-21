import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const source = await readFile(new URL("../public/wystawiacz/allegro-price-reader.js", import.meta.url), "utf8");
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "chrome", headless: true });
try {
  const page = await browser.newPage();
  await page.route("https://allegro.pl/**", route => route.fulfill({ contentType: "text/html", body: `<!doctype html><meta charset="utf-8"><body>
    <article data-role="offer"><h2><a href="https://allegro.pl/oferta/silniczek-123456789?utm=test#x">Silniczek szyby 5Q0959801B</a></h2><del><strong>5,00 zł</strong></del><div data-role="price">35,50 zł</div><div data-role="installments"><strong>2,00 zł</strong></div></article>
    <article><h2><a href="https://allegro.pl/oferta/silniczek-123456788">Silniczek 5Q0 959 801 B</a></h2><strong aria-label="aktualna cena 20,00 zł">20,00 zł</strong></article>
    <article><h2><a href="https://allegro.pl/oferta/inny-123456787">Silniczek 5Q0959801BA</a></h2><strong>1,00 zł</strong></article>
    <article><h2><a href="https://allegro.pl/oferta/uszkodzony-123456786">USZKODZONY silniczek 5Q0959801B</a></h2><strong>1,00 zł</strong></article>
    <article hidden><h2><a href="https://allegro.pl/oferta/ukryty-123456785">Silniczek 5Q0959801B</a></h2><strong>1,00 zł</strong></article>
    <article><h2><a href="https://evil.test/oferta/inny-123456784">Silniczek 5Q0959801B</a></h2><strong>1,00 zł</strong></article>
    </body>` }));
  await page.goto("https://allegro.pl/listing?string=5Q0959801B&order=p");
  await page.addScriptTag({ content: source });
  const reading = await page.evaluate(() => AllegroPriceReader.collect());
  assert.equal(reading.offers.length, 2);
  assert.equal(reading.offers[0].amount, 20);
  assert.equal(reading.offers[1].amount, 35.5, "Do not read crossed-out or installment prices");
  assert.equal(reading.offers[1].url, "https://allegro.pl/oferta/silniczek-123456789");
  assert.equal(await page.evaluate(data => AllegroPriceReader.validate(JSON.stringify(data), "5Q0959801B").lowest.amount, reading), 20);
  for (const invalid of [
    { ...reading, number: "OTHER123" }, { ...reading, checkedAt: "2000-01-01" },
    { ...reading, offers: [{ ...reading.offers[0], url: "javascript:alert(1)" }] },
    { ...reading, offers: [{ ...reading.offers[0], title: "Inny numer 5Q0959801BA" }] },
    { ...reading, offers: [{ ...reading.offers[0], amount: -1 }] },
  ]) {
    assert.equal(await page.evaluate(data => { try { AllegroPriceReader.validate(JSON.stringify(data), "5Q0959801B"); return false; } catch { return true; } }, invalid), true);
  }
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async value => { window.testClipboard = value; } } });
    window.alert = () => {}; window.prompt = () => { throw Error("Clipboard fallback should not be needed in this test"); };
    (0, eval)(AllegroPriceReader.bookmarklet().replace(/^javascript:/, ""));
  });
  await page.waitForFunction(() => window.testClipboard);
  assert.equal(JSON.parse(await page.evaluate(() => window.testClipboard)).offers[0].amount, 20);
  assert.equal(await page.evaluate(() => { try { AllegroPriceReader.collect(document, "https://evil.test/listing?string=5Q0959801B"); return false; } catch { return true; } }), true);
  console.log("Allegro browser reader: visible exact-number offers, minimum, excluded old/installment/damaged/hidden prices, safe links, timestamp/number validation and generated bookmarklet passed. Mock page only; no Allegro access restriction was bypassed.");
} finally { await browser.close(); }
