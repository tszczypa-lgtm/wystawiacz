import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {pathToFileURL} from "node:url";
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE).href),db=new PGlite();
const owner="00000000-0000-4000-8000-000000000001",account="a".repeat(64);
try {
 await db.exec("create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;create role service_role bypassrls;create table public.allegro_connections(owner_id uuid primary key,sealed text);create table public.ovoko_connections(owner_id uuid primary key,sealed text)");
 await db.query("insert into auth.users values($1)",[owner]);
 await db.query("insert into public.allegro_connections values($1,'a')",[owner]);await db.query("insert into public.ovoko_connections values($1,'o')",[owner]);
 for(const file of["013_ovoko_vehicle_creations.sql","025_independent_vehicle_recovery.sql","025_independent_vehicle_recovery.sql"])await db.exec(await readFile(new URL(`../supabase/${file}`,import.meta.url),"utf8"));
 assert.equal((await db.query("select to_regclass('public.sales_sync') as relation")).rows[0].relation,null,"No optional synchronization tables installed");
 await db.exec("grant usage on schema public to service_role;grant select on public.allegro_connections,public.ovoko_connections to service_role;set role service_role");
 const snapshot=async()=> (await db.query("select to_jsonb(j) as row from public.ovoko_vehicle_creations j")).rows[0]?.row;
 const seed=async(state="uncertain",age="0 minutes")=>{await db.query("insert into public.ovoko_vehicle_creations(owner_id,ovoko_account,model_id,vehicle_year,state,updated_at) values($1,$2,'31','2010',$3,now()-$4::interval)",[owner,account,state,age]);return snapshot();};
 const release=(row,{id=crypto.randomUUID(),sealed="a",kind="vehicle",found=null}={})=>db.query("select * from public.release_ovoko_vehicle_attempt($1,$2,$3,$4,'555','10','31','2010',$5,$6,'Sprawdzono wszystkie statusy',$7,'o')",[owner,id,kind,account,row,found,sealed]);
 let row=await seed();
 await assert.rejects(release(row,{sealed:"changed"}),/connection changed/);
 await assert.rejects(release(row,{kind:"part"}),/invalid vehicle override/);
 await assert.rejects(release(row,{found:"41"}),/invalid vehicle override/);
 await assert.rejects(release({...row,attempt_id:crypto.randomUUID()}),/operation changed/);
 const id=crypto.randomUUID();assert.equal((await release(row,{id})).rows[0].action,"released");assert.equal((await release(row,{id})).rows[0].id,id,"Idempotent after lost acknowledgement");assert.equal(await snapshot(),undefined);
 row=await seed("sending");await assert.rejects(release(row),/vehicle operation in progress/);
 await db.query("update public.ovoko_vehicle_creations set updated_at=now()-interval '6 minutes'");row=await snapshot();await release(row);
 row=await seed();assert.notEqual(row.attempt_id,(await db.query("select previous_row from public.ovoko_manual_overrides where id=$1",[id])).rows[0].previous_row.attempt_id);
 assert.equal((await db.query("update public.ovoko_vehicle_creations set state='created',car_id='41' where attempt_id=$1 returning *",[(await db.query("select previous_row from public.ovoko_manual_overrides where id=$1",[id])).rows[0].previous_row.attempt_id])).rows.length,0,"A late writer cannot change the new attempt");
 for(const role of["anon","authenticated"]){await db.exec(`reset role;set role ${role}`);await assert.rejects(release(row),/permission denied/);}
 await db.exec("reset role;set role service_role");await release(row);
 assert.equal((await db.query("select * from public.ovoko_manual_overrides")).rows.length,3,"Only successful explicit decisions are audited");
 console.log("Independent vehicle SQL: core-only schema, rerun, service role, consent snapshot, credentials, fresh uncertainty, active write, stale write, idempotence and late-writer fencing passed.");
}finally{await db.close();}
