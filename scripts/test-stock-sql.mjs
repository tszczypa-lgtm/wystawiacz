import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const db = new PGlite();
const owners = [1,2,3].map(i => `00000000-0000-4000-8000-00000000000${i}`), [a,b,c] = owners;
const account = "a".repeat(64), other = "b".repeat(64), third = "c".repeat(64);
try {
  await db.exec("create schema auth; create table auth.users(id uuid primary key); create role anon; create role authenticated; create role service_role;");
  for (const owner of owners) await db.query("insert into auth.users values($1)", [owner]);
  for (const file of ["016_sales_sync.sql", "017_inventory_operations.sql", "018_reverse_sales_sync.sql", "019_sync_ownership_reservations.sql", "019_sync_ownership_reservations.sql"]) await db.exec(await readFile(new URL(`../supabase/${file}`, import.meta.url), "utf8"));
  const lock = async (owner, seller, ovoko, mode = "claim") => (await db.query("select public.sync_account_lock($1,$2,$3,$4) as ok", [owner, seller, ovoko, mode])).rows[0].ok;
  assert.equal(await lock(a,"555",account), true); assert.equal(await lock(a,"555",account), true);
  assert.equal(await lock(b,"555",other), false); assert.equal(await lock(b,"666",account), false); assert.equal(await lock(a,"666",other), false);
  assert.equal(await lock(b,"666",other), true); assert.equal(await lock(a,"555",account,"check"), true); assert.equal(await lock(b,"555",account,"check"), false);
  await db.query("insert into public.sales_sync(owner_id,epoch,enabled,seller_id,ovoko_account,fingerprint,client_id,armed_at) values($1,gen_random_uuid(),true,'555',$2,'f','client',now())", [a,account]);
  assert.equal(await lock(a,null,null,"release"), false);
  await db.query("update public.sales_sync set enabled=false,lease_until=now()+interval '5 minutes' where owner_id=$1", [a]); assert.equal(await lock(a,null,null,"release"), false);
  await db.query("update public.sales_sync set lease_until=null where owner_id=$1", [a]);
  await db.query("insert into public.sales_sync_actions(owner_id,epoch,seller_id,offer_id,part_id,publication_hash,item_id,bought_at,state) values($1,gen_random_uuid(),'555','10','20','hash','item',now(),'uncertain')", [a]);
  assert.equal(await lock(a,null,null,"release"), false);
  await db.query("update public.sales_sync_actions set state='done' where owner_id=$1", [a]); assert.equal(await lock(a,null,null,"release"), true); assert.equal(await lock(a,"555",account,"check"), false);
  await lock(b,null,null,"release"); assert.equal(await lock(b,"555",account), true);
  await db.query("insert into public.sales_sync_reverse(owner_id,epoch,enabled,seller_id,ovoko_account,fingerprint,client_id,armed_at,baseline,watch) values($1,gen_random_uuid(),true,'777',$2,'f','client',now(),'[]','[]')", [c,third]);
  assert.equal(await lock(a,"777",third), false, "Existing pre-migration reverse consent also prevents duplicate ownership");
  await db.query("update public.sales_sync_reverse set enabled=false where owner_id=$1", [c]); assert.equal(await lock(a,"777",third), true);
  async function reservation() {
    const id = crypto.randomUUID();
    await db.query("insert into public.inventory_operations(id,owner_id,kind,request_hash,target_key,seller_id,ovoko_account,fingerprint,name,targets,closed,state,allegro_state,ovoko_state,expires_at) values($1::uuid,$2,'reserve','hash',$1::text,'555',$3,'f','Fixture','[\"allegro\",\"ovoko\"]',false,'settled','done','done',now()+interval '1 hour')", [id,a,account]); return id;
  }
  async function restore(parent, owner = a) {
    const id = crypto.randomUUID();
    await db.query("insert into public.inventory_operations(id,owner_id,parent_id,kind,request_hash,target_key,seller_id,ovoko_account,fingerprint,name,targets,closed,state,allegro_state,ovoko_state,expires_at) values($1::uuid,$2,$3,'restore','hash',$1::text,'555',$4,'f','Fixture','[\"allegro\"]',true,'prepared','pending','not_requested',now()+interval '1 hour')", [id,owner,parent,account]); return id;
  }
  const archive = (owner,id) => db.query("select * from public.archive_inventory_reservation($1,$2)", [owner,id]);
  const first = await reservation(), plan = await restore(first);
  await assert.rejects(archive(b,first)); assert.equal((await archive(a,first)).rows[0].closed,true);
  assert.equal((await db.query("select state from public.inventory_operations where id=$1",[plan])).rows[0].state,"settled");
  assert.equal((await db.query("update public.inventory_operations set state='running' where id=$1 and state='prepared' returning id",[plan])).rows.length,0,"Archived unstarted restore loses execution CAS");
  await assert.rejects(restore(first));
  const second = await reservation(), running = await restore(second);
  await db.query("update public.inventory_operations set state='running' where id=$1",[running]); await assert.rejects(archive(a,second));
  assert.equal((await db.query("select closed from public.inventory_operations where id=$1",[second])).rows[0].closed,false);
  await assert.rejects(restore(await reservation(),b));
  await db.exec("set role anon");
  await assert.rejects(db.query("select * from public.sales_sync_accounts")); await assert.rejects(lock(a,"777",third)); await assert.rejects(archive(a,second));
  await db.exec("reset role; set role authenticated"); await assert.rejects(db.query("select * from public.inventory_operations")); await db.exec("reset role");
  console.log("Local PostgreSQL/WASM: migrations 016-019 and rerun, single physical-account ownership, old-consent/lease/uncertain guards, safe release, archive/restore row locks and browser-role denial passed. No production DB or providers used; multi-connection deployment testing remains required.");
} catch (e) { console.error(e.message, e.query || ""); process.exitCode = 1; } finally { await db.close(); }
