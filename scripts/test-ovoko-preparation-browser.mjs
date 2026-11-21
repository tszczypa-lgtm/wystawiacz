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
  let offerTitle = "Pompa ABS 123456", numberParameter = "ABC123";
  let holdAudi = false, releaseAudi = null, audiStarted = null;
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
      return route.fulfill({ json: { id, name: offerTitle, stock: { available: 1 }, publication: { status: "ACTIVE" }, productSet: [{ quantity: { value: 1 }, product: { parameters: [{ id: "mpn", name: "Numer katalogowy części", values: [numberParameter] }] } }], category: { id: "999" }, sellingMode: { price: { amount: "123.45", currency } }, delivery: { shippingRates: { id: "rate-1" } }, description: { sections: [{ items: [{ type: "TEXT", content: '<p>Opis <b>czesci</b></p><script>window.injected=true</script><iframe src="https://evil.test"></iframe><img src="https://evil.test/pic"><style>body{display:none}</style>' }] }] }, images: ["https://a.allegroimg.com/photo", "https://evil.test/x.jpg"] } });
    }
    if (url.pathname === "/api/allegro/shipping-rates") { assert.equal(request.method(), "GET"); return route.fulfill({ json: { shippingRates: [{ id: "rate-1", name: "Maly kurier" }] } }); }
    assert.ok(["/api/ovoko/read", "/api/ovoko/test"].includes(url.pathname), "Only dictionary reads, no publication or local save endpoints"); assert.equal(request.method(), "POST");
    const payload = request.postDataJSON(); assert.equal(payload.useSaved, true);
    if (url.pathname === "/api/ovoko/test") { assert.deepEqual(payload, { useSaved: true }); return route.fulfill({ json: { ok: true, readOnly: true, brands: [{ id: "1", name: "Audi" }, { id: "2", name: "Volkswagen" }] } }); }
    assert.deepEqual(Object.keys(payload).sort(), payload.operation === "models" ? ["brandId", "operation", "useSaved"] : ["operation", "useSaved"]);
    assert.ok(["categories", "qualities", "statuses", "models"].includes(payload.operation));
    if (payload.operation === "models") {
      if (holdAudi && payload.brandId === "1") { audiStarted?.(); await new Promise(resolve => { releaseAudi = resolve; }); }
      return route.fulfill({ json: { ok: true, readOnly: true, operation: "models", rows: payload.brandId === "1" ? [{ id: "10", name: "A4 (B8)", years: "2008 - 2015" }, { id: "11", name: "A4 (B9)", years: "2015 - " }] : [{ id: "20", name: "Golf VII", years: "2012 - 2020" }] } });
    }
    if (dictionaryFailure) return route.fulfill({ status: 502, json: { message: "Blad slownika" } });
    return route.fulfill({ json: { ok: true, readOnly: true, operation: payload.operation, rows: payload.operation === "categories" ? [{ id: "1", name: "Rodzic", level: "1" }, { id: "3", name: "Pompy", level: "3" }] : [{ id: "0", name: "Wartosc zero" }] } });
  });
  async function mount(query = `offerId=${id}`) { await page.goto(`https://prepare.test/panel/inventory/prepare-ovoko?${query}`); await page.addStyleTag({ content: css.css }); await page.addScriptTag({ content: bundle.outputFiles[0].text }); }
  await mount(); await page.getByLabel("Nazwa robocza", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Opis / uwagi robocze").inputValue(), "Opis czesci"); assert.equal(await page.evaluate(() => window.injected), undefined);
  assert.ok(allRequests.every(url => !url.includes("evil.test")));
  await page.getByLabel("Marka auta Ovoko").locator('option[value="1"]').waitFor({ state: "attached" });
  assert.equal(calls.filter(call => call.method === "POST").length, 4, "Opening preparation automatically loads four fixed dictionaries");
  assert.equal(await page.getByRole("button", { name: /Pobierz|Odczytaj/ }).count(), 0);
  assert.equal(await page.getByLabel("Numer katalogowy - propozycja do sprawdzenia").inputValue(), "", "No unconfirmed MPN is inserted");
  await page.getByText("Podpowiedzi numeru (1)", { exact: true }).click();
  await page.getByRole("button", { name: "Uzyj numeru ABC123", exact: true }).click();
  assert.equal(await page.getByLabel("Numer katalogowy - propozycja do sprawdzenia").inputValue(), "ABC123");
  assert.equal(await page.getByLabel("Kategoria Ovoko", { exact: true }).inputValue(), "3");
  const beforeEdit = calls.length;
  await page.getByLabel("Cena robocza").fill("99.00"); await page.getByLabel("Waluta", { exact: true }).selectOption("EUR");
  assert.equal(await page.getByLabel("Cena robocza").inputValue(), "99.00"); assert.equal(calls.length, beforeEdit, "Editing is memory-only, with no saves or FX calls");
  for (const label of ["Kategoria Ovoko", "Jakosc czesci Ovoko", "Status rekordu Ovoko"]) {
    await page.getByLabel(label, { exact: true }).locator('option[value="' + (label === "Kategoria Ovoko" ? "3" : "0") + '"]').waitFor({ state: "attached" });
    await page.getByLabel(label, { exact: true }).selectOption(label === "Kategoria Ovoko" ? "3" : "0");
  }
  assert.equal(await page.getByLabel("Kategoria Ovoko", { exact: true }).locator('option[value="1"]').count(), 0, "Only level-three categories are offered");
  await page.getByText("Cennik Allegro: Maly kurier", { exact: true }).waitFor();
  await page.getByLabel("ID samochodu-dawcy Ovoko - roboczo, niezweryfikowane").fill("36");
  await page.getByLabel("Plan wysylki do sprawdzenia").fill("Sprawdze gabaryt i cene wysylki");
  assert.equal(await page.getByRole("button", { name: /Wystaw|Opublikuj|Publikuj|Usun|Wycofaj/ }).count(), 0);
  assert.match(await page.getByLabel("Braki przygotowania").textContent(), /Publikacja jest wylaczona/);
  dictionaryFailure = true; await mount(); await page.getByRole("alert").filter({ hasText: "Blad slownika" }).waitFor();
  await page.getByLabel("Cena robocza").fill("88"); assert.equal(await page.getByLabel("Cena robocza").inputValue(), "88", "Failed metadata reads leave the draft editable");
  dictionaryFailure = false;
  offerTitle = "AUDI POMPA ABS 2012-2020 5Q0959593E 5Q0959593F"; numberParameter = offerTitle;
  await mount(); await page.getByText("Podpowiedzi numeru (2)", { exact: true }).click();
  await page.getByLabel("Marka auta Ovoko").locator('option[value="1"]').waitFor({ state: "attached" });
  await page.getByLabel("Model auta Ovoko").locator('option[value="10"]').waitFor({ state: "attached" });
  assert.equal(await page.getByLabel("Numer katalogowy - propozycja do sprawdzenia").inputValue(), "");
  assert.equal(await page.getByRole("button", { name: "Uzyj numeru 5Q0959593", exact: true }).count(), 0, "Never offer a truncated indexed title number");
  assert.equal(await page.getByLabel("Propozycje numerow").locator("li").count(), 2, "A title pasted in MPN is not an extra number candidate");
  const beforeSuggestions = calls.length;
  await page.getByRole("button", { name: "Uzyj numeru 5Q0959593E", exact: true }).click();
  assert.equal(await page.getByLabel("Numer katalogowy - propozycja do sprawdzenia").inputValue(), "5Q0959593E");
  await page.getByLabel("Numer katalogowy - propozycja do sprawdzenia").fill("5Q0959593");
  await page.getByText("Propozycja numeru wymaga sprawdzenia.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Uzyj numeru 5Q0959593F", exact: true }).click();
  assert.equal(await page.getByLabel("Numer katalogowy - propozycja do sprawdzenia").inputValue(), "5Q0959593F"); assert.equal(calls.length, beforeSuggestions, "Number inference and confirmation stay local");
  await page.getByText("Podpowiedzi kategorii (1)", { exact: true }).click();
  await page.getByRole("button", { name: "Uzyj kategorii 3", exact: true }).waitFor();
  assert.equal(await page.getByLabel("Kategoria Ovoko", { exact: true }).inputValue(), "3", "Unique category suggestion fills the draft only");
  await page.getByRole("button", { name: "Uzyj kategorii 3", exact: true }).click();
  assert.equal(await page.getByLabel("Kategoria Ovoko", { exact: true }).inputValue(), "3");
  const beforeFilter = calls.length;
  await page.getByLabel("Szukaj w pobranych kategoriach").fill("No matches");
  assert.equal(await page.getByLabel("Kategoria Ovoko", { exact: true }).inputValue(), "3", "Search never erases an existing manual choice"); assert.equal(calls.length, beforeFilter);
  assert.equal(await page.getByLabel("Jakosc czesci Ovoko", { exact: true }).inputValue(), "");
  assert.equal(await page.getByLabel("Status rekordu Ovoko", { exact: true }).inputValue(), "");
  assert.equal(await page.getByLabel("ID samochodu-dawcy Ovoko - roboczo, niezweryfikowane").inputValue(), "");
  assert.equal(await page.getByLabel("Marka auta Ovoko").inputValue(), "1");
  assert.equal(await page.getByLabel("Model auta Ovoko").inputValue(), "", "No model is guessed from a part number alone");
  await page.getByLabel("Marka auta Ovoko").selectOption("2");
  await page.getByLabel("Model auta Ovoko").locator('option[value="20"]').waitFor({ state: "attached" });
  assert.equal(await page.getByLabel("Model auta Ovoko").locator('option[value="10"]').count(), 0, "Changing brands clears previous models");
  offerTitle = "AUDI A4 B9 POMPA ABS 5Q0959593E"; numberParameter = offerTitle;
  await mount(); await page.getByLabel("Model auta Ovoko").locator('option[value="11"]').waitFor({ state: "attached" });
  assert.equal(await page.getByLabel("Model auta Ovoko").inputValue(), "11");
  assert.equal(await page.getByLabel("Numer katalogowy - propozycja do sprawdzenia").inputValue(), "5Q0959593E");
  assert.equal(await page.getByLabel("ID samochodu-dawcy Ovoko - roboczo, niezweryfikowane").inputValue(), "", "Model IDs never become donor IDs");
  mkdirSync(new URL("../outputs/ovoko-preparation-preview/", import.meta.url), { recursive: true });
  await page.screenshot({ path: fileURLToPath(new URL("../outputs/ovoko-preparation-preview/desktop.png", import.meta.url)), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: fileURLToPath(new URL("../outputs/ovoko-preparation-preview/mobile.png", import.meta.url)), fullPage: true });
  holdAudi = true;
  const started = new Promise(resolve => { audiStarted = resolve; });
  await mount(); await started;
  await page.getByLabel("Marka auta Ovoko").selectOption("2");
  await page.getByLabel("Model auta Ovoko").locator('option[value="20"]').waitFor({ state: "attached" });
  await page.getByLabel("Model auta Ovoko").selectOption("20");
  releaseAudi(); holdAudi = false;
  // The old request is aborted, so use a browser round-trip rather than waiting for its response.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.getByLabel("Model auta Ovoko").inputValue(), "20", "A stale model response never overwrites the new brand selection");
  assert.equal(await page.getByLabel("Model auta Ovoko").locator('option[value="11"]').count(), 0);
  currency = "CZK"; await mount(); await page.getByLabel("Cena robocza").waitFor(); assert.equal(await page.getByLabel("Cena robocza").inputValue(), "");
  assert.equal(await page.getByLabel("ID samochodu-dawcy Ovoko - roboczo, niezweryfikowane").inputValue(), "", "Draft never persists across reloads");
  failure = true; await mount(); await page.getByRole("alert").filter({ hasText: "Oferta nie nalezy" }).waitFor(); assert.equal(await page.getByLabel("Nazwa robocza", { exact: true }).count(), 0);
  admin = false; const beforeDenied = calls.filter(call => call.path.includes("own-offers")).length;
  await mount(); await page.getByRole("alert").filter({ hasText: "administratora" }).waitFor(); assert.equal(calls.filter(call => call.path.includes("own-offers")).length, beforeDenied);
  admin = true; const beforeInvalid = calls.length; await mount("offerId=123&offerId=456"); await page.getByRole("alert").filter({ hasText: "Wybierz jedna" }).waitFor(); assert.equal(calls.length, beforeInvalid);
  assert.equal(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage })), "{}"); assert.deepEqual(errors, []);
  console.log("Ovoko preparation browser: automatic bounded dictionary reads, complete number/category suggestions, brand/model selection, no donor guessing, inert HTML, memory-only draft, admin/error guards and desktop/mobile layout passed.");
} finally { await browser.close(); }
