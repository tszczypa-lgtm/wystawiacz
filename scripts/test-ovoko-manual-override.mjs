import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
function load(name, require = () => { throw new Error("Unexpected dependency"); }) { const m={exports:{}};new Function("require","module","exports",ts.transpileModule(readFileSync(new URL(`../lib/${name}.ts`,import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(require,m,m.exports);return m.exports; }
const read=load("ovoko-read"),store=load("sales-sync-store",()=>read);
const owner="00000000-0000-4000-8000-000000000001";
let mode, journal, decisions, applies, permitted, proof;
function reset(){mode="absent";journal={owner_id:owner,state:"uncertain",part_id:null,updated_at:new Date(Date.now()-3600000).toISOString()};decisions=[];applies=0;permitted=true;proof=null;}
const c={sellerId:"555",account:"a".repeat(64),clientId:"client",get fingerprint(){return mode==="rotate"?"changed":"fingerprint";},allegroSealed:"a-sealed",ovokoSealed:"o-sealed",
 allegro:async(path,init)=>{assert.equal(init,undefined);assert.equal(path,"/sale/offers?offer.id=10&limit=1");return{offers:mode==="foreign"?[]:[{id:"10"}]};},
 ovoko:async(path,form)=>{assert.equal(form,undefined,"No provider write during override");
  if(path.startsWith("/get/car_models/"))return{status_code:"R200",list:[{id:"31",brand:"7",name:"Model",year_start:"2000",year_end:"2020"}]};
  if(path.startsWith("/v2/get/cars?"))return{status_code:"R200",data:[],pagination:{page:1,limit:20,total_count:0}};
  assert.ok(path.startsWith("/v2/get/parts?external_ids="));
  if(mode==="provider-failure")throw new Error("Provider unavailable");
  const data=mode==="present"||mode==="duplicate"||mode==="changed-external"?[{id:"20",external_id:mode==="changed-external"?"tymo:555:11":"tymo:555:10"}]:[];
  return{status_code:"R200",data,pagination:{page:1,limit:2,total_count:mode==="duplicate"?2:data.length}};
 }};
const db=async(path,init={})=>{
 if(path.startsWith("ovoko_single_publications?")||path.startsWith("ovoko_vehicle_creations?"))return[journal];
 if(path.startsWith("ovoko_manual_overrides?"))return decisions;
 assert.equal(path,"rpc/apply_ovoko_manual_override");const b=JSON.parse(init.body);assert.equal(b.p_owner,owner);assert.equal(b.p_allegro,"a-sealed");assert.equal(b.p_ovoko,"o-sealed");assert.deepEqual(b.p_expected,journal);
 applies++;const row={id:b.p_id,kind:b.p_kind,action:b.p_found?"reconciled":"released",found_id:b.p_found};decisions=[row];if(mode==="lost-ack")throw new Error("lost acknowledgment");return[row];
};
const {manualOvokoOverride:run}=load("ovoko-manual-override",name=>{
 if(name==="./sales-sync-connections")return{syncConnections:async()=>{if(!permitted)throw new read.OvokoError(403,"revoked");return c;},syncAuthorization:async()=>{if(!permitted)throw new read.OvokoError(403,"revoked");}};
 if(name==="./sales-sync-store")return{...store,salesSyncDb:()=>db};if(name==="./ovoko-read")return read;
 if(name==="./ovoko-connection")return{ovokoConnectionKey:async()=>"key"};
 if(name==="./allegro-api")return{sealConnection:async p=>{proof=structuredClone(p);return"sealed";},openConnection:async token=>{if(token!=="sealed")throw new Error("bad seal");return structuredClone(proof);}};
 if(name==="./ovoko-publication-presence")return{ovokoPublicationPresent:async()=>mode==="known-present"};
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
console.log("Manual override server: stale preview, explicit confirmations, provider presence/conflicts, token expiry, account binding, permissions, vehicle brand binding, idempotent lost DB acknowledgment, and zero provider writes passed. Fixtures only.");
