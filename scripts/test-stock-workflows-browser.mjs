import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { pathToFileURL, fileURLToPath } from "node:url";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const root = fileURLToPath(new URL("../", import.meta.url));
const css = await postcss([tailwind({ base: root })]).process(await readFile(new URL("../app/globals.css", import.meta.url), "utf8"), { from: fileURLToPath(new URL("../app/globals.css", import.meta.url)) });
const bundle = await build({ stdin: { contents: 'import React from "react";import{createRoot}from"react-dom/client";import{BulkInventoryActions}from"./app/panel/inventory/bulk-inventory-actions";import{ReservationsPanel}from"./app/panel/reservations/reservations-panel";import{SalesSyncPanel}from"./app/panel/inventory/sales-sync-panel";import{ReverseSyncPanel}from"./app/panel/synchronization/reverse-sync-panel";const rows=[{key:"a:10",name:"Drzwi testowe",image:"",conflict:false,allegro:{id:"10",status:"ACTIVE",stock:1,price:{amount:"100.00",currency:"PLN"}},ovoko:{id:"20"}}];createRoot(document.getElementById("root")).render(location.pathname.endsWith("reservations")?<ReservationsPanel/>:location.pathname.endsWith("synchronization")?<><SalesSyncPanel/><ReverseSyncPanel/></>:<BulkInventoryActions rows={rows} onFinished={()=>{}}/>);', resolveDir: root, loader: "tsx" }, bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "session", setup(b) { b.onResolve({ filter: /^(\.\/supabase|@\/lib\/supabase)$/ }, () => ({ path: "session", namespace: "fixture" })); b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: 'export function createSupabaseBrowserClient(){return{auth:{getSession:async()=>({data:{session:{access_token:"fixture",user:{id:"owner"}}}})}}}', loader: "js" })); } }] });
const browser = await chromium.launch({ headless: true, channel: "chrome" });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const calls = [], jobs = new Map(), errors = []; let activeReservation, failedWithdraw = false, aEnabled = false, oEnabled = false, expired = false;
  page.on("pageerror", e => errors.push(e.message));
  await page.route("https://workflow.test/**", async route => {
    const req = route.request(), url = new URL(req.url());
    if (!url.pathname.startsWith("/api/")) return route.fulfill({ contentType: "text/html", body: '<html><body style="background:#0d1117;color:white;padding:20px"><main id="root"></main></body></html>' });
    const b = req.postDataJSON(); calls.push({ path: url.pathname, ...b });
    if (url.pathname.endsWith("sales-sync")) {
      const reverse = url.pathname.includes("reverse-"); if (b.operation === "enable") { assert.equal(b.confirm, true); if (reverse) oEnabled = true; else aEnabled = true; }
      if (b.operation === "disable") { if (reverse) oEnabled = false; else aEnabled = false; }
      return route.fulfill({ json: { configured: true, enabled: reverse ? oEnabled : aEnabled, direction: "allegro_to_ovoko", lastChecked: null, lastError: null, caughtUp: true, watched: 1, jobs: [] } });
    }
    assert.equal(url.pathname, "/api/ovoko/inventory-actions");
    if (b.operation === "list") return route.fulfill({ json: { rows: [...jobs.values()].filter(j => j.kind === "reserve" && !j.closed).map(j => ({ ...j, reservation: { ...j.reservation, ...(expired ? { until: "2000-01-01T00:00:00Z" } : {}) } })) } });
    if (b.operation === "prepare" || b.operation === "prepare-restore") {
      const restore = b.operation === "prepare-restore";
      if (!restore) assert.deepEqual(b.targets, ["allegro", "ovoko"]);
      const job = { id: b.requestId, parentId: b.reservationId, kind: restore ? "restore" : b.kind, offerId: "10", partId: "20", name: "Drzwi testowe", state: "prepared", allegro: "pending", ovoko: "pending", reservation: restore ? null : b.reservationId ? { ...jobs.get(b.reservationId).reservation, price: b.reservation.price } : b.reservation || null, closed: b.kind !== "reserve" };
      jobs.set(job.id, job); return route.fulfill({ json: job });
    }
    const job = jobs.get(b.jobId); assert.ok(job);
    if (b.operation === "execute") {
      assert.equal(b.confirm, true); job.state = "settled";
      if (job.kind === "withdraw" && !failedWithdraw) { failedWithdraw = true; job.allegro = "submitted"; job.ovoko = "uncertain"; return route.fulfill({ status: 503, json: { message: "Wynik niepewny - nie ponawiaj" } }); }
      job.allegro = "done"; job.ovoko = "done";
      if (job.kind === "reserve") activeReservation = job;
      if (job.kind === "restore") jobs.get(job.parentId).closed = true;
    } else if (b.operation === "archive") { assert.equal(b.confirm, true); job.closed = true; } else assert.equal(b.operation, "status");
    return route.fulfill({ json: job });
  });
  async function open(path) { await page.goto(`https://workflow.test/${path}`); await page.addStyleTag({ content: css.css }); await page.addScriptTag({ content: bundle.outputFiles[0].text }); }
  await open("actions"); assert.equal(calls.length, 0);
  await page.getByRole("button", { name: "Wycofaj zaznaczone", exact: true }).click(); const withdraw = page.getByRole("dialog", { name: "Zbiorcze wycofanie" });
  assert.equal(calls.length, 0, "Opening/choosing scope cannot mutate or create a plan");
  await withdraw.getByRole("button", { name: "Potwierdz wycofanie zaznaczonych", exact: true }).click(); await withdraw.getByText("Wynik niepewny - nie ponawiaj").waitFor();
  await withdraw.getByRole("button", { name: "Sprawdz wynik bez ponawiania", exact: true }).click(); await withdraw.getByText(/Niepewny wynik - sprawdz portal/).waitFor();
  assert.deepEqual(calls.map(c => c.operation), ["prepare", "execute", "status"]);
  await withdraw.getByRole("button", { name: "Zamknij", exact: true }).click();
  await page.getByRole("button", { name: "Zarezerwuj zaznaczone", exact: true }).click(); const reserve = page.getByRole("dialog", { name: "Rezerwacja zaznaczonych czesci" });
  await reserve.getByLabel("Klient rezerwacji").fill("Klient testowy"); await reserve.getByLabel("Cena rezerwacji", { exact: true }).fill("120"); await reserve.getByLabel("Zaliczka", { exact: true }).fill("20");
  await reserve.getByLabel("Termin rezerwacji").fill(new Date(Date.now() + 86400000).toISOString().slice(0, 16)); await reserve.getByLabel("Komentarz rezerwacji").fill('<img src=x onerror="alert(1)"> komentarz');
  await reserve.getByRole("button", { name: "Potwierdz rezerwacje zaznaczonych", exact: true }).click(); await reserve.getByText(/Allegro: Potwierdzone/).waitFor();
  const prepared = calls.find(c => c.kind === "reserve"); assert.equal(prepared.reservation.price, "120"); assert.equal(prepared.reservation.deposit, "20"); assert.equal(prepared.reservation.customer, "Klient testowy");
  const anchorId = activeReservation.id;
  await open("actions"); await page.getByRole("button", { name: "Zarezerwuj zaznaczone", exact: true }).click();
  const append = page.getByRole("dialog", { name: "Rezerwacja zaznaczonych czesci" });
  await append.getByLabel("Dodaj do rezerwacji").selectOption(anchorId); assert.equal(await append.getByLabel("Klient rezerwacji").inputValue(), "Klient testowy"); assert.equal(await append.getByLabel("Klient rezerwacji").isDisabled(), true);
  await append.getByLabel("Cena rezerwacji", { exact: true }).fill("75"); await append.getByRole("button", { name: "Potwierdz rezerwacje zaznaczonych", exact: true }).click(); await append.getByText(/Allegro: Potwierdzone/).waitFor();
  assert.equal(calls.find(c => c.reservationId === anchorId && c.operation === "prepare").reservation.price, "75");
  const restoresBefore = calls.filter(c => c.operation === "prepare-restore" || c.operation === "execute" && jobs.get(c.jobId)?.kind === "restore").length;
  expired = true; await open("reservations"); await page.getByText("Klient testowy", { exact: false }).first().waitFor();
  const row = page.getByRole("table", { name: "Zarezerwowane czesci" }).locator("tbody tr").filter({ has: page.getByRole("button", { name: "Przywroc", exact: true }) });
  assert.equal(await row.count(), 2); assert.match(await row.first().getAttribute("class"), /bg-red-700/); assert.equal(await row.locator("img").count(), 0, "Customer notes render as text, not HTML");
  assert.equal(await page.getByRole("columnheader", { name: /Klient testowy · 2 czesci/ }).count(), 1, "Parts added later share one customer reservation group");
  assert.equal(calls.filter(c => c.operation === "prepare-restore" || c.operation === "execute" && jobs.get(c.jobId)?.kind === "restore").length, restoresBefore, "Expiry/opening never restores an offer");
  await mkdir(new URL("../outputs/stock-workflows/", import.meta.url), { recursive: true }); await page.screenshot({ path: fileURLToPath(new URL("../outputs/stock-workflows/reservations.png", import.meta.url)) });
  await row.first().getByRole("button", { name: "Usun", exact: true }).click(); const removal = page.getByRole("dialog", { name: "Usun rezerwacje" }); await removal.getByText(/Oferty pozostana wycofane/).waitFor(); await removal.getByRole("button", { name: "Usun z rezerwacji bez wznawiania", exact: true }).click(); await removal.waitFor({ state: "hidden" }); assert.equal(jobs.get(anchorId).closed, true);
  await row.getByRole("button", { name: "Przywroc", exact: true }).click(); const restore = page.getByRole("dialog", { name: "Przywroc rezerwacje" });
  await restore.getByRole("button", { name: "Potwierdz dostepnosc i przywroc", exact: true }).waitFor(); assert.equal(activeReservation.closed, false);
  await restore.getByRole("button", { name: "Potwierdz dostepnosc i przywroc", exact: true }).click(); await page.getByText("Brak otwartych rezerwacji.").waitFor(); assert.equal(activeReservation.closed, true);
  await open("synchronization"); await page.getByRole("button", { name: "Wlacz Allegro → Ovoko od teraz", exact: true }).waitFor(); await page.getByRole("button", { name: "Wlacz Ovoko → Allegro od teraz", exact: true }).waitFor();
  assert.equal(aEnabled, false); assert.equal(oEnabled, false);
  await page.getByRole("button", { name: "Wlacz Ovoko → Allegro od teraz", exact: true }).click(); await page.getByRole("button", { name: "Wylacz Ovoko → Allegro", exact: true }).waitFor(); assert.equal(aEnabled, false); assert.equal(oEnabled, true);
  await page.getByRole("button", { name: "Wlacz Allegro → Ovoko od teraz", exact: true }).click(); await page.getByRole("button", { name: "Wylacz Allegro → Ovoko", exact: true }).waitFor();
  await page.screenshot({ path: fileURLToPath(new URL("../outputs/stock-workflows/synchronization.png", import.meta.url)) });
  assert.deepEqual(errors, []);
  console.log("Stock workflows browser: explicit batch confirmation, independent uncertain results/read-only recovery, private reservation fields, red expiry without auto-restore, escaped notes, manual restore confirmation and independent synchronization toggles passed. APIs mocked.");
} finally { await browser.close(); }
