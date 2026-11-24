import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const root = fileURLToPath(new URL("../", import.meta.url));
const bundle = await build({ stdin: { contents: 'import React from "react";import {createRoot} from "react-dom/client";import {OvokoBulkPanel} from "./app/panel/inventory/ovoko-bulk-panel";import {ManualOvokoOverride} from "./app/panel/inventory/manual-override";const offers=[1,2,3,4,5].map(id=>({id:String(id),name:`Radio ${id}`,price:{amount:"50",currency:"PLN"}}));createRoot(document.getElementById("root")).render(location.pathname==="/override"?<ManualOvokoOverride offerId="1" brandId="7" modelId="71" year="2021" disabled={false} onBusyChange={()=>{}} onResolved={r=>window.resolved=r}/>:<OvokoBulkPanel offers={offers} onFinished={()=>{}}/>);', resolveDir: root, loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "session", setup(b) {
 b.onResolve({ filter: /(?:^@\/lib\/|^\.\/)supabase$/ }, () => ({ path: "session", namespace: "fixture" }));
 b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: 'export function createSupabaseBrowserClient(){return{auth:{getSession:async()=>({data:{session:{access_token:"fixture",user:{id:"owner"}}}})}}}', loader: "js" }));
} }] });
const browser = await chromium.launch({ headless: true, channel: "chrome" });
try {
 const page = await browser.newPage(), calls = [], errors = []; let mode = "mixed";
 page.on("pageerror", e => errors.push(e.message));
 await page.route("https://bulk.test/**", async route => {
  const req = route.request(), url = new URL(req.url());
  if (!url.pathname.startsWith("/api/")) return route.fulfill({ contentType:"text/html", body:'<html><body><div id="root"></div></body></html>' });
  const body = req.method() === "POST" ? req.postDataJSON() : null; calls.push({ path:url.pathname, body });
  if (url.pathname.startsWith("/api/allegro/ovoko-source/")) {
   const id = url.pathname.split("/").at(-1);
   if(mode==="all-errors"&&id==="1")return route.fulfill({status:503,json:{message:"Nie odczytano tej oferty"}});
   return route.fulfill({ json:{sellerId:"555",offer:{id,name:`Radio ${id}`,publication:{status:"ACTIVE"},stock:{available:1},sellingMode:{price:{amount:"50",currency:"PLN"}},images:["https://a.allegroimg.com/photo.jpg"],parameters:[{name:"Stan",values:["Uzywany"]}]}} });
  }
  if (url.pathname === "/api/ovoko/bulk") {
   if (body.operation === "start") return route.fulfill({json:{ok:true,binding:{sellerId:"555",fingerprint:"fixture"}}});
   if (mode === "unauthorized") return route.fulfill({status:401,contentType:"text/html",body:"<!DOCTYPE html><h1>Login</h1>"});
   if(mode==="account-change")return route.fulfill({status:409,json:{message:"Konto zmienione",code:"account_changed"}});
   if(mode==="all-errors"&&["2","3","4"].includes(body.offerId))return route.fulfill(body.offerId==="4"?{status:502,contentType:"text/html",body:"<!DOCTYPE html>"}:{status:body.offerId==="2"?409:503,json:{message:"Blad tej pozycji"}});
   if (body.operation === "prepare") {
    if (body.offerId === "1" && !body.fallbackVehicle) return route.fulfill({status:400,json:{message:"Wybierz model",code:"preparation_incomplete",repair:{needsVehicle:true,needsCategory:false,brandId:"7",categoryId:"3"}}});
    if (body.offerId === "1") { assert.deepEqual(body.overrides,{categoryId:"3"}); assert.deepEqual(body.fallbackVehicle,{brandId:"7",modelId:"71"}); }
    return route.fulfill({json:{ok:true,category:{id:"3",name:"Radio"},prepared:{brandId:"7",modelId:"71",categoryId:"3"}}});
   }
   if (body.offerId === "2") return route.fulfill({status:502,contentType:"text/html",body:"<!DOCTYPE html><h1>private proxy error</h1>"});
   return route.fulfill({json:{ok:true,alreadyCreated:false,partId:`8${body.offerId}`,price:"50",currency:"PLN"}});
  }
  if (url.pathname === "/api/ovoko/read") { assert.equal(body.operation,"models","Model-only repair must not load categories"); assert.equal(body.brandId,"7");return route.fulfill({json:{ok:true,readOnly:true,rows:[{id:"71",name:"Kangoo III",years:"2021 - "}]}}); }
  if (url.pathname === "/api/ovoko/manual-override") {
   if (body.operation === "check") { assert.equal(body.kind,"part");return route.fulfill({json:{token:"sealed-fixture",message:"Sprawdzono stara blokade",foundId:null}}); }
   assert.equal(body.confirmManual,true);assert.equal(body.typedOfferId,undefined);assert.equal(body.reason,undefined);
   return route.fulfill({json:{resolved:true,kind:"part",message:"Zwolniono stara blokade"}});
  }
  throw new Error(`Unexpected request ${url.pathname}`);
 });
 const mount = async path => { await page.goto(`https://bulk.test${path}`);await page.addScriptTag({content:bundle.outputFiles[0].text}); };
 await mount("/");await page.getByRole("button",{name:"Przenies zaznaczone do Ovoko",exact:true}).click();
 await page.getByRole("status").filter({hasText:"Partia zakonczona"}).waitFor({timeout:45000});
 assert.match(await page.locator('[data-offer-id="2"]').innerText(),/HTML.*HTTP 502.*etap item/);
 assert.match(await page.locator('[data-offer-id="2"]').innerText(),/niepewny/);
 assert.match(await page.locator('[data-offer-id="3"]').innerText(),/Przeniesiono/);
 assert.equal(calls.filter(c=>c.body?.offerId==="2"&&c.body.operation==="item").length,1,"Never replay ambiguous part write");
 const repair = page.locator('[data-offer-id="1"]');await repair.getByText("Uzupelnij i przenies",{exact:true}).click();
 await repair.getByLabel("Model pomocniczy").selectOption("71");
 assert.equal(await repair.getByLabel("Kategoria Ovoko").count(),0);assert.equal(await repair.getByLabel("Marka pomocnicza").count(),0);assert.equal(await repair.getByText("Numer czesci",{exact:true}).count(),0);
 await repair.getByRole("button",{name:"Przenies te pozycje"}).click();await page.getByRole("status").filter({hasText:"Zakonczono poprawianie pozycji"}).waitFor({timeout:15000});
 assert.match(await repair.innerText(),/Przeniesiono/);assert.equal(calls.filter(c=>c.body?.offerId==="2"&&c.body.operation==="item").length,1);
 mode="unauthorized";const before=calls.length;await mount("/");await page.getByRole("button",{name:"Przenies zaznaczone do Ovoko",exact:true}).click();await page.getByRole("status").filter({hasText:"Partia zatrzymana"}).waitFor();assert.equal(calls.slice(before).filter(c=>c.path.startsWith("/api/allegro/")).length,1,"401 stops remaining rows");
 mode="all-errors";const beforeErrors=calls.length;await mount("/");await page.getByRole("button",{name:"Przenies zaznaczone do Ovoko",exact:true}).click();await page.getByRole("status").filter({hasText:"Partia zakonczona"}).waitFor({timeout:45000});assert.match(await page.locator('[data-offer-id="5"]').innerText(),/Przeniesiono/);assert.equal(calls.slice(beforeErrors).filter(c=>c.path.startsWith("/api/allegro/ovoko-source/")).length,5,"Four consecutive mixed row errors do not stop the fifth");
 mode="account-change";const beforeChange=calls.length;await mount("/");await page.getByRole("button",{name:"Przenies zaznaczone do Ovoko",exact:true}).click();await page.getByRole("status").filter({hasText:"Partia zatrzymana"}).waitFor();assert.equal(calls.slice(beforeChange).filter(c=>c.path.startsWith("/api/allegro/")).length,1);
 await mount("/override");assert.equal(await page.getByRole("checkbox").count(),0);assert.equal(await page.getByRole("textbox").count(),0);
 const beforeOverride=calls.length;page.once("dialog",dialog=>dialog.dismiss());await page.getByRole("button",{name:"Odblokuj te oferte",exact:true}).click();assert.equal(calls.length,beforeOverride,"Cancel means no API request");
 page.once("dialog",dialog=>dialog.accept());await page.getByRole("button",{name:"Odblokuj te oferte",exact:true}).click();await page.getByRole("status").filter({hasText:"Zwolniono"}).waitFor();assert.equal((await page.evaluate(()=>window.resolved)).resolved,true);
 assert.equal(calls.some(c=>/publish|create-car/.test(c.path)),false,"Manual override never auto-publishes");assert.deepEqual(errors,[]);
 console.log("Browser: HTML response isolates uncertain row and continues next, no automatic replay, model-only repair preserves category, 401 stops batch, and explicit manual override confirmations passed. All API routes mocked.");
} finally { await browser.close(); }
