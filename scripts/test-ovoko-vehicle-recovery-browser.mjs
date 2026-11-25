import assert from "node:assert/strict";
import {fileURLToPath,pathToFileURL} from "node:url";
import {build} from "esbuild";
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const bundle=await build({stdin:{contents:'import React from "react";import{createRoot}from"react-dom/client";import{OvokoBulkPanel}from"./app/panel/inventory/ovoko-bulk-panel";createRoot(document.getElementById("root")).render(<OvokoBulkPanel offers={[1,2,3,4].map(id=>({id:String(id),name:`Mercedes ${id}`,price:{amount:"50",currency:"PLN"}}))} onFinished={()=>{}}/>);',resolveDir:fileURLToPath(new URL("../",import.meta.url)),loader:"tsx"},bundle:true,write:false,platform:"browser",format:"iife",jsx:"automatic",define:{"process.env.NODE_ENV":'"production"'},plugins:[{name:"session",setup(b){b.onResolve({filter:/(?:^@\/lib\/|^\.\/)supabase$/},()=>({path:"session",namespace:"fixture"}));b.onLoad({filter:/.*/,namespace:"fixture"},()=>({contents:'export function createSupabaseBrowserClient(){return{auth:{getSession:async()=>({data:{session:{access_token:"fixture",user:{id:"owner"}}}})}}}',loader:"js"}));}}]});
const browser=await chromium.launch({headless:true,channel:"chrome"});
try{
 const page=await browser.newPage(),calls=[],errors=[];let unlocked=false,resume;
 const held=new Promise(resolve=>{resume=resolve;});
 page.on("pageerror",error=>errors.push(error.message));
 await page.route("https://vehicles.test/**",async route=>{
  const request=route.request(),path=new URL(request.url()).pathname;
  if(!path.startsWith("/api/"))return route.fulfill({contentType:"text/html",body:'<div id="root"></div>'});
  const body=request.method()==="POST"?request.postDataJSON():null;calls.push({path,body});
  if(path.startsWith("/api/allegro/ovoko-source/")){const id=path.split("/").at(-1);return route.fulfill({json:{sellerId:"555",offer:{id,name:`Mercedes ${id}`,publication:{status:"ACTIVE"},stock:{available:1},sellingMode:{price:{amount:"50",currency:"PLN"}},images:["https://a.allegroimg.com/a.jpg"],parameters:[{name:"Stan",values:["Uzywany"]}]}}});}
  if(path==="/api/ovoko/bulk"){
   if(body.operation==="start")return route.fulfill({json:{ok:true,binding:{sellerId:"555",fingerprint:"fixture"}}});
   assert.deepEqual(body.adjustment,{mode:"percent",value:"20"});
   if(body.operation==="prepare"){
    if(["1","2"].includes(body.offerId)&&!unlocked)return route.fulfill({status:409,json:{message:"Stara blokada auta",code:"vehicle_creation_locked",repair:{needsVehicle:false,needsCategory:false,brandId:"7",categoryId:"3",vehicle:{brandId:"7",modelId:"71",year:"2010"}}}});
    return route.fulfill({json:{ok:true,prepared:{brandId:"7",modelId:"71",categoryId:"3"}}});
   }
   if(body.offerId==="3")await held;
   return route.fulfill({json:{ok:true,alreadyCreated:false,partId:`8${body.offerId}`,price:"60",currency:"PLN"}});
  }
  if(path==="/api/ovoko/manual-override"){
   if(body.operation==="check"){assert.equal(body.kind,"vehicle");assert.equal(body.modelId,"71");assert.equal(body.year,"2010");return route.fulfill({json:{token:"fixture",message:"Stary zapis",foundId:null}});}
   assert.equal(body.confirmManual,true);unlocked=true;return route.fulfill({json:{resolved:true,kind:"vehicle",message:"Zwolniono zapis"}});
  }
  throw new Error(path);
 });
 await page.goto("https://vehicles.test");await page.addScriptTag({content:bundle.outputFiles[0].text});
 await page.getByLabel("Cena w Ovoko").selectOption("percent");await page.getByLabel("Procent (%)").fill("20");
 await page.getByRole("button",{name:"Przenies zaznaczone do Ovoko",exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('[data-offer-id="3"]')?.textContent.includes("Sprawdzam i przenosze"),{timeout:30000});
 const recover=page.getByRole("button",{name:"Odblokuj auta z bledow (1)",exact:true});await recover.waitFor();
 page.once("dialog",dialog=>dialog.dismiss());await recover.click();assert.equal(calls.filter(call=>call.path.endsWith("manual-override")).length,0);
 page.once("dialog",dialog=>dialog.accept());await recover.click();
 await page.getByText("Auto w kolejce do odblokowania.",{exact:true}).first().waitFor();
 assert.equal(calls.filter(call=>call.path.endsWith("manual-override")).length,0,"Never unlock while the current item is in flight");
 resume();await page.getByRole("status").filter({hasText:"Partia zakonczona"}).waitFor({timeout:45000});
 for(const id of["1","2","3","4"]){assert.match(await page.locator(`[data-offer-id="${id}"]`).innerText(),/Przeniesiono/);assert.equal(calls.filter(call=>call.body?.operation==="item"&&call.body.offerId===id).length,1);}
 assert.equal(calls.filter(call=>call.path.endsWith("manual-override")).length,2,"One shared vehicle is checked/confirmed once for both failed parts");
 assert.deepEqual(errors,[]);console.log("Vehicle recovery browser: explicit consent, queueing during batch, no interruption of in-flight write, shared-model deduplication, preserved prices and continued untouched rows passed. Mock services only.");
}finally{await browser.close();}
