import assert from "node:assert/strict";
import { pathToFileURL, fileURLToPath } from "node:url";
import { build } from "esbuild";
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const root = fileURLToPath(new URL("../", import.meta.url));
const bundle = await build({ stdin: { contents: 'import React from "react"; import { createRoot } from "react-dom/client"; import { OvokoPanel } from "./app/panel/ovoko/ovoko-panel"; createRoot(document.getElementById("root")).render(<OvokoPanel />);', resolveDir: root, loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "session", setup(builder) {
  builder.onResolve({ filter: /(?:^@\/lib\/|^\.\/)supabase$/ }, () => ({ path: "supabase", namespace: "fixture" }));
  builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: 'export function createSupabaseBrowserClient(){return {auth:{getSession:async()=>({data:{session:{access_token:"fixture"}}})}}}', loader: "js" }));
} }] });
const browser = await chromium.launch({ headless: true, channel: "chrome" });
try {
  const page = await browser.newPage(); const errors = [], calls = []; let fail = false, denied = false;
  page.on("pageerror", error => errors.push(error.message));
  await page.route("https://ovoko.test/**", async route => {
    const request = route.request(), url = new URL(request.url());
    if (!url.pathname.startsWith("/api/")) return route.fulfill({ contentType: "text/html", body: '<html><body><div id="root"></div></body></html>' });
    calls.push({ path: url.pathname, method: request.method() });
    if (url.pathname === "/api/ovoko/status") return route.fulfill({ status: denied ? 403 : 200, json: denied ? { message: "Tylko administrator" } : { allowed: true } });
    assert.equal(url.pathname, "/api/ovoko/test"); assert.equal(request.method(), "POST");
    assert.deepEqual(request.postDataJSON(), { username: "fixture-user", password: "fixture-password", user_token: "fixture-token" });
    return route.fulfill({ status: fail ? 502 : 200, json: fail ? { message: "Ovoko odrzucilo token API. Kod: R012." } : { ok: true, code: "R200", checkedAt: new Date().toISOString(), brands: [{ id: "1", name: "Audi" }] } });
  });
  async function mount() { await page.goto("https://ovoko.test/"); await page.addScriptTag({ content: bundle.outputFiles[0].text }); }
  async function fill() { await page.getByLabel("Login API").fill("fixture-user"); await page.getByLabel("Haslo API").fill("fixture-password"); await page.getByLabel("Token API (user_token)").fill("fixture-token"); }
  await mount(); await page.getByLabel("Login API").waitFor();
  assert.equal(calls.filter(call => call.method === "POST").length, 0, "No credential test on page load");
  assert.equal(await page.getByLabel("Haslo API").getAttribute("type"), "password");
  assert.equal(await page.getByLabel("Token API (user_token)").getAttribute("type"), "password");
  await fill(); await page.getByRole("button", { name: "Testuj odczyt Ovoko" }).click();
  await page.getByText("Odczyt dziala: R200").waitFor();
  assert.equal(await page.getByLabel("Haslo API").inputValue(), ""); assert.equal(await page.getByLabel("Token API (user_token)").inputValue(), "");
  assert.equal(await page.getByLabel("Marki z Ovoko").textContent(), "Audi (ID 1)");
  fail = true; await fill(); await page.getByRole("button", { name: "Testuj odczyt Ovoko" }).click();
  await page.getByRole("alert").filter({ hasText: "R012" }).waitFor();
  assert.equal(await page.getByText("Odczyt dziala: R200").count(), 0, "Failure clears stale successful result");
  assert.equal(await page.getByLabel("Haslo API").inputValue(), ""); assert.equal(await page.getByLabel("Token API (user_token)").inputValue(), "");
  assert.equal(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }).includes("fixture-")), false);
  denied = true; await mount(); await page.getByRole("alert").filter({ hasText: "Tylko administrator" }).waitFor();
  assert.equal(await page.getByLabel("Haslo API").count(), 0);
  assert.deepEqual(errors, []);
  console.log("Ovoko browser: explicit test only, masked fields, secrets cleared on success/failure, no local credential storage, stale result cleared, nonadmin form blocked. No live accounts used.");
} finally { await browser.close(); }
