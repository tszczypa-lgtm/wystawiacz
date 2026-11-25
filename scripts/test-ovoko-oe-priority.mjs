import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
const root=fileURLToPath(new URL("../lib/",import.meta.url)), cache=new Map();
let number="5G0907044BF",catalog=true,manual=false,sourceTitle="",created=[],calls=[];
const source=()=>({id:"101",name:sourceTitle,category:{id:"cat"},parameters:[{id:"11323",name:"Stan",values:["Uzywany"],valuesIds:["11323_2"]}],stock:{available:1},publication:{status:"ACTIVE"},productSet:[{quantity:{value:1},product:{parameters:[{name:"Numer katalogowy czesci",values:[number]}]}}],images:["https://a.allegroimg.com/photo.jpg"],sellingMode:{price:{amount:"50.00",currency:"PLN"}}});
const brands=[{id:"2",name:"Volkswagen"}], models=[{id:"21",brand:"2",name:"Golf V",years:" - "},{id:"22",brand:"2",name:"Golf VII",years:" - "},{id:"23",brand:"2",name:"Touran III",years:" - "}];
const remote=async p=>{
 calls.push(p);
 if(p==="/get/categories")return{list:[{id:"3",pl:"Panel sterowania klimatyzacji",level:3,parent_id:0}]};
 if(p==="/get/part_quality")return{list:{0:{pl:"Uzywany"}}};
 if(p==="/get/part_status")return{list:{0:{pl:"Na stanie"}}};
 if(p==="/get/car_brands")return{list:brands};
 if(p==="/get/car_models/2")return{list:models.map(m=>({...m,year_start:0,year_end:0}))};
 if(p.startsWith("/v2/get/cars?"))return{status_code:"R200",data:[],pagination:{page:1,limit:20,total_count:0}};
 if(p.startsWith("/v2/get/parts?"))return{status_code:"R200",data:[]};
 throw new Error(p);
};
const api=async request=>{
 const p=new URL(request.url);calls.push(p.pathname+p.search);
 if(p.pathname==="/api/allegro/ovoko-source/101")return Response.json({offer:source(),sellerId:"555"});
 if(p.pathname==="/api/allegro/ovoko-fitment/101"){
  assert.equal(p.searchParams.get("number"),number,"Use the complete code, including BF/CH suffix");
  return Response.json({offerId:"101",number,rows:catalog?[{text:"Volkswagen Golf 7 2012/01-2019/12",origin:"catalog"}]:[],names:[]});
 }
 if(p.pathname==="/api/allegro/year-offers")return Response.json({offers:[]});
 throw new Error(p.pathname);
};
function load(file){
 if(cache.has(file))return cache.get(file).exports;
 const m={exports:{}};cache.set(file,m);
 new Function("require","module","exports",ts.transpileModule(readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>{
  if(name==="./account-api")return{};
  if(name==="./allegro-api")return{handleAllegroApi:api};
  if(name==="./ovoko-connection")return{loadOvokoConnection:async()=>({username:"own"}),ovokoConnectionKey:async()=>"key"};
  if(name==="./ovoko-write-client")return{ovokoWriteClient:()=>remote,ovokoWriteDigest:async()=>"fingerprint"};
  if(name==="./ovoko-create-car")return{createOvokoCar:async(_r,_e,_c,input)=>{created.push(input);return{carId:"13"};}};
  if(name==="./ovoko-publish")return{};
  if(name==="./ovoko-stock-publication")return{publicationStockMode:()=>"shared",readStockPublication:async()=>null};
  if(name==="./ovoko-publication-presence")return{};
  if(name.startsWith("."))return load(path.resolve(path.dirname(file),name+".ts"));
  throw new Error(name);
 },m,m.exports);return m.exports;
}
const {bulkOvokoPart}=load(path.join(root,"ovoko-bulk.ts"));
const {automaticOvokoModel}=load(path.join(root,"ovoko-suggestions.ts"));
assert.equal(automaticOvokoModel("VW Golf 7",models),"22");
assert.equal(automaticOvokoModel("VW Golf VII",models),"22");
assert.equal(automaticOvokoModel("VW Golf 5",models),"21");
const request=new Request("https://fixture.test/api/ovoko/bulk",{headers:{Authorization:"Bearer fixture"}});
let owner=0;
for(const code of ["5G0907044BF","5G0907044CH"]){
 for(const title of [`PANEL VOLKSWAGEN GOLF ${code}`,`PANEL VOLKSWAGEN GOLF 5 ${code}`,`PANEL VOLKSWAGEN GOLF 5 2005 ${code}`]){
  number=code;sourceTitle=title;created=[];calls=[];catalog=true;
  const result=await bulkOvokoPart(request,{OVOKO_PUBLISH_ENABLED:"true"},{user:{id:String(++owner)},db:async()=>[]},{operation:"prepare",offerId:"101",binding:{sellerId:"555",fingerprint:"fingerprint"},notes:"",overrides:{categoryId:"3"},adjustment:{mode:"none",value:"0"},expectedSource:{title,price:"50.00",currency:"PLN",stock:1,status:"ACTIVE",condition:"used",images:["https://a.allegroimg.com/photo.jpg"]}});
  assert.equal(result.prepared.modelId,"22","Exact full-code catalogue overrules misleading or generic title");
  assert.equal(created[0].year,"2012","Year comes from this exact code's compatibility range, not Golf V production dates");
  assert.equal(result.vehicle.yearSource,"allegro-fitment");assert.match(result.vehicle.evidence,/pelny MPN/);
  assert.equal(calls.filter(p=>p.startsWith("/api/allegro/ovoko-fitment/")).length,1,"Do not repeat the catalogue search for the year");
 }
}
// Manual vehicle selection remains explicit and does not get silently replaced.
manual=true;sourceTitle=`PANEL VOLKSWAGEN GOLF 5 ${number}`;created=[];calls=[];
const result=await bulkOvokoPart(request,{OVOKO_PUBLISH_ENABLED:"true"},{user:{id:String(++owner)},db:async()=>[]},{operation:"prepare",offerId:"101",binding:{sellerId:"555",fingerprint:"fingerprint"},notes:"",overrides:{categoryId:"3"},adjustment:{mode:"none",value:"0"},manualVehicle:manual,fallbackVehicle:{brandId:"2",modelId:"21",year:"2005"},expectedSource:{title:sourceTitle,price:"50.00",currency:"PLN",stock:1,status:"ACTIVE",condition:"used",images:["https://a.allegroimg.com/photo.jpg"]}});
assert.equal(result.prepared.modelId,"21");assert.equal(created[0].year,"2005");
assert.equal(calls.some(p=>p.startsWith("/api/allegro/ovoko-fitment/")),false);
// Last-resort web search may replace the initial Golf with a sourced Touran.
const originalFetch=globalThis.fetch,originalNow=Date.now;let charged=0,background=false,clockOffset=0;
Date.now=()=>originalNow()+clockOffset;
globalThis.fetch=async(url,options)=>{
 if(options.method==="POST"){
  assert.equal(url,"https://api.openai.com/v1/responses");charged++;const request=JSON.parse(options.body);
  assert.equal(JSON.parse(request.input).manufacturerNumber,"5G0907044CH");
  if(background)return Response.json({id:"resp_job123",status:"queued"});
 }else assert.match(url,/\/responses\/resp_job123\?/);
 const sourceUrl="https://ovoko.fr/les-pieces/test-5g0907044ch-touran-iii";
 return Response.json({status:"completed",output:[{type:"web_search_call",status:"completed",action:{type:"search",sources:[{url:sourceUrl}]}},{type:"message",status:"completed",content:[{type:"output_text",annotations:[],text:JSON.stringify({number:"5G0907044CH",matches:[{number:"5G0907044CH",make:"Volkswagen",model:"Touran III",year:"2019",sourceUrl,evidence:"5G0907044CH Volkswagen Touran III 2019"}]})}]}]});
};
try{
 catalog=false;number="5G0907044CH";sourceTitle=`PANEL VOLKSWAGEN GOLF 5 ${number}`;created=[];
 const answer=await bulkOvokoPart(request,{OVOKO_PUBLISH_ENABLED:"true",OPENAI_API_KEY:"fake-key"},{user:{id:String(++owner)},db:async()=>[]},{operation:"prepare",offerId:"101",binding:{sellerId:"555",fingerprint:"fingerprint"},notes:"",overrides:{categoryId:"3"},adjustment:{mode:"none",value:"0"},expectedSource:{title:sourceTitle,price:"50.00",currency:"PLN",stock:1,status:"ACTIVE",condition:"used",images:["https://a.allegroimg.com/photo.jpg"]}});
 assert.equal(charged,1);assert.equal(answer.prepared.modelId,"23");assert.equal(created[0].year,"2019");assert.equal(answer.vehicle.yearSource,"web-search");assert.match(answer.vehicle.sourceUrl,/^https:\/\/ovoko.fr\//);
 background=true;created=[];const context={user:{id:String(++owner)},db:async()=>[]};
 const input={operation:"prepare",offerId:"101",binding:{sellerId:"555",fingerprint:"fingerprint"},notes:"",overrides:{categoryId:"3"},adjustment:{mode:"none",value:"0"},expectedSource:{title:sourceTitle,price:"50.00",currency:"PLN",stock:1,status:"ACTIVE",condition:"used",images:["https://a.allegroimg.com/photo.jpg"]}};
 const pending=await bulkOvokoPart(request,{OVOKO_PUBLISH_ENABLED:"true",OPENAI_API_KEY:"fake-key"},context,input);
 assert.equal(pending.webPending,true);assert.equal(created.length,0,"Pending lookup must not create an Ovoko car");
 await bulkOvokoPart(request,{OVOKO_PUBLISH_ENABLED:"true",OPENAI_API_KEY:"fake-key"},context,input);assert.equal(charged,2,"Polling the pending preparation must not create another paid job");
 clockOffset=6000;
 const finished=await bulkOvokoPart(request,{OVOKO_PUBLISH_ENABLED:"true",OPENAI_API_KEY:"fake-key"},context,input);
 assert.equal(charged,2);assert.equal(finished.prepared.modelId,"23");assert.equal(created.length,1);assert.equal(created[0].year,"2019");
}finally{globalThis.fetch=originalFetch;Date.now=originalNow;}
console.log("OE priority: full BF/CH code lookup despite recognized title, numeric/Roman generation, exact-catalogue model override, catalogue year range, one lookup and manual selection passed. Providers mocked; no live publication.");
