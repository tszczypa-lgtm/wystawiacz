import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import path from "node:path";
import {fileURLToPath} from "node:url";
import ts from "typescript";
const root=fileURLToPath(new URL("../",import.meta.url)),native=createRequire(import.meta.url),cache=new Map();
function load(file){
 if(cache.has(file))return cache.get(file).exports;
 const module={exports:{}};cache.set(file,module);
 new Function("require","module","exports",ts.transpileModule(readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText)(name=>name.startsWith(".")?load(path.resolve(path.dirname(file),name+".ts")):native(name),module,module.exports);
 return module.exports;
}
const {workspaceVehicles,validateWorkspaceVehicle}=load(path.join(root,"lib/workspace-vehicles.ts"));
const {workspaceVehicleOvoko}=load(path.join(root,"lib/workspace-vehicle-ovoko.ts"));
const {sealConnection}=load(path.join(root,"lib/allegro-api.ts"));
const owner="00000000-0000-4000-8000-000000000001",other="00000000-0000-4000-8000-000000000002";
const id="00000000-0000-4000-8000-000000000011",id2="00000000-0000-4000-8000-000000000012";
const payload={manufacturer:"Volkswagen",short:"Golf VII",buttonLabel:"Golf",full:"Golf VII 2015",ovoko:{brandId:"1",modelId:"164",year:"2015",vin:"WVWZZZ1KZAW000001",engineCode:"CR",capacity:"1968",power:"110",mileage:"190000",color:"bialy",place:"A1"}};
const rows=new Map(),links=new Map(),remoteCars=new Map();let writes=0,mode="ok",current=owner;
const bytes=new Uint8Array(32).fill(7),key=await crypto.subtle.importKey("raw",bytes,"AES-GCM",false,["encrypt","decrypt"]);
const credentials={username:"fixture",password:"private-password",user_token:"private-token"};
const env={BILLING_ENFORCED:"true",SUPABASE_SERVICE_ROLE_KEY:"fixture",ALLEGRO_ENCRYPTION_KEY:Buffer.from(bytes).toString("base64"),OVOKO_PUBLISH_ENABLED:"true"};
const db=async(query,options={})=>{
 const url=new URL("https://db.test/"+query),method=options.method||"GET",body=options.body?JSON.parse(options.body):null;
 if(url.pathname==="/ovoko_connections")return [{sealed:await sealConnection(credentials,key,`ovoko:v1:${owner}`)}];
 if(url.pathname==="/workspace_vehicles"){
  if(method==="POST"){
   if(rows.has(body.id))return [];
   assert.equal(body.owner_id,owner);rows.set(body.id,body);return [body];
  }
  assert.equal(url.searchParams.get("owner_id"),`eq.${owner}`);
  const row=rows.get(url.searchParams.get("id")?.slice(3));
  if(method==="PATCH"){
   if(!row||row.revision!==Number(url.searchParams.get("revision")?.slice(3)))return [];
   Object.assign(row,body);return [row];
  }
  return row?[structuredClone(row)]:[];
 }
 if(url.pathname==="/workspace_vehicle_ovoko"){
  assert.equal(url.searchParams.get("owner_id"),`eq.${owner}`);
  const vehicleId=url.searchParams.get("vehicle_id")?.slice(3),row=links.get(vehicleId);
  if(method==="GET")return row?[structuredClone(row)]:[];
  if(!row||url.searchParams.get("attempt_id")!==`eq.${row.attempt_id}`||url.searchParams.get("state")!==`eq.${row.state}`)return [];
  Object.assign(row,body);return [row];
 }
 if(url.pathname==="/rpc/reserve_workspace_vehicle"){
  assert.equal(body.p_owner,owner);assert.deepEqual(body.p_payload,rows.get(body.p_vehicle).payload);
  if(links.has(body.p_vehicle))return [];
  const row={owner_id:owner,vehicle_id:body.p_vehicle,ovoko_account:body.p_account,request_hash:body.p_hash,state:"sending",attempt_id:body.p_attempt};links.set(body.p_vehicle,row);return [row];
 }
 throw Error(query);
};
const context={user:{id:owner},db};
const req=(body,method="PUT",headers={})=>new Request("https://cars.test/api/workspace/vehicles",{method,headers:{Origin:"https://cars.test","Content-Type":"application/json",...headers},body:JSON.stringify(body)});
const originalFetch=globalThis.fetch;
globalThis.fetch=async(input,options={})=>{
 const url=new URL(input);
 if(url.pathname==="/auth/v1/user")return Response.json({id:current,email_confirmed_at:"2026-01-01"});
 if(url.pathname==="/rest/v1/customer_accounts")return Response.json([{owner_id:current,company:{},suspended:false}]);
 if(url.pathname==="/rest/v1/account_admins")return Response.json([{owner_id:current}]);
 if(url.pathname==="/rest/v1/ovoko_connections")return Response.json(await db("ovoko_connections"));
 assert.equal(url.origin,"https://api.rrr.lt");
 assert.equal(options.redirect,"manual");
 const form=new URLSearchParams(options.body);assert.equal(form.get("password"),credentials.password);
 if(url.pathname==="/get/car_models/1")return Response.json({status_code:"R200",list:[{id:"164",brand:"1",name:"Golf VII",year_start:"2012",year_end:"2020"}]});
 if(url.pathname==="/get/car_status")return Response.json({status_code:"R200",list:{"1":{en:"Added"}}});
 if(url.pathname==="/crm/importCar"){
  writes++;assert.equal(form.get("car_body_number"),payload.ovoko.vin);assert.equal(form.get("car_engine_power"),"110");
  assert.equal(form.get("external_id"),`tymo:vehicle:${owner}:${writes===1?id:id2}`);
  if(mode==="timeout")throw Error("timeout");
  const carId=String(100+writes);remoteCars.set(carId,{id:carId,car_model:"164",car_years:"2015",car_body_number:payload.ovoko.vin});
  return Response.json({status_code:"R200",car_id:carId});
 }
 if(url.pathname.startsWith("/get/car/"))return Response.json({status_code:"R200",list:[[remoteCars.get(url.pathname.split("/").at(-1))]]});
 throw Error(`Unexpected remote call: ${url}`);
};
try{
 assert.deepEqual(validateWorkspaceVehicle(payload),payload);
 assert.throws(()=>validateWorkspaceVehicle({...payload,ovoko:{...payload.ovoko,year:"2039"}}));
 await assert.rejects(workspaceVehicles(req(null),context),/wersja/);
 await assert.rejects(workspaceVehicles(req({id,revision:0,payload},"PUT",{Origin:"https://evil.test"}),context),/zrodlo/);
 await assert.rejects(workspaceVehicles(req({id,revision:0,payload:{...payload,full:"x".repeat(25000)}}),context),/dlugie/);
 const saved=await workspaceVehicles(req({id,revision:0,payload}),context);assert.equal(saved.vehicle.revision,1);
 await assert.rejects(workspaceVehicles(req({id,revision:0,payload}),context),/innej karcie/);
 await workspaceVehicles(req({id,revision:1,payload}),context);
 await assert.rejects(workspaceVehicles(req({id,revision:1,payload}),context),/innej karcie/);
 const remoteRequest=new Request("https://cars.test/api/ovoko/workspace-vehicle",{headers:{Authorization:"Bearer fixture"}});
 await assert.rejects(workspaceVehicleOvoko(remoteRequest,env,context,id,false),/Najpierw/);
 const first=await workspaceVehicleOvoko(remoteRequest,env,context,id,true);assert.equal(first.carId,"101");
 const reused=await workspaceVehicleOvoko(remoteRequest,env,context,id,true);assert.equal(reused.carId,"101");assert.equal(writes,1);
 await assert.rejects(workspaceVehicles(req({id,revision:2,payload:{...payload,ovoko:{...payload.ovoko,year:"2016"}}}),context),/techniczne/);
 await workspaceVehicles(req({id,revision:2,payload:{...payload,short:"Golf klienta"}}),context);
 await workspaceVehicles(req({id:id2,revision:0,payload}),context);
 const second=await workspaceVehicleOvoko(remoteRequest,env,context,id2,true);assert.equal(second.carId,"102");assert.equal(writes,2,"Two physical cars of the same model/year remain distinct");
 remoteCars.get("101").car_body_number="different";
 await assert.rejects(workspaceVehicleOvoko(remoteRequest,env,context,id,false),/konkretnego dawcy/);
 const third="00000000-0000-4000-8000-000000000013";
 await workspaceVehicles(req({id:third,revision:0,payload}),context);mode="timeout";
 await assert.rejects(workspaceVehicleOvoko(remoteRequest,env,context,third,true),/Nie potwierdzono/);
 const count=writes;await assert.rejects(workspaceVehicleOvoko(remoteRequest,env,context,third,true),/Poprzednie/);assert.equal(writes,count);
 current=other;links.clear();await assert.rejects(workspaceVehicleOvoko(remoteRequest,env,context,id,true),/Konto zmienilo/);
 console.log("Workspace vehicles: strict validation, own-account scopes, CAS, immutable technical data, physical donor identity, remote verification, uncertainty and account-change fencing passed.");
}finally{globalThis.fetch=originalFetch;}
