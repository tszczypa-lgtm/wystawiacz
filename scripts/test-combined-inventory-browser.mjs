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
  let admin = true, ovokoFail = false, identityReads = 0, changedAccount = false;
  const errors = [], operations = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("https://combined.test/**", async route => {
    const req = route.request(), url = new URL(req.url());
    if (!url.pathname.startsWith("/api/")) return route.fulfill({ contentType: "text/html", body: '<html><body style="background:#0d1117;color:white"><main id="root" style="padding:12px"></main></body></html>' });
    operations.push(url.pathname);
    if (url.pathname === "/api/account/me") return route.fulfill({ json: { isAdmin: admin, account: { email: "fixture@test", suspended: false } } });
    if (url.pathname === "/api/allegro/seller-identity") { identityReads++; return route.fulfill({ json: { sellerId: changedAccount && identityReads > 1 ? "666" : "555" } }); }
    if (url.pathname === "/api/allegro/inventory") return route.fulfill({ json: { offers: Array.from({ length: 44 }, (_, i) => ({ id: String(i + 1), name: `Radio ABC123456 egzemplarz ${i + 1}`, image: "", externalId: "", status: "ACTIVE", stock: 1, price: { amount: "50.00", currency: "PLN" } })), totalCount: 44 } });
    if (url.pathname === "/api/ovoko/transfer-inventory") { assert.ok(admin); assert.equal(req.postDataJSON().operation, "statuses"); return route.fulfill({ json: { ok: true, statuses: { "2": { state: "transferred", partId: "999" } } } }); }
    if (url.pathname === "/api/ovoko/status") { assert.ok(admin); return route.fulfill({ json: { allowed: true, connected: true, verifiedAt: "fixture-binding" } }); }
    if (url.pathname === "/api/ovoko/read") {
      assert.ok(admin); assert.equal(req.method(), "POST"); const body = req.postDataJSON(); assert.equal(body.useSaved, true);
      if (body.operation === "statuses") return route.fulfill({ json: { ok: true, readOnly: true, rows: [{ id: "0", name: "Na stanie" }, { id: "1", name: "Sprzedano" }] } });
      assert.equal(body.operation, "inventory"); if (ovokoFail) return route.fulfill({ status: 503, json: { message: "Awaria odczytu fixture" } });
      return route.fulfill({ json: { ok: true, readOnly: true, rows: [{ id: "10", name: "Radio", externalId: "tymo:555:1", manufacturerCode: "ABC123456", status: "0", price: "100.00" }, { id: "11", name: "Samodzielna czesc Ovoko", externalId: "", manufacturerCode: "ABC123456", status: "0", price: "100.00" }, { id: "12", name: "Sprzedana czesc Ovoko", status: "1" }], pagination: { page: body.page, limit: 100, total: 3 } } });
    }
    throw new Error(`Unexpected endpoint ${url.pathname}`);
  });
  async function open() { identityReads = 0; await page.goto("https://combined.test/panel/inventory"); await page.addStyleTag({ content: css.css }); await page.addScriptTag({ content: bundle.outputFiles[0].text }); await page.locator('[data-part-key="o:11"]').waitFor(); await page.getByText(/Odczyt niepelny/).waitFor({ state: "hidden" }); }
  await open();
  const table = page.getByRole("table", { name: "Czesci Allegro i Ovoko" });
  assert.equal(await table.locator("tbody tr").count(), 45, "44 Allegro plus one Ovoko-only, linked part appears once");
  assert.equal(await table.locator('[data-part-key="a:1"]').getByLabel("Ovoko: na stanie", { exact: true }).count(), 1);
  assert.equal(await table.locator('[data-part-key="a:2"]').getByLabel("Ovoko: brak", { exact: true }).count(), 1, "Deleted journal target is not an active Ovoko badge");
  await page.getByLabel("Obecnosc na portalach").selectOption("both"); assert.equal(await table.locator("tbody tr").count(), 1);
  await page.getByLabel("Obecnosc na portalach").selectOption("ovoko"); assert.equal(await table.locator("tbody tr").count(), 1);
  await page.getByLabel("Obecnosc na portalach").selectOption("all");
  await page.getByRole("checkbox", { name: "Allegro", exact: true }).uncheck(); assert.equal(await table.locator("tbody tr").count(), 2);
  await page.getByRole("checkbox", { name: "Allegro", exact: true }).check(); await page.getByRole("checkbox", { name: "Ovoko", exact: true }).uncheck(); assert.equal(await table.locator("tbody tr").count(), 44);
  await page.getByRole("checkbox", { name: "Ovoko", exact: true }).check();
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
  await page.getByLabel("Obecnosc na portalach").selectOption("allegro"); assert.equal(await table.locator("tbody tr").count(), 0, "Provider failure does not prove Allegro-only");
  assert.deepEqual(errors, []);
  console.log("Combined browser: one dense list, union portal filters, live badges, separate prices, source range, 200/page, partial-error safety, responsive layout and read-only operations passed.");
} finally { await browser.close(); }
