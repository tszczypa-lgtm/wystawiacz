import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { pathToFileURL } from "node:url";
const code = ts.transpileModule(await readFile(new URL("../lib/price-comparison.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { extractPriceOffers, searchPriceComparison, readPriceDocuments, priceSearchUrl } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
const advert = (amount, extra = {}) => ({ __typename: "Advert", title: "Silniczek 5Q0959801B", url: `https://www.otomoto.pl/czesci/oferta/test-${amount}.html`, price: { isGross: true, amount: { value: String(amount), currencyCode: "PLN" } }, ...extra });
const fixture = { props: { pageProps: { urqlState: { example: { data: JSON.stringify({ advertSearch: { edges: [20, 30, 50].map(amount => ({ node: advert(amount) })) } }) } } } } };
assert.deepEqual(extractPriceOffers("Otomoto", [fixture], "5Q0959801B").map(p => p.amount), [20, 30, 50]);
const invalid = [
  advert(1, { title: "Silniczek 5Q0959801BA" }), advert(2, { title: "Inny numer 5Q0959801" }), advert(3, { title: "USZKODZONY 5Q0959801B" }),
  advert(4, { price: { isGross: false, amount: { value: "4", currencyCode: "PLN" } } }), advert(5, { url: "https://evil.test/czesci/123" }),
  advert(6, { price: { amount: { value: "6", currencyCode: "EUR" } } }), advert(0), advert(-1), advert("NaN"),
];
assert.equal(extractPriceOffers("Otomoto", invalid, "5Q0959801B").length, 0);
assert.equal(extractPriceOffers("Otomoto", [advert(20, { title: "Silniczek 5Q0 959 801 B" })], "5Q0959801B").length, 1);
const product = { "@type": "Product", name: "Silniczek 5Q0959801B", offers: { "@type": "Offer", url: "https://ovoko.pl/czesci/abc", price: "45.20", priceCurrency: "PLN", availability: "https://schema.org/InStock" } };
assert.equal(extractPriceOffers("Ovoko", [product], "5Q0959801B")[0].amount, 45.2);
assert.equal(extractPriceOffers("Ovoko", [{ ...product, offers: { ...product.offers, availability: "https://schema.org/OutOfStock" } }], "5Q0959801B").length, 0);
assert.equal(extractPriceOffers("Ovoko", [{ ...product, offers: { ...product.offers, "@type": "AggregateOffer", lowPrice: 10 } }], "5Q0959801B").length, 0, "Do not confuse product range prices with a concrete matching offer");
assert.deepEqual(await readPriceDocuments(Response.json(fixture)), [fixture]);
await assert.rejects(() => readPriceDocuments(new Response("large", { headers: { "Content-Length": "4000000" } })), /too large/);
const oldFetch = globalThis.fetch; let requests = [];
try {
  globalThis.fetch = async url => { requests.push(url); return String(url).includes("otomoto.pl") ? Response.json(fixture) : new Response("Denied", { status: 403 }); };
  const result = await searchPriceComparison("owner-a", "5Q0959801B");
  assert.equal(result.results.find(r => r.source === "Otomoto").lowest.amount, 20);
  assert.equal(result.results.filter(r => r.status === "blocked").length, 3);
  assert.equal(requests.length, 4);
  await searchPriceComparison("owner-a", "5Q0959801B"); assert.equal(requests.length, 4, "Repeated request uses the short cache");
  await searchPriceComparison("owner-b", "5Q0959801B"); assert.equal(requests.length, 8, "Cached request does not bypass another owner's request limit");
  assert.equal((await searchPriceComparison("owner-a", "https://private.test")).status, 400);
  assert.ok(requests.every(url => ["allegro.pl", "ovoko.pl", "www.otomoto.pl", "www.olx.pl"].includes(new URL(url).hostname)));
  for (let i = 0; i < 7; i++) await searchPriceComparison("owner-a", `PART123${i}`);
  assert.equal((await searchPriceComparison("owner-a", "PART9999")).status, 429);
} finally { globalThis.fetch = oldFetch; }

if (process.argv.includes("--live")) {
  const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || "chrome" });
  try {
    const page = await browser.newPage();
    const response = await fetch(priceSearchUrl("Otomoto", "5Q0959801B"), { signal: AbortSignal.timeout(20000) });
    assert.equal(response.status, 200);
    const documents = await page.evaluate(html => {
      const doc = new DOMParser().parseFromString(html, "text/html");
      return [...doc.querySelectorAll('script[type="application/ld+json"],script[type="application/json"],script#__NEXT_DATA__')].flatMap(script => { try { return [JSON.parse(script.textContent)]; } catch { return []; } });
    }, await response.text());
    const live = extractPriceOffers("Otomoto", documents, "5Q0959801B");
    assert.ok(live.length > 0, "Read actual matching offers, not dummy prices");
    console.log(JSON.stringify({ liveSource: "Otomoto", number: "5Q0959801B", count: live.length, lowest: live[0], checkedAt: new Date().toISOString() }));
    const comparison = await searchPriceComparison("live-check", "5Q0959801B", async response => page.evaluate(html => {
      const doc = new DOMParser().parseFromString(html, "text/html");
      return [...doc.querySelectorAll('script[type="application/ld+json"],script[type="application/json"],script#__NEXT_DATA__')].flatMap(script => { try { return [JSON.parse(script.textContent)]; } catch { return []; } });
    }, await response.text()));
    assert.equal(comparison.results.find(r => r.source === "Otomoto").status, "ok");
    console.log(JSON.stringify({ liveComparison: comparison.results.map(r => ({ source: r.source, status: r.status, amount: r.lowest?.amount, count: r.count })) }));
  } finally { await browser.close(); }
}
console.log("Price comparison: exact part matching, source/currency checks, real offer minimum, blocked states, bounded reader, cache and owner rate limits passed.");
