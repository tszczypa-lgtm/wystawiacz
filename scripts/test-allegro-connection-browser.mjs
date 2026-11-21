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
  let holdStart = false, releaseStart, startArrived;
  const calls = [];
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === "https://allegro.pl") return route.fulfill({ contentType: "text/html", body: "<title>Mock Allegro login</title>" });
    assert.equal(url.origin, "https://connection.test");
    if (url.pathname.startsWith("/api/")) {
      calls.push({ path: url.pathname, method: request.method() });
      if (url.pathname === "/api/allegro/me") return route.fulfill({ status: connected ? 200 : 409, json: connected ? { id: "123", login: "Testowy sprzedawca" } : { message: "Najpierw polacz konto Allegro." } });
      assert.equal(url.pathname, "/api/allegro/auth/start"); assert.equal(request.method(), "POST");
      if (holdStart) await new Promise(resolve => { releaseStart = resolve; startArrived(); });
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
  assert.equal(await page.getByRole("button", { name: "Otwieram Allegro..." }).isDisabled(), true, "Do not start a second login before the first finishes");
  await page.evaluate(() => window.dispatchEvent(new MessageEvent("message", { origin: location.origin, source: window, data: { type: "wystawiacz-allegro-complete", ok: true } })));
  assert.equal(calls.filter(call => call.path.endsWith("/me")).length, 1, "Unrelated windows cannot complete OAuth");
  await popup.goto("https://connection.test/callback");
  await page.evaluate(() => window.dispatchEvent(new MessageEvent("message", { origin: "https://unsafe.test", source: window.fixturePopup, data: { type: "wystawiacz-allegro-complete", ok: false, code: "seller_not_allowed" } })));
  assert.equal(await page.getByText(/Zablokowano przypisanie konta Allegro/).count(), 0, "Foreign origins cannot inject a binding failure");
  await page.evaluate(() => window.dispatchEvent(new MessageEvent("message", { origin: location.origin, source: window.fixturePopup, data: { type: "wystawiacz-allegro-complete", ok: false, code: "seller_not_allowed", message: "private-provider-error" } })));
  await page.getByText(/Kod: seller_not_allowed/).waitFor();
  for (const code of ["oauth_configuration", "oauth_database_config", "oauth_cookie_missing", "oauth_encryption", "oauth_cookie_invalid", "oauth_session_invalid", "oauth_denied", "oauth_code_missing", "oauth_token_unavailable", "oauth_token_rejected", "oauth_invalid_grant", "oauth_invalid_client", "oauth_invalid_request", "oauth_token_response", "oauth_seller_read", "oauth_seller_binding", "oauth_admin_check", "oauth_admin_audit", "oauth_connection_save"]) {
    await page.evaluate(code => window.dispatchEvent(new MessageEvent("message", { origin: location.origin, source: window.fixturePopup, data: { type: "wystawiacz-allegro-complete", ok: false, code } })), code);
    await page.getByText(new RegExp(`Kod: ${code}\\.`)).waitFor();
  }
  assert.equal(calls.filter(call => call.path.endsWith("/me")).length, 1, "Binding rejection never reloads or reconnects automatically");
  assert.equal(await page.getByText("private-provider-error").count(), 0);
  await page.evaluate(() => window.dispatchEvent(new MessageEvent("message", { origin: location.origin, source: window.fixturePopup, data: { type: "wystawiacz-allegro-complete", ok: false, code: "private-unknown-code" } })));
  await page.getByText(/Nie potwierdzono, ze przyczyna jest przypisanie sprzedawcy/).waitFor();
  assert.equal(await page.getByText(/private-unknown-code/).count(), 0, "Unknown error codes are not echoed");
  connected = true;
  await page.evaluate(() => window.dispatchEvent(new MessageEvent("message", { origin: location.origin, source: window.fixturePopup, data: { type: "wystawiacz-allegro-complete", ok: true } })));
  await page.getByText("Testowy sprzedawca", { exact: true }).waitFor();
  await popup.close();
  const closePopupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Polacz ponownie z Allegro" }).click();
  const closing = await closePopupPromise; await closing.waitForURL("https://allegro.pl/auth/oauth/authorize?client_id=fixture");
  assert.equal(await page.getByRole("button", { name: "Otwieram Allegro..." }).isDisabled(), true);
  await closing.close();
  await page.getByText(/Okno logowania zostalo zamkniete bez potwierdzenia/).waitFor();
  assert.equal(await page.getByRole("button", { name: "Polacz ponownie z Allegro" }).isEnabled(), true, "Closing the popup releases the button without changing connections");
  holdStart = true;
  const arrived = new Promise(resolve => { startArrived = resolve; });
  const earlyPopupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Polacz ponownie z Allegro" }).click();
  const early = await earlyPopupPromise; await arrived; await early.close();
  await page.waitForTimeout(700);
  assert.equal(await page.getByRole("button", { name: "Otwieram Allegro..." }).isDisabled(), true, "Pending auth/start must finish before another session can overwrite its cookie");
  holdStart = false; releaseStart();
  await page.getByText(/Okno logowania zamknieto przed rozpoczeciem/).waitFor();
  invalidUrl = true;
  await page.getByRole("button", { name: "Polacz ponownie z Allegro" }).click();
  await page.getByText("Nieprawidlowy adres logowania Allegro.").waitFor();
  assert.ok(calls.every(call => (call.path === "/api/allegro/me" && call.method === "GET") || (call.path === "/api/allegro/auth/start" && call.method === "POST")));
  console.log("Panel Allegro connection: session, popup navigation, unrelated-window rejection, simulated trusted completion reload and invalid login URL rejection passed. No real login or offer changes.");
} finally { await browser.close(); }
