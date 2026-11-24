import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath, pathToFileURL } from "node:url";
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const bundle = await build({ stdin: { contents: 'import * as cache from "./lib/inventory-cache";window.cache=cache;', resolveDir: fileURLToPath(new URL("../", import.meta.url)) }, bundle: true, write: false, format: "iife", platform: "browser" });
const browser = await chromium.launch({ headless: true, channel: "chrome" });
try {
  const page = await browser.newPage();
  await page.route("https://cache.test/**", r => r.fulfill({ contentType: "text/html", body: "<html><body>Cache fixture</body></html>" }));
  async function open() { await page.goto("https://cache.test/"); await page.addScriptTag({ content: bundle.outputFiles[0].text }); }
  await open();
  await page.evaluate(async () => { await window.cache.writeInventoryCache("owner-a", { errors: [], allegro: Array.from({ length: 40000 }, (_, i) => ({ id: String(i+1), name: `Czesc ${i}` })), ovoko: [] }); });
  await open(); // Full navigation discards the memory cache: this must use IndexedDB.
  const result = await page.evaluate(async () => {
    const started = performance.now(), own = await window.cache.readInventoryCache("owner-a"), other = await window.cache.readInventoryCache("owner-b");
    return { count: own?.allegro.length, other: !!other, elapsed: performance.now() - started };
  });
  assert.equal(result.count, 40000); assert.equal(result.other, false);
  await page.evaluate(async () => { const real = Date.now; Date.now = () => real() + 6*60000; try { if (await window.cache.readInventoryCache("owner-a")) throw new Error("Expired cache returned"); } finally { Date.now = real; } });
  await page.evaluate(async () => window.cache.clearInventoryCache("owner-a")); await open();
  assert.equal(await page.evaluate(async () => !!await window.cache.readInventoryCache("owner-a")), false);
  console.log(`Inventory cache: 40,000 fixture rows survived navigation, owner isolation/5-minute expiry/explicit invalidation passed (${Math.round(result.elapsed)}ms local read; not a provider benchmark).`);
} finally { await browser.close(); }
