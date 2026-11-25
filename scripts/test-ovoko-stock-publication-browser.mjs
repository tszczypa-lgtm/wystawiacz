import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const root = fileURLToPath(new URL("../", import.meta.url));
const bundle = await build({ stdin: { contents: 'import React from "react";import {createRoot} from "react-dom/client";import {OvokoBulkPanel} from "./app/panel/inventory/ovoko-bulk-panel";import {OvokoPreparationPanel} from "./app/panel/inventory/prepare-ovoko/preparation-panel";createRoot(document.getElementById("root")).render(location.pathname==="/single"?<OvokoPreparationPanel/>:<OvokoBulkPanel offers={[{id:"101",name:"AUDI A4 B9 POMPA 0281010038",price:{amount:"100.00",currency:"PLN"}}]} onFinished={()=>{}}/>);', resolveDir: root, loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "session", setup(b) {
  b.onResolve({ filter: /(?:^@\/lib\/|^\.\/)supabase$/ }, () => ({ path: "session", namespace: "fixture" }));
  b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: 'export function createSupabaseBrowserClient(){return{auth:{getSession:async()=>({data:{session:{access_token:"fixture",user:{id:"owner"}}}})}}}', loader: "js" }));
} }] });
const browser = await chromium.launch({ headless: true, channel: "chrome" });
try {
  const page = await browser.newPage(), errors = [];
  let calls = [], scenario = "normal", sent = 0;
  page.on("pageerror", error => errors.push(error.message));
  const source = { id: "101", name: "AUDI A4 B9 POMPA 0281010038", publication: { status: "ACTIVE" }, stock: { available: 2 }, productSet: [{ quantity: { value: 1 }, product: {} }], parameters: [{ id: "11323", valuesIds: ["11323_2"] }], sellingMode: { price: { amount: "100.00", currency: "PLN" } }, images: ["https://a.allegroimg.com/photo.jpg"] };
  const prepared = { brandId: "1", modelId: "11", donorId: "13", categoryId: "3", qualityId: "0", statusId: "0", manufacturerCode: "0281010038", additionalCodes: "" };
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.hostname === "a.allegroimg.com") return route.fulfill({ status: 204 });
    assert.equal(url.origin, "https://stock.test");
    if (!url.pathname.startsWith("/api/")) return route.fulfill({ contentType: "text/html", body: '<html><body><div id="root"></div></body></html>' });
    const body = request.method() === "POST" ? request.postDataJSON() : null;
    calls.push({ path: url.pathname, body, time: Date.now() });
    if (url.pathname === "/api/account/me") return route.fulfill({ json: { isAdmin: true, access: { allowed: true } } });
    if (url.pathname === "/api/allegro/own-offers/101") return route.fulfill({ json: source });
    if (url.pathname === "/api/allegro/ovoko-source/101") return route.fulfill({ json: { offer: source, sellerId: "555" } });
    if (url.pathname === "/api/allegro/shipping-rates") return route.fulfill({ json: { shippingRates: [] } });
    if (url.pathname === "/api/ovoko/test") return route.fulfill({ json: { ok: true, readOnly: true, brands: [{ id: "1", name: "Audi" }] } });
    if (url.pathname === "/api/ovoko/read") {
      const rows = { categories: [{ id: "3", name: "Pompy", level: "3" }], qualities: [{ id: "0", name: "Uzywany" }], statuses: [{ id: "0", name: "Na stanie" }], models: [{ id: "11", name: "A4 (B9)", years: "2015 - 2024" }], cars: [{ id: "13", name: "Audi A4", modelId: "11", years: "2015" }] }[body.operation];
      assert.ok(rows);
      return route.fulfill({ json: { ok: true, readOnly: true, operation: body.operation, rows } });
    }
    if (url.pathname === "/api/ovoko/bulk" && body.operation === "start") return route.fulfill({ json: { ok: true, binding: { sellerId: "555", fingerprint: "fixture" } } });
    if (url.pathname === "/api/ovoko/bulk" && body.operation === "prepare") {
      if(scenario==="pending-stop" || scenario==="pending" && calls.filter(call=>call.body?.operation==="prepare").length===1)return route.fulfill({json:{ok:true,webPending:true,retryAfter:3,message:"Trwa wyszukiwanie modelu i roku w internecie."}});
      return route.fulfill({ json: scenario === "already" ? { ok: true, alreadyCreated: true, partId: "78", completedUnits: 2, totalUnits: 2, moreUnits: false, initialStock: 2 } : { ok: true, prepared,vehicle:{brand:"Audi",model:"A4 B9",usedFallback:false,sourceUrl:"https://example.com/source"} } });
    }
    assert.ok(url.pathname === "/api/ovoko/publish" || url.pathname === "/api/ovoko/bulk" && body.operation === "item", `Unexpected ${url.pathname}`);
    sent++;
    if (scenario === "uncertain" && sent === 2) return route.fulfill({ status: 409, json: { message: "Niepewny wynik; potwierdzono 1/2", code: "stock_publication_locked" } });
    const count = body.stockMode === "shared" ? 1 : 2;
    return route.fulfill({ json: { ok: true, partId: String(77 + sent), completedUnits: sent, totalUnits: count, initialStock: 2, moreUnits: sent < count, alreadyCreated: scenario === "item-already", binding: { sellerId: "555", fingerprint: "a".repeat(64) } } });
  });
  const mount = async (single = false) => {
    calls = []; sent = 0;
    await page.goto(`https://stock.test/${single ? "single?offerId=101" : "bulk"}`);
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.getByLabel("Jedna pozycja dla calego zapasu (zalecane)").waitFor();
    assert.equal(await page.getByLabel("Jedna pozycja dla calego zapasu (zalecane)").isChecked(), true);
    if (single) {
      await page.getByLabel("Model auta Ovoko").locator('option[value="11"]').waitFor({ state: "attached" });
      await page.getByLabel("ID rekordu auta w Ovoko (car_id)").fill("13");
      await page.getByLabel("Kategoria Ovoko", { exact: true }).selectOption("3");
      await page.getByLabel("Jakosc czesci Ovoko", { exact: true }).selectOption("0");
      await page.getByLabel("Status rekordu Ovoko", { exact: true }).selectOption("0");
    }
  };
  const bulkStart = () => page.getByRole("button", { name: "Przenies zaznaczone do Ovoko", exact: true }).click();
  const items = () => calls.filter(call => call.body?.operation === "item");
  await mount(); await page.getByLabel("Kazda sztuka osobno").check();
  await page.getByLabel("Cena w Ovoko").selectOption("fixed"); await page.getByLabel("Konkretna cena w walucie oferty").fill("125");
  await bulkStart();
  const row = page.locator('[data-offer-id="101"]');
  await row.getByText(/Potwierdzono rekordy Ovoko: 1\/2/).waitFor();
  assert.equal(sent, 1); assert.doesNotMatch(await row.innerText(), /Przeniesiono\./, "First unit does not finish the row");
  await page.getByRole("status").filter({ hasText: "Partia zakonczona" }).waitFor({ timeout: 15000 });
  assert.match(await row.innerText(), /Rekordy Ovoko: 2\/2/); assert.equal(items().length, 2);
  assert.deepEqual(items()[0].body, items()[1].body, "Continuation retains prepared fields, price rule, mode and original source snapshot");
  assert.ok(items()[1].time - items()[0].time >= 6000, "Unit imports are paced at 6250 ms");
  assert.equal(calls.filter(call => call.body?.operation === "prepare").length, 1);
  await mount(); await bulkStart(); await page.getByRole("status").filter({ hasText: "Partia zakonczona" }).waitFor();
  assert.equal(sent, 1); assert.equal(items()[0].body.stockMode, "shared"); assert.match(await row.innerText(), /Rekordy Ovoko: 1\/1; zapas poczatkowy: 2/);
  scenario = "already"; await mount(); await bulkStart(); await page.getByRole("status").filter({ hasText: "Partia zakonczona" }).waitFor();
  assert.equal(sent, 0, "Already-created preparation never imports another unit");
  scenario = "item-already"; await mount(); await page.getByLabel("Kazda sztuka osobno").check(); await bulkStart();
  await page.getByRole("status").filter({ hasText: "Partia zakonczona" }).waitFor(); assert.equal(sent, 1, "Even an alreadyCreated item with moreUnits never imports again");
  scenario = "uncertain"; await mount(); await page.getByLabel("Kazda sztuka osobno").check(); await bulkStart();
  await page.getByRole("status").filter({ hasText: "Partia zakonczona" }).waitFor({ timeout: 15000 });
  assert.equal(sent, 2); assert.match(await row.innerText(), /1\/2.*Niepewny wynik/);
  assert.equal(await row.getByRole("button", { name: /Odblokuj|Wymus/ }).count(), 0, "Legacy force-unlock cannot repair stock unit tables");
  scenario = "normal"; await mount(true); await page.getByLabel("Kazda sztuka osobno").check();
  await page.getByRole("button", { name: "Wystaw w Ovoko", exact: true }).click();
  await page.getByRole("status").filter({ hasText: /rekordy Ovoko: 1\/2/ }).waitFor({ timeout: 10000 }).catch(async error => { console.error(await page.locator("body").innerText(), calls, errors); throw error; }); assert.equal(sent, 1);
  await page.getByRole("status").filter({ hasText: /rekordy Ovoko: 2\/2/ }).waitFor({ timeout: 15000 });
  const publications = calls.filter(call => call.path === "/api/ovoko/publish");
  assert.equal(publications.length, 2); assert.deepEqual({ ...publications[0].body, binding: { sellerId: "555", fingerprint: "a".repeat(64) } }, publications[1].body); assert.ok(publications[1].time - publications[0].time >= 6000);
  await mount(true); await page.getByRole("button", { name: "Wystaw w Ovoko", exact: true }).click();
  await page.getByRole("status").filter({ hasText: /rekordy Ovoko: 1\/1/ }).waitFor(); assert.equal(sent, 1);
  assert.equal(calls.find(call => call.path === "/api/ovoko/publish").body.stockMode, "shared");
  scenario="pending";await mount();await bulkStart();await row.getByText("Trwa wyszukiwanie modelu i roku w internecie.",{exact:true}).waitFor();
  assert.equal(sent,0,"No part import while the web lookup is pending");
  await page.getByRole("status").filter({hasText:"Partia zakonczona"}).waitFor({timeout:15000});
  assert.equal(sent,1);assert.equal(calls.filter(call=>call.body?.operation==="prepare").length,2);assert.equal(items().length,1,"Only read-only preparation is polled");
  assert.equal(await row.getByRole("link",{name:"Zrodlo modelu i roku"}).getAttribute("href"),"https://example.com/source");
  scenario="pending-stop";await mount();await bulkStart();await row.getByText("Trwa wyszukiwanie modelu i roku w internecie.",{exact:true}).waitFor();
  await page.getByRole("button",{name:"Zatrzymaj po biezacej"}).click();await page.getByRole("status").filter({hasText:"Zatrzymano"}).waitFor();assert.equal(sent,0);
  assert.deepEqual(errors, []);
  console.log("Stock publication UI: both mode defaults/selectors, stable prepared item/snapshot/price, paced partial continuation, shared 1/1, already-created short circuits and no legacy unlock for uncertain units passed. All APIs mocked.");
} finally { await browser.close(); }
