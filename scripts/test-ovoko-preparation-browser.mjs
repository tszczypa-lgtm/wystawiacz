import assert from "node:assert/strict";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const root = fileURLToPath(new URL("../", import.meta.url));
const css = await postcss([tailwind({ base: root })]).process(readFileSync(new URL("../app/globals.css", import.meta.url), "utf8"), { from: fileURLToPath(new URL("../app/globals.css", import.meta.url)) });
const bundle = await build({ stdin: { contents: 'import React from "react"; import { createRoot } from "react-dom/client"; import { OvokoPreparationPanel } from "./app/panel/inventory/prepare-ovoko/preparation-panel"; createRoot(document.getElementById("root")).render(<OvokoPreparationPanel/>);', resolveDir: root, loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "session", setup(builder) {
  builder.onResolve({ filter: /(?:^@\/lib\/|^\.\/)supabase$/ }, () => ({ path: "session", namespace: "fixture" }));
  builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: 'export function createSupabaseBrowserClient(){return {auth:{getSession:async()=>({data:{session:{access_token:"fixture"}}})}}}', loader: "js" }));
} }] });
const browser = await chromium.launch({ headless: true, channel: "chrome" });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } }), calls = [], errors = [], allRequests = [];
  let admin = true, failure = false, dictionaryFailure = false, currency = "PLN";
  const id = "1234567891";
  page.on("pageerror", error => errors.push(error.message)); page.on("request", request => allRequests.push(request.url()));
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.hostname === "a.allegroimg.com") return route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9V0AAAAASUVORK5CYII=", "base64") });
    assert.equal(url.origin, "https://prepare.test", "No HTML/script/iframe or arbitrary photo fetches");
    if (!url.pathname.startsWith("/api/")) return route.fulfill({ contentType: "text/html", body: '<html><body style="background:#0d1117;color:white"><main id="root" style="max-width:1100px;margin:auto;padding:20px"></main></body></html>' });
    calls.push({ path: url.pathname, method: request.method() });
    if (url.pathname === "/api/account/me") { assert.equal(request.method(), "GET"); return route.fulfill({ json: { isAdmin: admin } }); }
    if (url.pathname === `/api/allegro/own-offers/${id}`) {
      assert.equal(request.method(), "GET");
      if (failure) return route.fulfill({ status: 404, json: { message: "Oferta nie nalezy do polaczonego konta." } });
      return route.fulfill({ json: { id, name: "Pompa ABS 123456", stock: { available: 1 }, publication: { status: "ACTIVE" }, productSet: [{ quantity: { value: 1 }, product: { parameters: [{ id: "mpn", name: "Numer katalogowy części", values: ["ABC123"] }] } }], category: { id: "999" }, sellingMode: { price: { amount: "123.45", currency } }, delivery: { shippingRates: { id: "rate-1" } }, description: { sections: [{ items: [{ type: "TEXT", content: '<p>Opis <b>czesci</b></p><script>window.injected=true</script><iframe src="https://evil.test"></iframe><img src="https://evil.test/pic"><style>body{display:none}</style>' }] }] }, images: ["https://a.allegroimg.com/photo", "https://evil.test/x.jpg"] } });
    }
    if (url.pathname === "/api/allegro/shipping-rates") { assert.equal(request.method(), "GET"); return route.fulfill({ json: { shippingRates: [{ id: "rate-1", name: "Maly kurier" }] } }); }
    assert.equal(url.pathname, "/api/ovoko/read", "Only dictionary reads, no publication or local save endpoints"); assert.equal(request.method(), "POST");
    const payload = request.postDataJSON(); assert.deepEqual(Object.keys(payload).sort(), ["operation", "useSaved"]); assert.equal(payload.useSaved, true);
    assert.ok(["categories", "qualities", "statuses"].includes(payload.operation));
    if (dictionaryFailure) return route.fulfill({ status: 502, json: { message: "Blad slownika" } });
    return route.fulfill({ json: { ok: true, readOnly: true, operation: payload.operation, rows: payload.operation === "categories" ? [{ id: "1", name: "Rodzic", level: "1" }, { id: "3", name: "Pompy", level: "3" }] : [{ id: "0", name: "Wartosc zero" }] } });
  });
  async function mount(query = `offerId=${id}`) { await page.goto(`https://prepare.test/panel/inventory/prepare-ovoko?${query}`); await page.addStyleTag({ content: css.css }); await page.addScriptTag({ content: bundle.outputFiles[0].text }); }
  await mount(); await page.getByLabel("Nazwa robocza", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Opis / uwagi robocze").inputValue(), "Opis czesci"); assert.equal(await page.evaluate(() => window.injected), undefined);
  assert.ok(allRequests.every(url => !url.includes("evil.test")));
  assert.equal(calls.filter(call => call.method === "POST").length, 0, "Opening preparation performs no Ovoko requests");
  assert.equal(await page.getByLabel("Numer katalogowy - propozycja do sprawdzenia").inputValue(), "ABC123");
  assert.equal(await page.getByLabel("Kategoria Ovoko", { exact: true }).inputValue(), "");
  const beforeEdit = calls.length;
  await page.getByLabel("Cena robocza").fill("99.00"); await page.getByLabel("Waluta", { exact: true }).selectOption("EUR");
  assert.equal(await page.getByLabel("Cena robocza").inputValue(), "99.00"); assert.equal(calls.length, beforeEdit, "Editing is memory-only, with no saves or FX calls");
  for (const label of ["Kategoria Ovoko", "Jakosc czesci Ovoko", "Status rekordu Ovoko"]) {
    await page.getByRole("button", { name: `Pobierz: ${label}`, exact: true }).click();
    await page.getByLabel(label, { exact: true }).locator('option[value="' + (label === "Kategoria Ovoko" ? "3" : "0") + '"]').waitFor({ state: "attached" });
    await page.getByLabel(label, { exact: true }).selectOption(label === "Kategoria Ovoko" ? "3" : "0");
  }
  assert.equal(await page.getByLabel("Kategoria Ovoko", { exact: true }).locator('option[value="1"]').count(), 0, "Only level-three categories are offered");
  await page.getByRole("button", { name: "Odczytaj nazwe cennika Allegro" }).click(); await page.getByText("Cennik Allegro: Maly kurier", { exact: true }).waitFor();
  await page.getByLabel("ID samochodu-dawcy Ovoko - roboczo, niezweryfikowane").fill("36");
  await page.getByLabel("Plan wysylki do sprawdzenia").fill("Sprawdze gabaryt i cene wysylki");
  assert.equal(await page.getByRole("button", { name: /Wystaw|Opublikuj|Publikuj|Usun|Wycofaj/ }).count(), 0);
  assert.match(await page.getByLabel("Braki przygotowania").textContent(), /Publikacja jest wylaczona/);
  dictionaryFailure = true; await page.getByRole("button", { name: "Pobierz: Kategoria Ovoko", exact: true }).click(); await page.getByRole("alert").filter({ hasText: "Blad slownika" }).waitFor();
  assert.equal(await page.getByLabel("Kategoria Ovoko", { exact: true }).inputValue(), "3");
  mkdirSync(new URL("../outputs/ovoko-preparation-preview/", import.meta.url), { recursive: true });
  await page.screenshot({ path: fileURLToPath(new URL("../outputs/ovoko-preparation-preview/desktop.png", import.meta.url)), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: fileURLToPath(new URL("../outputs/ovoko-preparation-preview/mobile.png", import.meta.url)), fullPage: true });
  currency = "CZK"; await mount(); await page.getByLabel("Cena robocza").waitFor(); assert.equal(await page.getByLabel("Cena robocza").inputValue(), "");
  assert.equal(await page.getByLabel("ID samochodu-dawcy Ovoko - roboczo, niezweryfikowane").inputValue(), "", "Draft never persists across reloads");
  failure = true; await mount(); await page.getByRole("alert").filter({ hasText: "Oferta nie nalezy" }).waitFor(); assert.equal(await page.getByLabel("Nazwa robocza", { exact: true }).count(), 0);
  admin = false; const beforeDenied = calls.filter(call => call.path.includes("own-offers")).length;
  await mount(); await page.getByRole("alert").filter({ hasText: "administratora" }).waitFor(); assert.equal(calls.filter(call => call.path.includes("own-offers")).length, beforeDenied);
  admin = true; const beforeInvalid = calls.length; await mount("offerId=123&offerId=456"); await page.getByRole("alert").filter({ hasText: "Wybierz jedna" }).waitFor(); assert.equal(calls.length, beforeInvalid);
  assert.equal(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage })), "{}"); assert.deepEqual(errors, []);
  console.log("Ovoko preparation browser: source-only reads on open, inert HTML, explicit dictionaries, editable memory-only draft, no FX or ID guessing, admin/ID/error guards, no publication controls and desktop/mobile layout passed.");
} finally { await browser.close(); }
