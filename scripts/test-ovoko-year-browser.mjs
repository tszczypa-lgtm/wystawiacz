import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const bundle = await build({
  stdin: { contents: 'import React from "react";import{createRoot}from"react-dom/client";import{OvokoPreparationPanel}from"./app/panel/inventory/prepare-ovoko/preparation-panel";createRoot(document.getElementById("root")).render(<OvokoPreparationPanel/>);', resolveDir: fileURLToPath(new URL("../", import.meta.url)), loader: "tsx" },
  bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{ name: "session", setup(builder) {
    builder.onResolve({ filter: /(?:^@\/lib\/|^\.\/)supabase$/ }, () => ({ path: "session", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: 'export function createSupabaseBrowserClient(){return{auth:{getSession:async()=>({data:{session:{access_token:"fixture"}}})}}}', loader: "js" }));
  } }],
});
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const errors = [];
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function fixture({ saved = false, known = "", failSource = false, holdSource, holdCars, holdEvidence, year = "2018", responseBinding = {}, webCorrection = false } = {}) {
  const page = await browser.newPage(), calls = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    window.yearAborts = [];
    const nativeFetch = window.fetch;
    window.fetch = (url, options) => {
      if (url === "/api/ovoko/year-suggestion") options.signal.addEventListener("abort", () => window.yearAborts.push(JSON.parse(options.body)));
      return nativeFetch(url, options);
    };
  });
  await page.route("https://year.test/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (!path.startsWith("/api/")) return route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
    const body = request.method() === "POST" ? request.postDataJSON() : null;
    calls.push({ path, body });
    assert.equal(request.headers().authorization, "Bearer fixture");
    if (path === "/api/account/me") return route.fulfill({ json: { access: { allowed: true } } });
    if (path === "/api/allegro/own-offers/123") {
      await holdSource?.promise;
      if (failSource) return route.fulfill({ status: 404, json: { message: "Oferta nie nalezy do konta." } });
      return route.fulfill({ json: { id: "123", name: `FORD S-MAX II MODUL EM2T-14F014-AA ${known === "source" ? "2016" : ""}`, stock: { available: 2 }, publication: { status: "ACTIVE" }, sellingMode: { price: { amount: "50", currency: "PLN" } }, parameters: [{ name: "Stan", values: ["Uzywany"] }] } });
    }
    if (path === "/api/ovoko/test") return route.fulfill({ json: { ok: true, readOnly: true, brands: [{ id: "5", name: "Ford" }] } });
    if (path === "/api/ovoko/read") {
      let rows = [];
      if (body.operation === "models") rows = [{ id: "42", name: "S-Max II", ...(known === "dictionary" ? { years: "2015 - 2023" } : {}) }, { id: "41", name: "Edge" }];
      if (body.operation === "cars") { await holdCars?.promise; rows = saved ? [{ id: "201", name: "Auto", years: "2019" }] : []; }
      return route.fulfill({ json: { ok: true, readOnly: true, operation: body.operation, rows } });
    }
    if (path === "/api/ovoko/year-suggestion") {
      assert.equal(request.method(), "POST");
      assert.deepEqual(Object.keys(body).sort(), ["brandId", "modelId", "number", "offerId"]);
      assert.ok(["EM2T-14F014-AA", "EM2T-14F014-AB"].includes(body.number));
      await holdEvidence?.promise;
      return route.fulfill({ json: { ok: true, readOnly: true, ...body, number: body.number.replaceAll("-", ""), year: body.modelId === "41" || body.number.endsWith("AB") ? "2021" : year, reason: "Dopasowanie numeru w istniejacej ofercie.", technical: true, source: "ovoko-part", sourceUrl: "https://example.com/part", ...(webCorrection && body.modelId === "42" ? {vehicleSuggestion:{brandId:"5",modelId:"41",year}} : {}), ...responseBinding } }).catch(() => {});
    }
    throw new Error(`Unexpected endpoint: ${path}`);
  });
  await page.goto("https://year.test/panel/inventory/prepare-ovoko?offerId=123");
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const lookupCalls = () => calls.filter(call => call.path === "/api/ovoko/year-suggestion");
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const input = page.getByLabel("Rok nowego rekordu auta", { exact: true });
  const openYear = async () => { await page.getByText("Dodaj brakujacy rekord auta do Ovoko", { exact: true }).click(); return input; };
  return { page, calls, errors, lookupCalls, settle, input, openYear };
}
try {
  for (const options of [{ saved: true }, { known: "source" }, { known: "dictionary" }]) {
    const f = await fixture(options);
    await f.page.getByText(options.saved ? /Wykorzystujemy zapisane auto/ : /Brak zapisanego auta/).waitFor();
    await f.settle();
    assert.equal(f.lookupCalls().length, 0, "Saved car and source/dictionary year skip evidence lookup");
    if (options.known) { await f.openYear(); assert.equal(await f.input.inputValue(), options.known === "source" ? "2016" : "2015"); }
    await f.page.close();
  }
  {
    const source = deferred(), cars = deferred(), evidence = deferred();
    const f = await fixture({ holdSource: source, holdCars: cars, holdEvidence: evidence });
    await f.settle(); assert.equal(f.calls.filter(call => call.path.startsWith("/api/ovoko/")).length, 0, "No reads before owned source initialization");
    source.resolve(); await f.page.getByLabel("Model auta Ovoko").locator('option[value="42"]').waitFor({ state: "attached" });
    await f.settle(); assert.equal(f.lookupCalls().length, 0, "Wait for completed cars read");
    cars.resolve(); await f.page.getByRole("status").filter({ hasText: "Szukam roku" }).waitFor();
    await f.openYear(); assert.equal(await f.input.isEnabled(), true);
    assert.equal(await f.page.getByRole("button", { name: "Wystaw w Ovoko", exact: true }).isDisabled(), true);
    evidence.resolve(); await f.page.waitForFunction(() => document.querySelector('input[maxlength="4"]')?.value === "2018");
    assert.equal(f.lookupCalls().length, 1);
    assert.equal(f.calls.filter(call => call.body?.operation === "cars").length, 1, "Evidence autofill does not reread cars");
    await f.page.getByText(/Rok techniczny z istniejacych ofert, nie potwierdza rocznika dawcy/).waitFor();
    assert.equal(await f.page.getByRole("link", { name: "Zrodlo podpowiedzi roku" }).getAttribute("href"), "https://example.com/part");
    assert.equal(await f.page.getByRole("button", { name: "Wystaw w Ovoko", exact: true }).isEnabled(), true);
    await f.page.getByLabel("ID rekordu auta w Ovoko (car_id)").fill("201"); await f.settle();
    assert.equal(await f.input.inputValue(), "2018", "Assigning the prepared car does not erase the evidence year");
    await f.page.close();
  }
  {
    const evidence = deferred(), f = await fixture({ holdEvidence: evidence });
    await f.page.getByRole("status").filter({ hasText: "Szukam roku" }).waitFor();
    await f.openYear(); await f.input.fill("2020");
    await f.page.waitForFunction(() => window.yearAborts.length === 1);
    evidence.resolve(); await f.settle(); assert.equal(await f.input.inputValue(), "2020", "Manual year wins over late evidence");
    assert.equal(await f.page.getByRole("button", { name: "Wystaw w Ovoko", exact: true }).isEnabled(), true);
    await f.page.close();
  }
  {
    const evidence = deferred(), f = await fixture({ holdEvidence: evidence });
    await f.page.getByRole("status").filter({ hasText: "Szukam roku" }).waitFor();
    await f.openYear(); await f.input.fill("20");
    evidence.resolve(); await f.page.getByText(/Rok techniczny z istniejacych ofert/).waitFor();
    assert.equal(await f.input.inputValue(), "20", "Even an incomplete manual edit is not overwritten");
    await f.page.getByLabel("Model auta Ovoko").selectOption("41");
    await f.page.waitForFunction(() => document.querySelector('input[maxlength="4"]')?.value === "2021");
    assert.equal(f.lookupCalls().at(-1).body.modelId, "41", "New model resets manual-year binding");
    await f.page.close();
  }
  {
    const evidence = deferred(), f = await fixture({ holdEvidence: evidence });
    await f.page.getByRole("status").filter({ hasText: "Szukam roku" }).waitFor();
    await f.openYear(); await f.page.getByLabel("Model auta Ovoko").selectOption("41");
    await f.page.waitForFunction(() => window.yearAborts.length === 1);
    assert.equal(await f.input.inputValue(), "", "Old-model year is not visible in new context");
    evidence.resolve();
    await f.page.waitForFunction(() => document.querySelector('input[maxlength="4"]')?.value === "2021");
    assert.deepEqual(f.lookupCalls().map(call => call.body.modelId), ["42", "41"]);
    await f.page.close();
  }
  {
    const evidence = deferred(), f = await fixture({ holdEvidence: evidence });
    await f.page.getByRole("status").filter({ hasText: "Szukam roku" }).waitFor();
    await f.openYear();
    await f.page.getByLabel("Numer katalogowy - opcjonalny", { exact: true }).fill("EM2T-14F014-AB");
    await f.page.waitForFunction(() => window.yearAborts.length === 1);
    evidence.resolve();
    await f.page.waitForFunction(() => document.querySelector('input[maxlength="4"]')?.value === "2021");
    assert.deepEqual(f.lookupCalls().map(call => call.body.number), ["EM2T-14F014-AA", "EM2T-14F014-AB"], "Full indexed number changes cancel and rebind lookup");
    await f.page.close();
  }
  {
    const cars = deferred(), f = await fixture({ holdCars: cars });
    await f.openYear(); await f.input.fill("2020");
    cars.resolve(); await f.page.getByText(/Brak zapisanego auta/).waitFor(); await f.settle();
    assert.equal(f.lookupCalls().length, 0, "Valid manual year entered before cars finish skips lookup");
    await f.page.close();
  }
  {
    const f = await fixture({ responseBinding: { modelId: "wrong" } });
    await f.page.getByText("Niepotwierdzony format podpowiedzi roku.", { exact: true }).waitFor();
    await f.openYear(); assert.equal(await f.input.inputValue(), "");
    await f.page.close();
  }
  {
    const f = await fixture({ failSource: true });
    await f.page.getByRole("alert").filter({ hasText: "Oferta nie nalezy" }).waitFor();
    assert.equal(f.calls.filter(call => call.path.startsWith("/api/ovoko/")).length, 0);
    await f.page.close();
  }
  {
    const f=await fixture({webCorrection:true});
    await f.page.waitForFunction(()=>document.querySelector('select[aria-label="Model auta Ovoko"]')?.value==="41");
    await f.openYear();await f.page.waitForFunction(()=>document.querySelector('input[maxlength="4"]')?.value==="2018");
    await f.settle();assert.equal(f.lookupCalls().length,1,"Sourced model correction does not start another paid year lookup");
    await f.page.getByRole("link",{name:"Zrodlo podpowiedzi roku"}).waitFor();await f.page.close();
  }
  {
    const held=deferred(),f=await fixture({webCorrection:true,holdEvidence:held});
    await f.page.getByRole("status").filter({hasText:"Szukam roku"}).waitFor();await f.openYear();await f.input.fill("20");
    held.resolve();await f.page.getByText(/Reczny model pozostawiono bez zmian/).waitFor();
    assert.equal(await f.page.getByLabel("Model auta Ovoko").inputValue(),"42");assert.equal(await f.input.inputValue(),"20","Manual year edit prevents late model replacement");await f.page.close();
  }
  assert.deepEqual(errors, []);
  console.log("Single year evidence browser: saved/known/manual skips, ownership/cars gates, technical autofill, manual edit priority, model/number cancellation/reset and stale response rejection passed. Mock services only.");
} finally { await browser.close(); }
