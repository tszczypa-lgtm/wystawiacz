import assert from "node:assert/strict";
import { pathToFileURL, fileURLToPath } from "node:url";
import { build } from "esbuild";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const bundle = await build({ stdin: { contents: 'import React from "react"; import {createRoot} from "react-dom/client"; import {AllegroConnection} from "./app/panel/allegro/allegro-connection"; createRoot(document.getElementById("root")).render(<AllegroConnection/>);', resolveDir: fileURLToPath(new URL("../", import.meta.url)), loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "session-fixture", setup(builder) {
  builder.onResolve({ filter: /^\.\/supabase$/ }, () => ({ path: "session", namespace: "fixture" }));
  builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: 'export function createSupabaseBrowserClient(){return {auth:{getSession:async()=>({data:{session:{access_token:"fixture"}}})}}}', loader: "js" }));
} }] });
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || "chrome" });
try {
  const context = await browser.newContext();
  let connected = false, invalidUrl = false;
  const calls = [];
  await context.route("**/*", route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === "https://allegro.pl") return route.fulfill({ contentType: "text/html", body: "<title>Mock Allegro login</title>" });
    assert.equal(url.origin, "https://connection.test");
    if (url.pathname.startsWith("/api/")) {
      calls.push({ path: url.pathname, method: request.method() });
      if (url.pathname === "/api/allegro/me") return route.fulfill({ status: connected ? 200 : 409, json: connected ? { id: "123", login: "Testowy sprzedawca" } : { message: "Najpierw polacz konto Allegro." } });
      assert.equal(url.pathname, "/api/allegro/auth/start"); assert.equal(request.method(), "POST");
      return route.fulfill({ json: { url: invalidUrl ? "https://unsafe.test/auth" : "https://allegro.pl/auth/oauth/authorize?client_id=fixture" } });
    }
    if (url.pathname === "/fixture.js") return route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text });
    return route.fulfill({ contentType: "text/html", body: url.pathname === "/callback" ? "<title>Mock callback</title>" : '<div id="root"></div><script src="/fixture.js"></script>' });
  });
  const page = await context.newPage();
  await page.goto("https://connection.test/");
  await page.evaluate(() => { const open = window.open; window.open = function (...args) { const target = open.apply(window, args); window.fixturePopup = target; return target; }; });
  await page.getByText("Najpierw polacz konto Allegro.").waitFor();
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Polacz z Allegro", exact: true }).click();
  const popup = await popupPromise;
  await popup.waitForURL("https://allegro.pl/auth/oauth/authorize?client_id=fixture");
  await page.evaluate(() => window.dispatchEvent(new MessageEvent("message", { origin: location.origin, source: window, data: { type: "wystawiacz-allegro-complete", ok: true } })));
  assert.equal(calls.filter(call => call.path.endsWith("/me")).length, 1, "Unrelated windows cannot complete OAuth");
  await popup.goto("https://connection.test/callback");
  connected = true;
  await page.evaluate(() => window.dispatchEvent(new MessageEvent("message", { origin: location.origin, source: window.fixturePopup, data: { type: "wystawiacz-allegro-complete", ok: true } })));
  await page.getByText("Testowy sprzedawca", { exact: true }).waitFor();
  await popup.close();
  invalidUrl = true;
  await page.getByRole("button", { name: "Polacz ponownie z Allegro" }).click();
  await page.getByText("Nieprawidlowy adres logowania Allegro.").waitFor();
  assert.ok(calls.every(call => (call.path === "/api/allegro/me" && call.method === "GET") || (call.path === "/api/allegro/auth/start" && call.method === "POST")));
  console.log("Panel Allegro connection: session, popup navigation, unrelated-window rejection, simulated trusted completion reload and invalid login URL rejection passed. No real login or offer changes.");
} finally { await browser.close(); }
