import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { pathToFileURL, fileURLToPath } from "node:url";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const root = fileURLToPath(new URL("../", import.meta.url));
const css = await postcss([tailwind({ base: root })]).process(await readFile(new URL("../app/globals.css", import.meta.url), "utf8"), { from: fileURLToPath(new URL("../app/globals.css", import.meta.url)) });
const bundle = await build({ stdin: { contents: 'import React from "react";import {createRoot} from "react-dom/client";import {CombinedInventoryPanel} from "./app/panel/inventory/combined-panel";import {AccountShell} from "./app/panel/account-shell";createRoot(document.getElementById("root")).render(<AccountShell active="/panel/inventory"><CombinedInventoryPanel/></AccountShell>);', resolveDir: root, loader: "tsx" }, bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "mock-session", setup(builder) { builder.onResolve({ filter: /^(\.\/supabase|@\/lib\/supabase)$/ }, () => ({ path: "session", namespace: "fixture" })); builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: 'export function createSupabaseBrowserClient(){return{auth:{getSession:async()=>({data:{session:{access_token:"fixture-only"}}})}}}', loader: "js" })); } }] });
const browser = await chromium.launch({ headless: true, channel: "chrome" });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  let admin = false, ovokoFail = false, identityReads = 0, changedAccount = false, reviewFailure;
  const errors = [], operations = [], withdrawalCalls = [];
  const syncControls = []; let syncEnabled = false;
  page.on("pageerror", error => errors.push(error.message));
  await page.route("https://combined.test/**", async route => {
    const req = route.request(), url = new URL(req.url());
    if (!url.pathname.startsWith("/api/")) return route.fulfill({ contentType: "text/html", body: '<html><body style="background:#0d1117;color:white"><main id="root" style="padding:12px"></main></body></html>' });
    operations.push(url.pathname);
    if (url.pathname === "/api/account/me") return route.fulfill({ json: { isAdmin: admin, access: { allowed: true }, account: { email: "fixture@test", suspended: false } } });
    if (url.pathname === "/api/allegro/seller-identity") { identityReads++; return route.fulfill({ json: { sellerId: changedAccount && identityReads > 1 ? "666" : "555" } }); }
    if (url.pathname === "/api/ovoko/sales-sync") {
      const body = req.postDataJSON(); syncControls.push(body);
      if (body.operation === "enable") { assert.equal(body.confirm, true); syncEnabled = true; }
      if (body.operation === "disable") syncEnabled = false;
      return route.fulfill({ json: { configured: true, enabled: syncEnabled, direction: "allegro_to_ovoko", reverseEnabled: false, lastChecked: null, lastError: null, caughtUp: true, armedAt: null, jobs: [] } });
    }
    if (url.pathname === "/api/allegro/inventory-withdrawal") {
      const input = req.postDataJSON(); withdrawalCalls.push(input);
      const job = { id: "11111111-1111-4111-8111-111111111111", offerId: "1", partId: "10", scope: "both", state: "prepared", allegro: "pending", ovoko: "pending" };
      if (input.operation === "prepare") assert.deepEqual(input, { operation: "prepare", offerId: "1", partId: "10", scope: "both" });
      else { assert.equal(input.jobId, job.id); job.state = "settled"; job.allegro = input.operation === "status" ? "done" : "submitted"; job.ovoko = "uncertain"; if (input.operation === "execute") assert.equal(input.confirm, true); else assert.equal(input.operation, "status"); }
      return route.fulfill({ json: job });
    }
    if (url.pathname === "/api/allegro/inventory") return route.fulfill({ json: { offers: Array.from({ length: 44 }, (_, i) => ({ id: String(i + 1), name: `Radio ABC123456 egzemplarz ${i + 1}`, image: "", externalId: "", status: "ACTIVE", stock: 1, price: { amount: "50.00", currency: "PLN" } })), totalCount: 44 } });
    if (url.pathname === "/api/ovoko/transfer-inventory") { assert.equal(req.postDataJSON().operation, "statuses"); return route.fulfill({ json: { ok: true, statuses: { "2": { state: "transferred", partId: "999" } } } }); }
    if (url.pathname === "/api/ovoko/status") { return route.fulfill({ json: { allowed: true, connected: true, verifiedAt: "fixture-binding" } }); }
    if (url.pathname === "/api/ovoko/coordination-review") {
      assert.deepEqual(req.postDataJSON(), { offerIds: ["1"] });
      if (reviewFailure) return route.fulfill({ status: reviewFailure.status, json: reviewFailure });
      return route.fulfill({ json: { readOnly: true, automatic: false, eventsRead: 1, partial: false, scope: "Zakres kontrolny", rows: [{ offerId: "1", partId: "10", name: "Radio ABC123456", allegroStatus: "ACTIVE", stock: 1, ovokoStatus: "stock", decision: { status: "idle", action: null, reason: "Brak potwierdzonej sprzedazy." }, withdrawal: { allegro: true, ovoko: true, both: true } }] } });
    }
    if (url.pathname === "/api/ovoko/read") {
      assert.equal(req.method(), "POST"); const body = req.postDataJSON(); assert.equal(body.useSaved, true);
      if (body.operation === "statuses") return route.fulfill({ json: { ok: true, readOnly: true, rows: [{ id: "0", name: "Na stanie" }, { id: "1", name: "Sprzedano" }, { id: "4", name: "Wycofany" }] } });
      assert.equal(body.operation, "inventory"); if (ovokoFail) return route.fulfill({ status: 503, json: { message: "Awaria odczytu fixture" } });
      return route.fulfill({ json: { ok: true, readOnly: true, rows: [{ id: "10", name: "Radio", externalId: "tymo:555:1", manufacturerCode: "ABC123456", status: "0", price: "100.00" }, { id: "11", name: "Samodzielna czesc Ovoko", externalId: "", manufacturerCode: "ABC123456", status: "0", price: "100.00" }, { id: "12", name: "Sprzedana czesc Ovoko", status: "1" }, { id: "13", name: "Wycofana czesc Ovoko", status: "4" }], pagination: { page: body.page, limit: 100, total: 4 } } });
    }
    throw new Error(`Unexpected endpoint ${url.pathname}`);
  });
  async function open() { identityReads = 0; await page.goto("https://combined.test/panel/inventory"); await page.addStyleTag({ content: css.css }); await page.addScriptTag({ content: bundle.outputFiles[0].text }); await page.locator('[data-part-key="o:11"]').waitFor(); await page.getByText(/Odczyt niepelny/).waitFor({ state: "hidden" }); }
  await open();
  assert.equal(await page.getByRole("link", { name: "Administrator", exact: true }).count(), 0, "Ordinary users get inventory tools, not administrator privileges");
  await page.getByLabel("Szukaj czesci").fill("abc123 radio"); assert.equal(await page.getByRole("table", { name: "Czesci Allegro i Ovoko" }).locator("tbody tr").count(),44); await page.getByLabel("Szukaj czesci").fill("");
  await page.getByText("Wiecej", { exact: true }).click(); await page.getByLabel("Sortowanie czesci").selectOption("-age"); assert.equal(await page.locator("[data-part-key]").first().getAttribute("data-part-key"),"a:44"); await page.getByLabel("Sortowanie czesci").selectOption("ovoko_price"); assert.equal(await page.locator("[data-part-key]").first().getAttribute("data-part-key"),"a:1"); await page.getByLabel("Sortowanie czesci").selectOption("source"); await page.getByText("Wiecej", { exact: true }).click();
  assert.equal(syncControls.length, 0, "Opening the list never arms or even probes the background monitor");
  assert.equal(await page.getByRole("link", { name: "Synchronizacja", exact: true }).count(), 1);
  assert.equal(await page.getByRole("link", { name: "Zarezerwowane", exact: true }).count(), 1);
  assert.equal(await page.getByRole("link", { name: "Do Ovoko", exact: true }).count(), 44);
  await page.evaluate(() => { window.open = (url, name, features) => { window.manualPopup = {url,name,features}; return { opener: window, focus() {} }; }; });
  await page.getByRole("link", { name: "Do Ovoko", exact: true }).first().click();
  assert.deepEqual(await page.evaluate(() => window.manualPopup), {url:"/panel/inventory/prepare-ovoko?offerId=1&popup=1",name:"ovoko-manual-1",features:"popup,width=1150,height=900,scrollbars=yes,resizable=yes"});
  const table = page.getByRole("table", { name: "Czesci Allegro i Ovoko" });
  assert.equal(await table.locator("tbody tr").count(), 45, "44 Allegro plus one Ovoko-only, linked part appears once");
  assert.equal(await table.locator('[data-part-key="a:1"]').getByLabel("Ovoko: na stanie", { exact: true }).count(), 1);
  assert.equal(await table.locator('[data-part-key="a:2"]').getByLabel("Ovoko: brak", { exact: true }).count(), 1, "Deleted journal target is not an active Ovoko badge");
  const channel = page.getByLabel("Kanal sprzedazy");
  for (const [value, count] of [["both", 1], ["only_ovoko", 1], ["only_allegro", 43], ["ovoko", 2], ["allegro", 44], ["all", 45]]) {
    await channel.selectOption(value); assert.equal(await table.locator("tbody tr").count(), count);
  }
  assert.equal(await page.getByRole("checkbox", { name: "Allegro", exact: true }).count(), 0, "No duplicate channel controls");
  assert.equal(await page.getByLabel("Status sprzedazy").count(), 0);
  await page.getByRole("tab", { name: "Zakonczone", exact: true }).click(); assert.equal(await table.locator("tbody tr").count(), 1); assert.ok(await table.locator('[data-part-key="o:13"]').isVisible());
  await page.getByRole("tab", { name: "Sprzedane", exact: true }).click(); assert.equal(await table.locator("tbody tr").count(), 1); assert.ok(await table.locator('[data-part-key="o:12"]').isVisible());
  await page.getByRole("button", { name: "Wyczysc", exact: true }).click(); assert.equal(await table.locator("tbody tr").count(), 45, "Clear also resets lifecycle status");
  await table.locator('[data-part-key="a:1"]').getByRole("checkbox").check();
  await page.getByRole("button", { name: "Wycofaj zaznaczone", exact: true }).click();
  const batch = page.getByRole("dialog", { name: "Zbiorcze wycofanie", exact: true });
  await batch.getByRole("button", { name: "Potwierdz wycofanie zaznaczonych", exact: true }).waitFor();
  assert.equal(operations.filter(p => p === "/api/ovoko/inventory-actions").length, 0, "Opening batch scope never mutates or prepares records");
  await batch.getByRole("button", { name: "Zamknij", exact: true }).click();
  await table.locator('[data-part-key="a:1"]').locator("summary").click();
  assert.equal(await table.locator('[data-part-key="a:1"]').getByRole("link",{name:"Edytuj w Allegro",exact:true}).getAttribute("href"),"https://allegro.pl/offer/1/edit");
  assert.match(await table.locator('[data-part-key="a:1"]').getByRole("link",{name:"Edytuj w Wystawiaczu",exact:true}).getAttribute("href"),/editAllegro=1/);
  await table.locator('[data-part-key="a:1"]').getByRole("button", { name: "Wycofaj", exact: true }).click();
  const withdraw = page.getByRole("dialog", { name: "Wycofaj ze sprzedazy" });
  await withdraw.getByLabel("Zakres wycofania").selectOption("both");
  assert.equal(withdrawalCalls.length, 0, "Opening/scope selection never changes anything");
  await withdraw.getByRole("button", { name: "Sprawdz i przygotuj", exact: true }).click();
  await withdraw.getByRole("button", { name: "Potwierdz wycofanie: oba portale", exact: true }).waitFor();
  assert.deepEqual(withdrawalCalls.map(call => call.operation), ["prepare"], "Preparation needs a second explicit confirmation");
  await withdraw.getByRole("button", { name: "Potwierdz wycofanie: oba portale", exact: true }).click();
  await withdraw.getByText(/Niepewny wynik: sprawdz portal/).waitFor();
  assert.equal(await withdraw.getByRole("button", { name: /Potwierdz wycofanie/ }).count(), 0, "Never expose a retry after an uncertain write");
  await withdraw.getByRole("button", { name: "Sprawdz wynik (bez ponawiania)", exact: true }).click();
  await withdraw.getByText(/Allegro: Potwierdzone wycofanie/).waitFor();
  assert.deepEqual(withdrawalCalls.map(call => call.operation), ["prepare", "execute", "status"]);
  await withdraw.getByRole("button", { name: "Zamknij", exact: true }).click();
  await page.getByLabel("Cena Allegro od").fill("48"); await page.getByLabel("Cena Allegro do").fill("52"); assert.equal(await table.locator("tbody tr").count(), 44);
  await page.getByRole("button", { name: "Wyczysc", exact: true }).click(); await page.getByLabel("Czesci na stronie").selectOption("20"); assert.equal(await table.locator("tbody tr").count(), 20);
  await page.getByRole("button", { name: "Nastepna", exact: true }).click(); await page.getByText("Strona 2 / 3", { exact: true }).waitFor();
  await page.getByLabel("Czesci na stronie").selectOption("200"); assert.equal(await table.locator("tbody tr").count(), 45);
  const height = await table.locator("tbody tr").first().evaluate(element => element.getBoundingClientRect().height); assert.ok(height <= 44, `Compact row is ${height}px`);
  await page.evaluate(() => window.scrollTo(0, 0));
  const toolbarHeight = await page.getByLabel("Filtry czesci", { exact: true }).evaluate(element => element.getBoundingClientRect().height); assert.ok(toolbarHeight <= 50, `Thin desktop filter bar is ${toolbarHeight}px`);
  await mkdir(new URL("../outputs/combined-inventory/", import.meta.url), { recursive: true }); await page.screenshot({ path: fileURLToPath(new URL("../outputs/combined-inventory/desktop.png", import.meta.url)) });
  await page.setViewportSize({ width: 390, height: 844 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await page.screenshot({ path: fileURLToPath(new URL("../outputs/combined-inventory/mobile.png", import.meta.url)) });
  assert.ok(operations.every(path => !/publish|bulk|create-car|disconnect|connect$/.test(path)), "Opening/filtering the list never changes provider data");
  ovokoFail = true; await page.getByRole("button", { name: "Odswiez", exact: true }).click(); await page.getByText(/Awaria odczytu fixture/).waitFor();
  assert.equal(await table.locator('[data-part-key="a:1"]').getByLabel("Ovoko: nieustalone", { exact: true }).count(), 1);
  await page.getByLabel("Kanal sprzedazy").selectOption("only_allegro"); assert.equal(await table.locator("tbody tr").count(), 0, "Provider failure does not prove Allegro-only");
  assert.deepEqual(errors, []);
  console.log("Combined browser: dense filters, live badges, 200/page, read-only review, two-step scoped withdrawal, independent results/no retry, partial-error safety and responsive layout passed. All services mocked.");
} finally { await browser.close(); }
