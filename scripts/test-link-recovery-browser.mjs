import assert from "node:assert/strict";
import { build } from "esbuild";
import { pathToFileURL,fileURLToPath } from "node:url";
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const bundle=await build({stdin:{contents:'import React from"react";import{createRoot}from"react-dom/client";import{LinkRecoveryPanel}from"./app/panel/synchronization/link-recovery-panel";createRoot(document.getElementById("root")).render(<LinkRecoveryPanel/>);',resolveDir:fileURLToPath(new URL("../",import.meta.url)),loader:"tsx"},bundle:true,write:false,format:"iife",platform:"browser",jsx:"automatic",define:{"process.env.NODE_ENV":'"production"'},plugins:[{name:"session",setup(b){b.onResolve({filter:/@\/lib\/supabase/},()=>({path:"session",namespace:"fixture"}));b.onLoad({filter:/.*/,namespace:"fixture"},()=>({contents:'export function createSupabaseBrowserClient(){return{auth:{getSession:async()=>({data:{session:{access_token:"fixture",user:{id:"owner"}}}})}}}',loader:"js"}));}}]});
const browser=await chromium.launch({headless:true,channel:"chrome"});
try{
 const page=await browser.newPage(),calls=[],errors=[];let state="",writes=0;
 page.on("pageerror",e=>errors.push(e.message));
 const plan={id:"00000000-0000-4000-8000-000000000001",offerId:"10",partId:"20",expiresAt:new Date(Date.now()+300000).toISOString()};
 await page.route("https://links.test/**",async route=>{
  const req=route.request(),url=new URL(req.url());
  if(!url.pathname.startsWith("/api/"))return route.fulfill({contentType:"text/html",body:'<html><body><div id="root"></div></body></html>'});
  assert.equal(url.pathname,"/api/ovoko/link-recovery","No publishing, withdrawal or enable endpoint may be called");assert.equal(req.method(),"POST");
  const b=req.postDataJSON();calls.push(b);
  if(b.operation==="discover")return route.fulfill({json:{rows:[{offerId:"10",partId:"20",name:"Radio"}],page:1,total:1,skipped:0,next:null}});
  if(b.operation==="check"){state="prepared";return route.fulfill({json:{...plan,state,message:"Podglad; nie odbudowano jeszcze",allegroStatus:"ACTIVE",stock:1,ovokoStatus:"0"}});}
  if(b.operation==="confirm"){assert.equal(b.confirm,true);assert.equal(b.planId,plan.id);writes++;state="applied";return route.fulfill({status:503,json:{message:"Nie potwierdzono odpowiedzi. Odswiez zapisane plany."}});}
  assert.equal(b.operation,"plans");return route.fulfill({json:{rows:[{...plan,state}]}});
 });
 await page.goto("https://links.test/");await page.addScriptTag({content:bundle.outputFiles[0].text});
 await page.getByText("Odzyskaj powiazania po awarii",{exact:true}).click();assert.equal(calls.length,0,"Opening recovery must not arm synchronization or create plans");
 await page.getByRole("button",{name:"Znajdz kandydatow w Ovoko",exact:true}).click();await page.getByRole("checkbox",{name:"Odzyskaj 10:20",exact:true}).check();
 const confirm=page.getByRole("button",{name:"Zatwierdz odbudowe zaznaczonych powiazan",exact:true});assert.equal(await confirm.isEnabled(),false);
 await page.getByRole("button",{name:"Sprawdz zaznaczone (maks. 10)",exact:true}).click();await page.getByText(/Podglad; nie odbudowano jeszcze/).first().waitFor();assert.equal(writes,0);assert.equal(await confirm.isEnabled(),true);
 await confirm.click();await page.getByText(/Nie potwierdzono odpowiedzi. Odswiez zapisane plany./).first().waitFor();assert.equal(writes,1);
 await page.getByRole("button",{name:"Odswiez zapisane plany",exact:true}).click();await page.getByText("Powiazanie zapisane; bez zmian aukcji",{exact:true}).waitFor();assert.equal(writes,1);assert.equal(await confirm.isEnabled(),false);
 assert.deepEqual(calls.map(c=>c.operation),["discover","check","confirm","plans"]);assert.deepEqual(errors,[]);
 console.log("Recovery browser: explicit discovery/check/confirmation, no mutation on opening/preview, lost DB acknowledgement readback and zero publish/withdraw/enable requests passed. APIs mocked.");
}finally{await browser.close();}
