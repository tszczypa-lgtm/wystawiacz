import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
function load(name, require = () => { throw new Error("Unexpected dependency"); }) { const m={exports:{}};new Function("require","module","exports",ts.transpileModule(readFileSync(new URL(`../lib/${name}.ts`,import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(require,m,m.exports);return m.exports; }
const read=load("ovoko-read"),store=load("sales-sync-store",()=>read);
const carSelection=load("ovoko-car-selection");
const owner="00000000-0000-4000-8000-000000000001";
let mode, journal, decisions, applies, permitted, proof, recoveryCalls;
function reset(){mode="absent";journal={owner_id:owner,state:"uncertain",part_id:null,updated_at:new Date(Date.now()-3600000).toISOString()};decisions=[];applies=0;permitted=true;proof=null;recoveryCalls=[];}
const c={sellerId:"555",account:"a".repeat(64),clientId:"client",get fingerprint(){return mode==="rotate"?"changed":"fingerprint";},allegroSealed:"a-sealed",ovokoSealed:"o-sealed",
 allegro:async(path,init)=>{assert.equal(init,undefined);assert.equal(path,"/sale/offers?offer.id=10&limit=1");return{offers:mode==="foreign"?[]:[{id:"10"}]};},
 ovoko:async(path,form)=>{assert.equal(form,undefined,"No provider write during override");
  if(path.startsWith("/get/car_models/"))return{status_code:"R200",list:[{id:"31",brand:"7",name:"Model",year_start:"2000",year_end:"2020"}]};
  if(path.startsWith("/v2/get/cars?")){const present=["vehicle-present","vehicle-other-year"].includes(mode);return{status_code:"R200",data:present?[{id:"41",car_model:"31",car_years:mode==="vehicle-other-year"?"2011":"2010"}]:[],pagination:{page:1,limit:20,total_count:present?1:0}};}
  assert.ok(path.startsWith("/v2/get/parts?external_ids="));
  if(mode==="provider-failure")throw new Error("Provider unavailable");
  const data=mode==="present"||mode==="duplicate"||mode==="changed-external"?[{id:"20",external_id:mode==="changed-external"?"tymo:555:11":"tymo:555:10"}]:[];
  return{status_code:"R200",data,pagination:{page:1,limit:2,total_count:mode==="duplicate"?2:data.length}};
 }};
const db=async(path,init={})=>{
 if(path.startsWith("ovoko_single_publications?")||path.startsWith("ovoko_vehicle_creations?"))return journal?[journal]:[];
 if(path.startsWith("ovoko_manual_overrides?"))return decisions;
 const b=JSON.parse(init.body);assert.ok(["rpc/release_stale_ovoko_attempt","rpc/apply_ovoko_manual_override"].includes(path));assert.equal(b.p_owner,owner);assert.equal(b.p_allegro,"a-sealed");assert.equal(b.p_ovoko,"o-sealed");assert.deepEqual(b.p_expected,journal||{});
 if(mode==="foreign-owner-lock"&&path==="rpc/apply_ovoko_manual_override")throw new store.SyncDbError(400,"P0001","physical account ownership conflict");
 if(path==="rpc/release_stale_ovoko_attempt"){assert.equal(mode,"foreign-owner-lock");assert.equal(b.p_found,null);}
 applies++;const row={id:b.p_id,kind:b.p_kind,action:b.p_found?"reconciled":"released",found_id:b.p_found};decisions=[row];if(mode==="lost-ack")throw new Error("lost acknowledgment");return[row];
};
const {manualOvokoOverride:run,overrideDatabaseError:diagnose}=load("ovoko-manual-override",name=>{
 if(name==="./sales-sync-connections")return{syncConnections:async()=>{if(!permitted)throw new read.OvokoError(403,"revoked");return c;},syncAuthorization:async()=>{if(!permitted)throw new read.OvokoError(403,"revoked");}};
 if(name==="./sales-sync-store")return{...store,salesSyncDb:()=>db};if(name==="./ovoko-read")return read;
 if(name==="./ovoko-connection")return{ovokoConnectionKey:async()=>"key"};
 if(name==="./allegro-api")return{sealConnection:async p=>{proof=structuredClone(p);return"sealed";},openConnection:async token=>{if(token!=="sealed")throw new Error("bad seal");return structuredClone(proof);}};
 if(name==="./ovoko-publication-presence")return{ovokoPublicationPresent:async()=>mode==="known-present"};
 if(name==="./ovoko-car-selection")return carSelection;
 if(name==="./inventory-link-recovery")return{inventoryLinkRecovery:async(o,e,input)=>{assert.equal(o,owner);recoveryCalls.push(input);return input.operation==="check"?{id:"00000000-0000-4000-8000-000000000020",state:"prepared"}:{state:"applied"};}};
 throw new Error(name);
});
const check=(kind="part")=>run(owner,{}, {operation:"check",kind,offerId:"10",brandId:"7",modelId:"31",year:"2010"});
const confirm=p=>run(owner,{}, {operation:"confirm",token:p.token,brandId:"7",checkedOvoko:true,confirmRisk:true,typedOfferId:"10",reason:"Sprawdzono wszystkie statusy"});
reset();let p=await check();assert.equal(applies,0);assert.equal(p.foundId,null);assert.equal((await confirm(p)).action,"released");await confirm(p);assert.equal(applies,1);
reset();mode="present";p=await check();assert.equal(p.foundId,"20");assert.equal((await confirm(p)).action,"reconciled");
for(const m of["duplicate","foreign","changed-external","provider-failure"]){reset();mode=m;await assert.rejects(check());assert.equal(applies,0);}
reset();journal.updated_at=new Date().toISOString();await assert.rejects(check());
for(const m of["rotate","duplicate","foreign","provider-failure"]){reset();p=await check();mode=m;await assert.rejects(confirm(p));assert.equal(applies,0);}
reset();p=await check();permitted=false;await assert.rejects(confirm(p));assert.equal(applies,0);
reset();p=await check();proof.expires=Date.now()-1;await assert.rejects(confirm(p));assert.equal(applies,0);
reset();p=await check();await assert.rejects(run(owner,{}, {operation:"confirm",token:p.token,confirmRisk:true,checkedOvoko:true,typedOfferId:"wrong",reason:"Sprawdzono wszystkie statusy"}));
reset();p=await check();mode="lost-ack";await assert.rejects(confirm(p));assert.equal((await confirm(p)).resolved,true);assert.equal(applies,1);
reset();journal.part_id="20";mode="known-present";await assert.rejects(check());
reset();p=await check("vehicle");assert.equal(proof.brand,"7");assert.equal((await confirm(p)).kind,"vehicle");
reset();p=await check("vehicle");await assert.rejects(run(owner,{}, {operation:"confirm",token:p.token,brandId:"8",checkedOvoko:true,confirmRisk:true,typedOfferId:"10",reason:"Sprawdzono wszystkie statusy"}));assert.equal(applies,0);
reset();p=await check();assert.equal((await run(owner,{}, {operation:"confirm",token:p.token,brandId:"7",confirmManual:true})).resolved,true);assert.equal(applies,1,"Single explicit consent needs no typed ID or reason");
reset();p=await check();await assert.rejects(run(owner,{}, {operation:"confirm",token:p.token,confirmManual:false}));assert.equal(applies,0);
reset();journal=null;mode="present";p=await check();assert.equal(p.foundId,"20");await run(owner,{}, {operation:"confirm",token:p.token,confirmManual:true});assert.equal(recoveryCalls.length,0);assert.equal(applies,1,"Missing journal reconciles exact existing part without paused-sync recovery plan");
reset();journal=null;p=await check();assert.equal(p.resolved,true);assert.equal(recoveryCalls.length,0);assert.equal(applies,0);
reset();mode="present";journal.updated_at=new Date().toISOString();p=await check();assert.equal((await confirm(p)).action,"reconciled","Positive provider proof can repair a fresh uncertain row");
reset();p=await check();mode="present";await assert.rejects(confirm(p));assert.equal(applies,0,"Provider result changing after preview invalidates consent");
reset();mode="vehicle-present";journal.updated_at=new Date().toISOString();p=await check("vehicle");assert.equal(p.resolved,true);assert.equal(p.foundId,"41");assert.equal(applies,0,"Reusing a verified existing car never requires a synchronization ownership change or journal mutation");
reset();mode="vehicle-other-year";p=await check("vehicle");assert.equal(p.resolved,true);assert.equal(p.foundId,"41");assert.equal(applies,0,"Recovery uses the same saved-car reuse policy as publication, including a different technical year");
reset();await assert.rejects(run(owner,{}, {operation:"check",kind:"vehicle",offerId:"10",brandId:"7",modelId:"31",year:"2010",binding:{sellerId:"555",fingerprint:"other-account"}}),error=>error.code==="account_changed");assert.equal(applies,0,"An in-batch vehicle recovery cannot unlock a newly switched Ovoko account");
reset();mode="foreign-owner-lock";journal.owner_id="00000000-0000-4000-8000-000000000002";p=await check();assert.equal((await confirm(p)).resolved,true);assert.equal(applies,1,"Only the narrower old-row release runs after a known ownership-guard rejection");
for(const [code,reason,expected]of[["P0001","physical account ownership conflict",/innego konta Wystawiacza/],["P0001","pending sale action for this offer",/operacja sprzedazy/],["PGRST202",undefined,/jednorazowa poprawka bazy/],["42501",undefined,/odmowil uprawnien/],["P0001",undefined,/Nie uznano tego automatycznie za brak migracji/]]){
 const error=diagnose(new store.SyncDbError(400,code,reason),"rpc/release_stale_ovoko_attempt");assert.match(error.message,expected);assert.match(error.message,new RegExp(code));assert.equal(error.code,"override_database");
}
assert.doesNotMatch(diagnose(new Error("private-password-secret"),"rpc/release_stale_ovoko_attempt").message,/private-password-secret/);
const originalFetch=globalThis.fetch;
try{
 for(const body of[{code:"P0001",message:"physical account ownership conflict"},{code:"42501",message:"private-secret-database-detail"},{code:"private-secret-code",message:"private-secret-body"}]){
  globalThis.fetch=async()=>Response.json(body,{status:400});
  await assert.rejects(store.salesSyncDb({SUPABASE_SERVICE_ROLE_KEY:"fixture-key",NEXT_PUBLIC_SUPABASE_URL:"https://fixture.test"})("rpc/release_stale_ovoko_attempt"),error=>{
   assert.ok(error instanceof store.SyncDbError);assert.doesNotMatch(JSON.stringify(error),/private-secret/);assert.equal(error.databaseReason,body.message==="physical account ownership conflict"?body.message:undefined);return true;
  });
 }
}finally{globalThis.fetch=originalFetch;}
console.log("Manual override server: stale preview, explicit confirmations, provider presence/conflicts, token expiry, account binding, permissions, vehicle brand binding, idempotent lost DB acknowledgment, and zero provider writes passed. Fixtures only.");
