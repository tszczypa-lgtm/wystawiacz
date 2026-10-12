import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { pathToFileURL, fileURLToPath } from "node:url";
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const root = new URL("../public/wystawiacz/", import.meta.url);
let saved, conflict = false, writes = 0;
const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://test.local").pathname;
  if (path.startsWith("/api/")) {
    res.setHeader("Content-Type", "application/json");
    let data = { connected: false, build: "2026-06-02.35", categories: [], parameters: [] };
    if (path === "/api/workspace/preferences") data = { descriptionTemplate: null };
    if (path === "/api/workspace/session" && req.method === "PUT") {
      let raw = ""; for await (const chunk of req) raw += chunk;
      writes++;
      if (conflict) { res.statusCode = 409; data = { conflict: true }; }
      else { saved = JSON.parse(raw); data = { revision: 1 }; }
    }
    if (path === "/api/allegro/own-offers") data = { offers: [{ id: "123456789", name: "Pompa ABS BMW F40 1234567" }, { id: "987654321", name: "Pompa ABS BMW F40 1234567A" }] };
    if (path === "/api/allegro/own-offers/123456789") data = { id: "123456789", name: "Pompa ABS BMW F40 1234567", category: { id: "123" }, stock: { available: 2, unit: "PAIR" }, sellingMode: { price: { amount: "500.00" } }, delivery: { shippingRates: { id: "shipping" } }, afterSalesServices: { returnPolicy: { id: "return" }, impliedWarranty: { id: "claim" } }, description: { sections: [{ items: [{ type: "TEXT", content: "<p>Moj opis</p>" }] }] }, productSet: [{ product: { parameters: [] }, marketedBeforeGPSRObligation: true }] };
    res.end(JSON.stringify(data)); return;
  }
  try {
    const name = path === "/" ? "index.html" : path.slice(1);
    if (!/^[a-z0-9.-]+$/i.test(name)) throw Error();
    let body = await readFile(new URL(name, root));
    if (name === "index.html") body = body.toString().replace('<script src="web-auth.js"></script>', '<script>window.getWystawiaczToken=async()=>"test";</script>');
    res.setHeader("Content-Type", name.endsWith(".js") ? "text/javascript" : name.endsWith(".css") ? "text/css" : "text/html; charset=utf-8"); res.end(body);
  } catch { res.statusCode = 404; res.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || "chrome" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(() => {
    window.opened = []; window.open = (...args) => { window.opened.push(args); return null; }; window.confirm = () => true;
    const malicious = { format: "wystawiacz-allegro-session", products: [{ id: "bad", title: "test", stock: '<img src=x onerror="window.hacked=1">', photoNames: [] }] };
    try { SessionSafety.validate(malicious); throw Error("Unsafe import accepted"); } catch (error) { if (error.message === "Unsafe import accepted") throw error; }
    state.products = [{ id: "bad", title: "test", stock: '<img src=x onerror="window.hacked=1">', image: 'x" onerror="window.hacked=1', photoNames: [] }];
    renderProducts();
  });
  assert.equal(await page.locator("#productList img").count(), 0);
  assert.equal(await page.evaluate(() => window.hacked), undefined);
  await page.evaluate(() => {
    state.products = [1, 2, 3].map(n => ({ id: crypto.randomUUID(), title: `Produkt ${n}`, stock: 1, photoNames: [], allegroOfferId: n === 3 ? "123456789" : null })); renderProducts();
    window.published = []; window.inFlight = 0; window.maxFlight = 0;
    publishProduct = async id => {
      window.inFlight++; window.maxFlight = Math.max(window.maxFlight, window.inFlight);
      await new Promise(resolve => setTimeout(resolve, 30));
      window.published.push(id); state.products.find(p => p.id === id).allegroOfferId = "123456789"; window.inFlight--;
    };
  });
  await page.locator("#selectReadyProducts").click();
  assert.equal(await page.locator("[data-select-product-id]:checked").count(), 2);
  await page.locator("#publishSelectedProducts").click();
  await page.waitForFunction(() => !batchPublishing && window.published.length === 2);
  assert.equal(await page.evaluate(() => window.maxFlight), 1);
  await page.locator(".edit-button").first().click();
  assert.match(await page.evaluate(() => window.opened.at(-1)[0]), /offer\/123456789\/edit$/);
  assert.equal(await page.evaluate(() => activeProductId), "");
  await page.evaluate(() => { state.products = []; resetForm(); state.vehicles = [{ id: "a", manufacturer: "BMW", short: "BMW F40", full: "BMW F40\n2019\n2.0 diesel" }, { id: "b", manufacturer: "Volkswagen", short: "VW Golf", full: "VW Golf\n2020\n1.6 TDI" }]; renderVehicles(); });
  await page.locator("#titleInput").fill("Pompa ABS");
  await page.locator('[data-use-vehicle-id="a"]').click();
  const original = await page.locator("#descriptionTextInput").inputValue();
  await page.locator("#descriptionTextInput").fill(original + "\n\nMoje uwagi bez zmian");
  await page.locator('[data-use-vehicle-id="b"]').click();
  const changed = await page.locator("#descriptionTextInput").inputValue();
  assert.ok(changed.includes("VW Golf\n2020\n1.6 TDI")); assert.ok(changed.includes("Moje uwagi bez zmian")); assert.ok(!changed.includes("BMW F40"));
  await page.locator("#descriptionTextInput").fill('**Pompa ABS**\n- Sprawna\n<script>window.hacked=2</script>');
  assert.equal(await page.locator(".formatted-description b").textContent(), "Pompa ABS");
  assert.equal(await page.locator(".formatted-description li").textContent(), "Sprawna");
  assert.equal(await page.locator(".formatted-description script").count(), 0);
  await page.evaluate(() => {
    state.allegroConnected = true; state.selectedPhotoNames = ["moje.jpg"];
    state.shippingRates = [{ id: "shipping", name: "Cennik" }]; shippingRateInput.innerHTML = '<option value="shipping">Cennik</option>';
    state.afterSalesServices.returnPolicies = [{ id: "return", name: "Zwrot" }]; state.afterSalesServices.impliedWarranties = [{ id: "claim", name: "Reklamacja" }];
    state.selectedVehicleId = "";
  });
  await page.locator("#partNumber").fill("1234567");
  await page.waitForSelector(".own-offers-panel button");
  assert.equal(await page.locator(".own-offers-panel button").count(), 1, "A suffix variant must not match the complete part number");
  await page.locator(".own-offers-panel button").click();
  await page.waitForFunction(() => priceInput.value === "500.00");
  assert.equal(await page.locator("#stockUnitInput").inputValue(), "PAIR");
  assert.equal(await page.locator("#shippingRateInput").inputValue(), "shipping");
  assert.equal(await page.locator("#returnPolicyInput").inputValue(), "return");
  assert.deepEqual(await page.evaluate(() => state.selectedPhotoNames), ["moje.jpg"]);
  assert.equal(await page.evaluate(() => activeProductId), "");
  assert.equal(await page.evaluate(() => state.products.length), 0);
  await page.locator('[data-use-vehicle-id="b"]').click();
  assert.ok(!(await page.locator("#titleInput").inputValue()).includes("BMW"));
  const conversion = await page.evaluate(async () => {
    const canvas = document.createElement("canvas"); canvas.width = 40; canvas.height = 20;
    const png = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
    const [a, b] = await Promise.all([PhotoUpload.prepare(png, true), PhotoUpload.prepare(png, true)]);
    return { same: a === b, type: a.type, bytes: a.size };
  });
  assert.equal(conversion.same, true); assert.equal(conversion.type, "image/jpeg"); assert.ok(conversion.bytes > 0);
  await page.evaluate(() => cloudSessions.save());
  assert.equal(writes, 1); assert.equal(saved.revision, 0); assert.equal(saved.payload.draft.price, "500.00"); assert.equal(saved.payload.draft.image, undefined);
  conflict = true;
  await page.locator("#priceInput").fill("600");
  await page.evaluate(() => cloudSessions.save());
  assert.match(await page.locator("#sessionStatus").textContent(), /innej karcie/);
  assert.equal(saved.payload.draft.price, "500.00", "A conflicting autosave never overwrites the server version");
  assert.equal(await page.locator(".price-search-row").count(), 6);
  await page.locator(".price-search-row").filter({ hasText: "Ovoko" }).locator("button").first().click();
  assert.equal(new URL(await page.evaluate(() => window.opened.at(-1)[0])).searchParams.get("q"), "1234567");
  await mkdir(new URL("../outputs/approved-check/", import.meta.url), { recursive: true });
  await page.screenshot({ path: fileURLToPath(new URL("../outputs/approved-check/workspace.png", import.meta.url)), fullPage: true });
  assert.deepEqual(errors, []);
  console.log("Approved workspace: safe imports, sequential batch/skip published, external editing, vehicle block preservation, rich formatting, own-offer copy with prices/shipping and retained photos, cached JPEG conversion, conflict-safe cloud save and price links passed. No live offers/payments.");
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
