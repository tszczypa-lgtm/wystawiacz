import assert from "node:assert/strict";
import {readFile,mkdir} from "node:fs/promises";
import {createServer} from "node:http";
import {pathToFileURL,fileURLToPath} from "node:url";
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const root=new URL("../public/wystawiacz/",import.meta.url),library=new Map();
let carCreates=0,allegroWrites=0,partWrites=0,failPart=true,requests=[];
const server=createServer(async(req,res)=>{
 const url=new URL(req.url,"http://fixture.test"),path=url.pathname;
 if(path.startsWith("/api/")){
  res.setHeader("Content-Type","application/json");let raw="";for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):{};
  requests.push({path,body});
  let data={connected:false,categories:[],parameters:[],build:"2026-06-02.35"};
  if(path==="/api/workspace/vehicles"){
   if(req.method==="PUT"){
    const row={id:body.id,revision:body.revision+1,payload:body.payload};library.set(row.id,row);data={vehicle:row};
   }else data=url.searchParams.has("id")?{vehicle:library.get(url.searchParams.get("id"))}:{vehicles:[...library.values()]};
  }
  if(path==="/api/ovoko/read")data={rows:body.operation==="brands"?[{id:"1",name:"Volkswagen"}]:body.operation==="models"?[{id:"164",name:"Golf VII",years:"2012 - 2020"}]:[{id:"3",name:"Pompy",level:"3"}]};
  if(path==="/api/ovoko/workspace-vehicle"){if(body.create)carCreates++;data={ok:true,carId:"101"};}
  if(path==="/api/ovoko/bulk")data={ok:true,binding:{sellerId:"55",fingerprint:"fixture"}};
  if(path==="/api/ovoko/workspace-listing"){
   assert.ok(library.has(body.vehicleId));assert.equal(body.price,"120.00");
   if(body.operation==="prepare")data={ok:true,prepared:{donorId:"101"},expectedSource:{price:"100.00",stock:1}};
   else{partWrites++;if(failPart){res.statusCode=502;data={message:"Testowy blad Ovoko"};}else data={ok:true,partId:"222"};}
  }
  res.end(JSON.stringify(data));return;
 }
 try{
  const name=path==="/"?"index.html":path.slice(1);if(!/^[a-z0-9.-]+$/i.test(name))throw Error();
  let body=await readFile(new URL(name,root));if(name==="index.html")body=body.toString().replace('<script src="web-auth.js"></script>','<script>window.getWystawiaczToken=async()=>"fixture";</script>');
  res.setHeader("Content-Type",name.endsWith(".js")?"text/javascript":name.endsWith(".css")?"text/css":"text/html; charset=utf-8");res.end(body);
 }catch{res.statusCode=404;res.end();}
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));let browser;
try{
 browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||"chrome"});
 const page=await browser.newPage({viewport:{width:1500,height:1050}}),errors=[];page.on("pageerror",e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 assert.equal(await page.locator("#listingOvokoEnabled").isChecked(),false);
 await page.evaluate(()=>document.querySelector("#vehiclesDialog").showModal());
 await page.locator("#vehicleManufacturerInput").fill("Volkswagen");await page.locator("#vehicleShortInput").fill("VW Golf VII");await page.locator("#vehicleFullInput").fill("Golf VII 2015 2.0 TDI");
 await page.locator("#workspaceCarOvokoDetails summary").click();await page.locator("#workspaceCarOvokoEnabled").check();
 await page.selectOption("#workspaceCarBrandId","1");await page.selectOption("#workspaceCarModelId","164");await page.locator("#workspaceCarYear").fill("2015");await page.locator("#workspaceCarVin").fill("WVWZZZ1KZAW000001");
 await page.locator("#addVehicleButton").click();await page.waitForFunction(()=>state.vehicles.length===1);
 assert.equal(library.size,1);assert.equal(carCreates,1);
 const id=[...library.keys()][0];
 await page.evaluate(()=>{state.vehicles=[];renderVehicles();document.querySelector("#workspaceCarsReload").click();});
 await page.waitForFunction(()=>document.querySelectorAll("[data-library-car]").length===1);
 await page.locator("[data-library-car]").click();assert.equal(await page.evaluate(()=>state.vehicles.length),1);
 assert.equal(await page.evaluate(()=>state.vehicles[0].libraryId),id);
 await page.locator("#closeVehiclesButton").click();
 await page.evaluate(()=>{state.selectedVehicleId=state.vehicles[0].id;document.querySelector("#summaryCard").classList.remove("hidden");});
 await page.locator("#listingOvokoEnabled").check();await page.locator("#listingOvokoPrice").fill("120.00");
 const captured=await page.evaluate(()=>ListingOvoko.capture(getSelectedVehicle()));assert.equal(captured.vehicleId,id);
 await page.evaluate(()=>{
  const config=ListingOvoko.capture(getSelectedVehicle());
  state.products=[{id:"part1",title:"Pompa Golf VII 1234567",stock:1,price:"100",photoNames:[],parameterValues:{},descriptionText:"Opis",ovokoListing:config}];
  activeProductId="";
  validateProductBeforePublish=()=>"";validateListingParameters=()=>"";getPublishLocation=()=>({city:"Test"});loadCategoryParameterDefinitions=async()=>[];uploadProductImages=async()=>["https://a.allegroimg.com/photo.jpg"];
  buildAllegroOfferPayload=()=>({description:{sections:[{items:[{type:"TEXT",content:"<p>Opis <b>Golf VII</b><br>2015</p>"}]}]}});
  window.allegroWrites=0;const original=apiRequest;
  apiRequest=async(path,options)=>{if(path==="/api/product-offers"){window.allegroWrites++;return {id:"555"};}return original(path,options);};
 });
 await page.evaluate(()=>publishProduct("part1"));
 assert.equal(await page.evaluate(()=>window.allegroWrites),1);assert.equal(partWrites,1);
 assert.equal(await page.evaluate(()=>state.products[0].publishStatus),"WYSTAWIONO");
 assert.match(await page.locator("#productList").textContent(),/Testowy blad Ovoko/);
 assert.equal(await page.locator("[data-publish-product-id]").textContent().then(s=>s.trim()),"Ponow tylko Ovoko");
 await page.locator("[data-edit-ovoko-product-id]").click();
 await page.waitForFunction(()=>document.querySelector("[data-save]")?.disabled===false);
 assert.equal(await page.locator("[data-price]").inputValue(),"120.00");
 assert.equal(await page.locator("[data-car]").inputValue(),id);
 await page.locator("[data-save]").click();
 failPart=false;await page.evaluate(()=>publishProduct("part1"));
 assert.equal(await page.evaluate(()=>window.allegroWrites),1,"Retry must never recreate Allegro");assert.equal(partWrites,2);
 assert.equal(await page.evaluate(()=>state.products[0].ovokoResult.partId),"222");
 const sent=requests.find(row=>row.path==="/api/ovoko/workspace-listing").body;
 assert.equal(sent.notes,"Opis Golf VII\n2015");assert.equal(sent.vehicleId,id);assert.equal(sent.stockMode,"shared");
 await page.evaluate(()=>publishProduct("part1"));assert.equal(partWrites,2,"Completed Ovoko cannot be recreated by repeated click");
 const roundtrip=await page.evaluate(()=>{const saved=sessionSnapshot();resetForm();state.vehicles=[];renderVehicles();ListingOvoko.restore(saved.products[0]);return {saved,value:ListingOvoko.capture(null)};});
 assert.equal(roundtrip.saved.products[0].ovokoListing.vehicleId,id);assert.equal(roundtrip.value.enabled,true);assert.equal(roundtrip.value.price,"120.00");
 assert.equal(library.size,1,"New session does not delete the persistent library");
 assert.deepEqual(errors,[]);
 await mkdir(new URL("../outputs/listing-ovoko-check/",import.meta.url),{recursive:true});
 await page.evaluate(()=>document.querySelector("#summaryCard").classList.remove("hidden"));
 await page.locator("section.workspace-ovoko-panel").filter({has:page.locator("#listingOvokoEnabled")}).screenshot({path:fileURLToPath(new URL("../outputs/listing-ovoko-check/form.png",import.meta.url))});
 await page.evaluate(()=>document.querySelector("#vehiclesDialog").showModal());
 await page.locator("#workspaceCarOvokoDetails").evaluate(el=>el.open=true);
 await page.locator("#vehiclesDialog").screenshot({path:fileURLToPath(new URL("../outputs/listing-ovoko-check/cars.png",import.meta.url))});
 console.log("Listing Ovoko browser: Allegro-only default, explicit donor fields, persistent library reuse across sessions, config snapshots, separate channel outcomes, resolved description and Ovoko-only retry passed. No live publications.");
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
