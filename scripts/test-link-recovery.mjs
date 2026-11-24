import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
function load(name, require=()=>{throw new Error("dependency");}) { const m={exports:{}};new Function("require","module","exports",ts.transpileModule(readFileSync(new URL(`../lib/${name}.ts`,import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(require,m,m.exports);return m.exports; }
const read=load("ovoko-read"),store=load("sales-sync-store",()=>read);
const owner="00000000-0000-4000-8000-000000000001";
let mode,plans,journal,applies,dbMutations,reads,enabled,lease,permitted;
function reset(){mode="ok";plans=[];journal=[];applies=0;dbMutations=0;reads=0;enabled=false;lease=null;permitted=true;}
const c={sellerId:"555",account:"a".repeat(64),clientId:"client",get fingerprint(){return mode==="rotate"?"changed":"fingerprint";},allegroSealed:"a-sealed",ovokoSealed:"o-sealed",
 allegro:async(path,init)=>{assert.equal(init,undefined,"Recovery must never mutate Allegro");reads++;return{offers:mode==="foreign"?[]:[{id:"10",name:"Radio",stock:{available:1},publication:{status:"ACTIVE"}}]};},
 ovoko:async(path,form)=>{assert.equal(form,undefined,"Recovery must never call a provider write endpoint");reads++;assert.ok(path.startsWith("/v2/get/parts?"));const ext=path.includes("external_ids="),data=[{id:mode==="changed-part"?"21":"20",external_id:mode==="changed-external"?"tymo:555:11":"tymo:555:10",name:"Radio",status:"0"}];return{status_code:"R200",data,pagination:{page:1,limit:ext?2:100,total_count:mode==="duplicate"&&ext?2:1}};}};
const matches=(r,u)=>[...u.searchParams].every(([k,v])=>!v.startsWith("eq.")||String(r[k])===v.slice(3));
const db=async(path,init={})=>{
 const u=new URL(path,"https://db.test"),table=u.pathname.slice(1),b=init.body?JSON.parse(init.body):{};
 if(table==="sales_sync"||table==="sales_sync_reverse")return[{enabled,lease_until:lease}];
 if(table==="sales_sync_actions"||table==="sales_sync_reverse_actions")return mode==="uncertain-action"?[{id:"blocked"}]:[];
 if(table==="ovoko_single_publications")return structuredClone(journal);
 if(table==="inventory_link_recovery"){
  const found=plans.filter(p=>matches(p,u));if(init.method==="PATCH"){dbMutations++;found.forEach(p=>Object.assign(p,b));}return structuredClone(found);
 }
 if(table==="rpc/prepare_inventory_link_recovery"){
  dbMutations++;assert.equal(b.p_owner,owner);assert.equal(b.p_allegro,"a-sealed");assert.equal(b.p_ovoko,"o-sealed");
  const p={id:crypto.randomUUID(),owner_id:owner,seller_id:b.p_seller,ovoko_account:b.p_account,fingerprint:b.p_fingerprint,client_id:b.p_client,offer_id:b.p_offer,part_id:b.p_part,state:"prepared",expires_at:new Date(Date.now()+300000).toISOString()};plans.push(p);return[structuredClone(p)];
 }
 if(table==="rpc/apply_inventory_link_recovery"){
  assert.equal(b.p_owner,owner);const p=plans.find(p=>p.id===b.p_id);assert.equal(p.state,"prepared");assert.equal(journal.length,0);applies++;dbMutations++;
  journal=[{owner_id:owner,state:"created",part_id:p.part_id,origin:"recovered"}];p.state="applied";if(mode==="lost-ack")throw new Error("lost response");return true;
 }
 throw new Error(table);
};
const {inventoryLinkRecovery:run,recoveryCandidates}=load("inventory-link-recovery",name=>{
 if(name==="./sales-sync-connections")return{syncConnections:async()=>c,syncAuthorization:async()=>{if(!permitted)throw new read.OvokoError(403,"revoked");}};
 if(name==="./sales-sync-store")return{...store,salesSyncDb:()=>db};if(name==="./ovoko-read")return read;if(name==="./ovoko-write-client")return{ovokoWriteDigest:async()=>"b".repeat(64)};throw new Error(name);
});
const check=()=>run(owner,{}, {operation:"check",offerId:"10",partId:"20"}),confirm=p=>run(owner,{}, {operation:"confirm",planId:p.id,confirm:true});
reset();assert.deepEqual(recoveryCandidates([{id:"1",external_id:"tymo:555:10"},{id:"2",external_id:"tymo:666:10"},{id:"3",manufacturer_code:"123",name:"Same part"}],"555"),{rows:[{offerId:"10",partId:"1",name:"Czesc Ovoko"}],skipped:2});
assert.throws(()=>recoveryCandidates([{id:"2"},{id:"1"}],"555"));
let page=await run(owner,{}, {operation:"discover",page:1});assert.equal(page.readOnly,true);assert.equal(dbMutations,0);
let p=await check();assert.equal(p.state,"prepared");assert.equal(journal.length,0);assert.equal(applies,0);
await confirm(p);assert.equal(journal[0].origin,"recovered");assert.equal(applies,1);await confirm(p);assert.equal(applies,1,"Lost/double click never duplicates journal insertion");
assert.equal((await check()).alreadyLinked,true);assert.equal(applies,1);
for(const failure of ["duplicate","foreign","changed-part","changed-external","uncertain-action"]){reset();mode=failure;await assert.rejects(check());assert.equal(dbMutations,0,failure);}
for(const field of ["enabled","lease"]){reset();if(field==="enabled")enabled=true;else lease=new Date(Date.now()+60000).toISOString();await assert.rejects(check());assert.equal(dbMutations,0);}
for(const failure of ["rotate","duplicate","changed-external","foreign","uncertain-action"]){reset();p=await check();mode=failure;await assert.rejects(confirm(p));assert.equal(applies,0,failure);}
reset();p=await check();permitted=false;await assert.rejects(confirm(p));assert.equal(applies,0);
reset();p=await check();plans[0].expires_at="2000-01-01T00:00:00Z";await assert.rejects(confirm(p));assert.equal(applies,0);
reset();p=await check();await assert.rejects(run("other",{}, {operation:"confirm",planId:p.id,confirm:true}));await assert.rejects(run(owner,{}, {operation:"confirm",planId:p.id}));
reset();journal=[{owner_id:"other",state:"created",part_id:"20"}];await assert.rejects(check());assert.equal(dbMutations,0);
reset();journal=[{owner_id:owner,state:"uncertain",part_id:"20"}];await assert.rejects(check());assert.equal(dbMutations,0);
reset();p=await check();mode="lost-ack";await assert.rejects(confirm(p));assert.equal((await run(owner,{}, {operation:"plans"})).rows[0].state,"applied");await confirm(p);assert.equal(applies,1,"Readback resolves an ambiguous DB acknowledgement without reapplying");
reset();p=await check();await run(owner,{}, {operation:"cancel",planId:p.id,confirm:true});await assert.rejects(confirm(p));assert.equal(applies,0);
await assert.rejects(run(owner,{}, {operation:"check",offerId:"10",partId:"20",owner:"other"}));
console.log("Link recovery: explicit preview/confirmation, exact seller/external ID/part proof, missing-journal-only insertion, foreign/uncertain/duplicate/expired/changed guards, paused synchronization, idempotent DB recovery and zero provider writes passed. Provider/RPC fixtures only.");
