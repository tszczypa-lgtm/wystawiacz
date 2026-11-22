import assert from "node:assert/strict";
import { pathToFileURL, fileURLToPath } from "node:url";
import { readFileSync, mkdirSync } from "node:fs";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const root = fileURLToPath(new URL("../", import.meta.url));
const css = await postcss([tailwind({ base: root })]).process(readFileSync(new URL("../app/globals.css", import.meta.url), "utf8"), { from: fileURLToPath(new URL("../app/globals.css", import.meta.url)) });
const bundle = await build({ stdin: { contents: 'import React from "react"; import { createRoot } from "react-dom/client"; import { InventoryViews } from "./app/panel/inventory/inventory-views"; import { OvokoInventoryPanel } from "./app/panel/inventory/ovoko/ovoko-inventory-panel"; createRoot(document.getElementById("root")).render(<><InventoryViews active="ovoko"/><OvokoInventoryPanel/></>);', resolveDir: root, loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "session", setup(builder) {
  builder.onResolve({ filter: /^@\/lib\/(supabase|account-client)$/ }, args => ({ path: args.path, namespace: "fixture" }));
  builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path.endsWith("supabase") ? 'export function createSupabaseBrowserClient(){return {auth:{getSession:async()=>({data:{session:{access_token:"fixture"}}})}}}' : 'export async function accountRequest(){return {isAdmin:window.fixtureAdmin}}', loader: "js" }));
} }] });
const browser = await chromium.launch({ headless: true, channel: "chrome" });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } }), errors = [], calls = [];
  let mode = "ok", connected = true, admin = true;
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.hostname === "images.ovoko.com") return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#eeeeee"/><rect x="8" y="20" width="48" height="24" rx="4" fill="#666666"/><text x="18" y="36" font-size="12" fill="white">PDC</text></svg>' });
    assert.equal(url.origin, "https://inventory.test", "No arbitrary remote images or navigation");
    if (!url.pathname.startsWith("/api/")) return route.fulfill({ contentType: "text/html", body: `<html><body style="background:#0d1117;color:white"><main id="root" style="max-width:1040px;margin:auto;padding:20px"></main><script>window.fixtureAdmin=${admin}</script></body></html>` });
    if (url.pathname === "/api/ovoko/status") return route.fulfill({ status: admin ? 200 : 403, json: admin ? { allowed: true, connected } : { message: "Tylko administrator" } });
    assert.equal(url.pathname, "/api/ovoko/read", "No mutation, car, storage or Allegro endpoints"); assert.equal(request.method(), "POST");
    const body = request.postDataJSON(); calls.push(body); assert.equal(body.useSaved, true);
    assert.ok(!body.username && !body.password && !body.owner_id && !body.url);
    if (body.operation !== "inventory") {
      assert.ok(["statuses", "qualities", "categories"].includes(body.operation));
      return route.fulfill({ json: { ok: true, readOnly: true, operation: body.operation, rows: body.operation === "statuses" ? [{ id: "0", name: "Na stanie" }, { id: "2", name: "Sprzedano" }] : body.operation === "qualities" ? [{ id: "0", name: "Uzywany" }] : [{ id: "1155", name: "Sterowniki parkowania" }] } });
    }
    assert.deepEqual(Object.keys(body).sort(), ["limit", "operation", "page", "sort", "useSaved", body.externalId !== undefined ? "externalId" : "search"].sort());
    if (mode === "error") return route.fulfill({ status: 502, json: { message: "Blad odczytu testowy" } });
    if (body.search === "slow") await new Promise(resolve => setTimeout(resolve, 500));
    const total = mode === "empty" || body.search === "missing" ? 0 : body.search || body.externalId ? 1 : 51;
    const count = Math.max(0, Math.min(body.limit, total - (body.page - 1) * body.limit));
    const rows = Array.from({ length: count }, (_, index) => ({ id: String((body.page - 1) * body.limit + index + 20), name: `Sterownik PDC Kangoo III ${body.search || ""}`, manufacturerCode: "259903137R", image: index % 2 ? "" : "https://images.ovoko.com/test.jpg", carId: "36", categoryId: "1155", status: index % 2 ? "2" : "0", quality: "0", price: "125.50", externalId: "tymo:1:19034424564" }));
    return route.fulfill({ json: { ok: true, readOnly: true, code: "R200", operation: mode === "invalid" ? "categories" : "inventory", checkedAt: new Date().toISOString(), rows, pagination: { page: body.page, limit: body.limit, total } } });
  });
  async function mount() { await page.goto("https://inventory.test/"); await page.addStyleTag({ content: css.css }); await page.addScriptTag({ content: bundle.outputFiles[0].text }); }
  const table = page.getByRole("table", { name: "Rekordy czesci Ovoko" });
  const inventoryCalls = () => calls.filter(call => call.operation === "inventory");
  await mount(); await table.waitFor(); await page.getByRole("cell", { name: /Sterowniki parkowania/ }).first().waitFor();
  assert.equal(inventoryCalls().length, 1, "Opening automatically reads exactly one inventory page, no crawling");
  assert.equal(await page.getByRole("button", { name: /Pobierz pierwsze/ }).count(), 0);
  assert.equal(await page.locator("tbody tr").count(), 50); assert.equal(await page.locator("tbody img").count(), 25);
  await page.getByLabel("Zaznacz czesc 20", { exact: true }).check(); assert.equal(await page.getByLabel("Zaznacz czesc 20", { exact: true }).isChecked(), true);
  const beforeLocal = inventoryCalls().length;
  await page.getByLabel("Status (na stronie)", { exact: true }).selectOption("2"); assert.equal(await page.locator("tbody tr").count(), 25);
  assert.equal(inventoryCalls().length, beforeLocal); await page.getByLabel("Status (na stronie)", { exact: true }).selectOption("");
  mkdirSync(new URL("../outputs/ovoko-inventory-preview/", import.meta.url), { recursive: true });
  await page.screenshot({ path: fileURLToPath(new URL("../outputs/ovoko-inventory-preview/desktop.png", import.meta.url)), fullPage: false });
  await page.setViewportSize({ width: 390, height: 844 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: fileURLToPath(new URL("../outputs/ovoko-inventory-preview/mobile.png", import.meta.url)), fullPage: false });
  await page.getByRole("button", { name: "Nastepna", exact: true }).click(); await page.getByText("Strona 2 z 2", { exact: true }).waitFor();
  assert.equal(await page.locator("tbody tr").count(), 1); assert.equal(inventoryCalls().at(-1).page, 2);
  await page.getByRole("searchbox").fill("259903137R"); const beforeTyping = inventoryCalls().length;
  assert.equal(inventoryCalls().length, beforeTyping); await page.getByRole("button", { name: "Pokaz czesci", exact: true }).click();
  await page.getByText("Strona 1 z 1", { exact: true }).waitFor(); assert.equal(inventoryCalls().at(-1).search, "259903137R"); assert.equal(inventoryCalls().at(-1).page, 1);
  await page.getByLabel("Szukaj wedlug", { exact: true }).selectOption("externalId"); await page.getByRole("searchbox").fill("tymo:1:19034424564");
  await page.getByRole("button", { name: "Pokaz czesci", exact: true }).click(); await table.waitFor(); assert.equal(inventoryCalls().at(-1).externalId, "tymo:1:19034424564");
  await page.getByRole("button", { name: "Wyczysc filtry", exact: true }).click(); await page.getByText("Strona 1 z 2", { exact: true }).waitFor();
  await page.getByLabel("Czesci na stronie", { exact: true }).selectOption("100"); await page.getByLabel("Sortowanie", { exact: true }).selectOption("oldest");
  await page.getByRole("button", { name: "Pokaz czesci", exact: true }).click(); await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 51); await page.getByText("Strona 1 z 1", { exact: true }).waitFor(); assert.equal(await page.locator("tbody tr").count(), 51); assert.equal(inventoryCalls().at(-1).limit, 100); assert.equal(inventoryCalls().at(-1).sort, "oldest");
  mode = "error"; await page.getByRole("button", { name: "Odswiez", exact: true }).click(); await page.getByRole("alert").waitFor(); assert.equal(await table.count(), 0);
  mode = "empty"; await page.getByRole("button", { name: "Sprobuj ponownie", exact: true }).click(); await page.getByText("Brak czesci na tej stronie", { exact: false }).waitFor();
  mode = "invalid"; await page.getByRole("button", { name: "Odswiez", exact: true }).click(); await page.getByRole("alert").filter({ hasText: "Nie potwierdzono" }).waitFor();
  const beforeDisconnected = inventoryCalls().length; connected = false; await mount(); await page.getByText("Brak zapisanego polaczenia.", { exact: false }).waitFor(); assert.equal(inventoryCalls().length, beforeDisconnected);
  admin = false; await mount(); await page.getByRole("alert").filter({ hasText: "Tylko administrator" }).waitFor(); assert.equal(inventoryCalls().length, beforeDisconnected);
  assert.deepEqual(errors, []); assert.equal(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage })), "{}");
  console.log("Ovoko inventory browser: automatic bounded page read, server search, pagination/size/sort, local status filter, images, selection, admin/connection guards, empty/errors and mobile layout passed. No live services or mutations.");
} finally { await browser.close(); }
