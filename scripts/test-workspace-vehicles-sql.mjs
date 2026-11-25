import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {pathToFileURL} from "node:url";
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE).href),db=new PGlite();
const owner="00000000-0000-4000-8000-000000000001",other="00000000-0000-4000-8000-000000000002",id="00000000-0000-4000-8000-000000000011",account="a".repeat(64),hash="b".repeat(64);
try{
 await db.exec("create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;create role service_role bypassrls;create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated");
 await db.query("insert into auth.users values($1),($2)",[owner,other]);
 const sql=await readFile(new URL("../supabase/027_workspace_vehicles.sql",import.meta.url),"utf8");await db.exec(sql);await db.exec(sql);
 const payload={manufacturer:"VW",short:"Golf",buttonLabel:"",full:"Golf VII",ovoko:{modelId:"164",year:"2015"}};
 await db.query("insert into workspace_vehicles(owner_id,id,payload) values($1,$2,$3),($4,$2,$3)",[owner,id,payload,other]);
 const reserve=(body=payload)=>db.query("select * from reserve_workspace_vehicle($1,$2,$3,$4,$5,$6)",[owner,id,body,account,hash,crypto.randomUUID()]);
 await db.exec("set role service_role");assert.equal((await reserve({...payload,short:"stale"})).rows.length,0);
 assert.equal((await reserve()).rows.length,1);assert.equal((await reserve()).rows.length,0);
 await assert.rejects(db.query("update workspace_vehicles set payload=$1 where owner_id=$2 and id=$3",[{...payload,ovoko:{modelId:"165",year:"2015"}},owner,id]),/immutable/);
 await db.query("update workspace_vehicles set payload=$1 where owner_id=$2 and id=$3",[{...payload,short:"New name"},owner,id]);
 await db.exec(`reset role;set role authenticated;set request.jwt.claim.sub='${owner}'`);
 assert.equal((await db.query("select * from workspace_vehicles")).rows.length,1);
 assert.equal((await db.query("select * from workspace_vehicle_ovoko")).rows.length,1);
 await assert.rejects(reserve(),/permission denied/);
 await assert.rejects(db.query("delete from workspace_vehicles"),/permission denied/);
 await db.exec("reset role;set role anon");await assert.rejects(db.query("select * from workspace_vehicles"),/permission denied/);
 console.log("Workspace vehicle SQL: rerunnable migration, owner RLS, no direct client writes, atomic snapshot reservation, immutable linked donor and permitted descriptive edits passed.");
}finally{await db.close();}
