import assert from "node:assert/strict";
import { pathToFileURL, fileURLToPath } from "node:url";
import { readFileSync, mkdirSync } from "node:fs";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { readCases } from "./ovoko-read-fixtures.mjs";

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const root = fileURLToPath(new URL("../", import.meta.url));
const css = await postcss([tailwind({ base: root })]).process(readFileSync(new URL("../app/globals.css", import.meta.url), "utf8"), { from: fileURLToPath(new URL("../app/globals.css", import.meta.url)) });
const bundle = await build({
  stdin: { contents: 'import React from "react"; import { createRoot } from "react-dom/client"; import { InventoryViews } from "./app/panel/inventory/inventory-views"; import { OvokoInventoryPanel } from "./app/panel/inventory/ovoko/ovoko-inventory-panel"; createRoot(document.getElementById("root")).render(<><InventoryViews active="ovoko"/><OvokoInventoryPanel/></>);', resolveDir: root, loader: "tsx" },
  bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{ name: "session", setup(builder) {
    builder.onResolve({ filter: /^@\/lib\/(supabase|account-client)$/ }, args => ({ path: args.path, namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path.endsWith("supabase")
      ? 'export function createSupabaseBrowserClient(){return {auth:{getSession:async()=>({data:{session:{access_token:"fixture"}}})}}}'
      : 'export async function accountRequest(){return {isAdmin:window.fixtureAdmin}}', loader: "js" }));
  } }],
});
const browser = await chromium.launch({ headless: true, channel: "chrome" });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } }), errors = [], calls = [];
  let mode = "ok", connected = true, admin = true;
  page.on("pageerror", error => errors.push(error.message));
  await page.route("https://inventory.test/**", async route => {
    const request = route.request(), url = new URL(request.url());
    if (!url.pathname.startsWith("/api/")) return route.fulfill({ contentType: "text/html", body: `<html><body style="background:#0d1117;color:white"><main id="root" style="max-width:1040px;margin:auto;padding:20px"></main><script>window.fixtureAdmin=${admin}</script></body></html>` });
    calls.push({ path: url.pathname, method: request.method() });
    if (url.pathname === "/api/ovoko/status") return route.fulfill({ status: admin ? 200 : 403, json: admin ? { allowed: true, connected } : { message: "Tylko administrator" } });
    assert.equal(url.pathname, "/api/ovoko/read", "No Allegro, car, storage, publication or mutation endpoints");
    assert.equal(request.method(), "POST");
    assert.deepEqual(request.postDataJSON(), { useSaved: true, operation: "parts" }, "No credentials, owner IDs or arbitrary remote URLs from the browser");
    if (mode === "error") return route.fulfill({ status: 502, json: { message: "Blad odczytu testowy" } });
    const fixture = readCases.find(item => item.operation === "parts");
    return route.fulfill({ json: { ok: true, readOnly: true, code: "R200", operation: mode === "invalid" ? "categories" : "parts", credentialsStored: true, checkedAt: new Date().toISOString(), rows: mode === "empty" ? [] : fixture.rows, pagination: { page: 1, limit: 20, total: mode === "empty" ? 0 : 1 } } });
  });
  async function mount() { await page.goto("https://inventory.test/"); await page.addStyleTag({ content: css.css }); await page.addScriptTag({ content: bundle.outputFiles[0].text }); }
  const load = () => page.getByRole("button", { name: "Pobierz pierwsze 20 czesci" });
  await mount(); await load().waitFor();
  assert.equal(calls.filter(call => call.method === "POST").length, 0, "Mount only checks connection metadata, no automatic provider reads");
  assert.equal(await page.getByRole("link", { name: "Allegro", exact: true }).getAttribute("href"), "/panel/inventory");
  assert.equal(await page.getByRole("link", { name: "Ovoko - podglad" }).getAttribute("aria-current"), "page");
  assert.equal(await page.locator('input[type="password"]').count(), 0);
  await load().click(); await page.getByRole("table", { name: "Rekordy czesci Ovoko" }).waitFor();
  assert.equal(await page.locator("tbody tr").count(), 1);
  await page.getByText("Samochod-dawca ID: 36", { exact: false }).waitFor();
  assert.equal(await page.getByRole("cell", { name: "Niepotwierdzona", exact: true }).count(), 1);
  mkdirSync(new URL("../outputs/ovoko-inventory-preview/", import.meta.url), { recursive: true });
  await page.screenshot({ path: fileURLToPath(new URL("../outputs/ovoko-inventory-preview/desktop.png", import.meta.url)), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Mobile table scroll stays within its container");
  await page.screenshot({ path: fileURLToPath(new URL("../outputs/ovoko-inventory-preview/mobile.png", import.meta.url)), fullPage: true });
  await page.setViewportSize({ width: 1200, height: 1000 });
  const beforeFilter = calls.length;
  await page.getByRole("searchbox").fill("ABC"); assert.equal(await page.locator("tbody tr").count(), 1);
  await page.getByRole("searchbox").fill("missing"); await page.getByText("Brak dopasowan wsrod pobranych rekordow.", { exact: false }).waitFor();
  assert.equal(calls.length, beforeFilter, "Local filtering never triggers further requests");
  mode = "error"; await load().click(); await page.getByRole("alert").waitFor();
  assert.equal(await page.locator("tbody tr").count(), 0, "Failed refresh clears stale inventory, does not claim empty inventory");
  assert.equal(await page.getByText("API zwrocilo 0 rekordow czesci.", { exact: false }).count(), 0);
  mode = "empty"; await load().click(); await page.getByText("API zwrocilo 0 rekordow czesci.", { exact: false }).waitFor();
  mode = "invalid"; await load().click(); await page.getByRole("alert").filter({ hasText: "Nie potwierdzono" }).waitFor();
  assert.equal(await page.getByRole("table").count(), 0);
  connected = false; await mount(); await page.getByText("Brak zapisanego polaczenia.", { exact: false }).waitFor(); assert.equal(await load().count(), 0);
  admin = false; await mount(); await page.getByRole("alert").filter({ hasText: "Tylko administrator" }).waitFor();
  assert.equal(await page.getByRole("link", { name: "Ovoko - podglad" }).count(), 0); assert.equal(await load().count(), 0);
  assert.deepEqual(errors, []);
  assert.equal(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage })), "{}");
  assert.ok(readFileSync(new URL("../app/panel/inventory/page.tsx", import.meta.url), "utf8").includes('<InventoryViews active="allegro" /><InventoryPanel />'));
  console.log("Ovoko inventory browser: admin-only navigation, local metadata only on mount, explicit saved read, local filter scope, stock/sales/donor separation, empty/error handling and no mutation endpoints passed.");
} finally { await browser.close(); }
