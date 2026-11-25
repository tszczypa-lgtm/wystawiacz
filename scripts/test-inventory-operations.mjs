import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
function load(name, require = () => { throw new Error("Unexpected dependency"); }) { const source = ts.transpileModule(readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText; const module = { exports: {} }; new Function("require", "module", "exports", source)(require, module, module.exports); return module.exports; }
const read = load("ovoko-read"), store = load("sales-sync-store", n => { assert.equal(n, "./ovoko-read"); return read; });
let jobs, aStatus, aStock, aSold, oStatus, mode, writes, hash, permitted, dbWrites, stockMode, saleState;
const owner = "00000000-0000-4000-8000-000000000001", env = { INVENTORY_WITHDRAW_ENABLED: "true" };
const digest = async value => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map(v => v.toString(16).padStart(2, "0")).join("");
function reset() { jobs = new Map(); aStatus = "ACTIVE"; aStock = 1; aSold = 0; oStatus = "0"; mode = "ok"; writes = []; hash = "a".repeat(64); permitted = true; dbWrites = []; stockMode = null; saleState = "running"; }
function matches(row, search) { return [...search].every(([k, v]) => !v.startsWith("eq.") || String(row[k]) === v.slice(3)); }
const db = async (path, init = {}) => {
  const url = new URL(path, "https://db.test"); const table = url.pathname.slice(1), method = init.method || "GET", body = init.body ? JSON.parse(init.body) : undefined;
  if (table === "ovoko_stock_units") {
    assert.equal(url.searchParams.get("ovoko_account"), "eq.account");
    if (url.searchParams.get("state") === "in.(sending,uncertain)") return mode === "publishing-group" ? [{ id: "in-flight-unit" }] : [];
    if (mode === "missing-units") throw new Error("missing table");
    if (!stockMode || mode === "no-unit") return [];
    const unit = { id: "00000000-0000-4000-8000-000000000003", group_id: "00000000-0000-4000-8000-000000000002", ovoko_account: "account", ordinal: mode === "ordinal" ? 2 : 1, external_id: "tymo:555:10:u:1", state: mode === "pending-unit" ? "pending" : "created", part_id: "20", request_hash: hash };
    return mode === "duplicate-unit" ? [unit, unit] : [unit];
  }
  if (table === "ovoko_stock_groups") {
    assert.equal(url.searchParams.get("ovoko_account"), "eq.account");
    if (mode === "missing-groups") throw new Error("missing table");
    return stockMode ? [{ id: "00000000-0000-4000-8000-000000000002", owner_id: mode === "foreign-owner" ? "other" : owner, ovoko_account: "account", seller_id: mode === "foreign-seller" ? "999" : "555", offer_id: "10", quantity: 3, mode: stockMode }] : [];
  }
  if (["sales_sync_actions", "sales_sync_reverse_actions", "ovoko_stock_actions"].includes(table)) {
    assert.equal(url.searchParams.get("state"), "in.(running,submitted,uncertain)");
    if (table === "ovoko_stock_actions") assert.equal(url.searchParams.get("ovoko_stock_units.group_id"), "eq.00000000-0000-4000-8000-000000000002");
    return mode === `pending-${table}` && ["running", "submitted", "uncertain"].includes(saleState) ? [{ id: "sale", state: saleState }] : [];
  }
  if (table === "ovoko_single_publications") return stockMode && mode !== "overlap" ? [] : [{ state: "created", part_id: "20", request_hash: hash }];
  if (table === "allegro_connections") return [{ sealed: mode === "rotate" ? "changed" : "a-sealed" }];
  if (table === "ovoko_connections") return [{ sealed: "o-sealed" }];
  if (table === "rpc/archive_inventory_reservation") {
    const job = jobs.get(body.p_id); assert.equal(body.p_owner, owner);
    if (!job || job.owner_id !== owner) throw new Error("owner mismatch");
    const restore = [...jobs.values()].find(j => j.parent_id === job.id);
    if (restore && restore.state !== "prepared") throw new Error("restore started");
    if (restore) Object.assign(restore, { state: "settled", allegro_state: "not_requested", ovoko_state: "not_requested" });
    job.closed = true; return [structuredClone(job)];
  }
  assert.equal(table, "inventory_operations");
  if (method === "POST") { if (jobs.has(body.id) || body.kind === "reserve" && [...jobs.values()].some(j => j.kind === "reserve" && !j.closed && j.target_key === body.target_key)) throw new Error("unique conflict"); jobs.set(body.id, structuredClone(body)); return [structuredClone(body)]; }
  let rows = [...jobs.values()].filter(j => matches(j, url.searchParams));
  if (method === "PATCH") { dbWrites.push(body); if (mode === "cas" && body.state === "running") rows = []; rows.forEach(j => Object.assign(j, body)); }
  if (url.searchParams.get("limit")) rows = rows.slice(0, Number(url.searchParams.get("limit")));
  return structuredClone(rows);
};
const c = { sellerId: "555", account: "account", fingerprint: "fingerprint", allegroSealed: "a-sealed", ovokoSealed: "o-sealed",
  allegro: async (path, init = {}) => {
    if (!init.method) return { offers: [{ id: "10", name: "Door", publication: { status: aStatus }, stock: { available: aStock, sold: aSold } }] };
    assert.equal(init.method, "PUT"); const id = path.split("/").at(-1), action = JSON.parse(init.body).publication.action;
    const job = jobs.get(id); assert.equal(job.state, "running"); assert.equal(job.allegro_state, "running", "Provider mutation must follow a durable target lock");
    assert.ok(["END", "ACTIVATE"].includes(action)); writes.push(["allegro", action]);
    if (mode === "timeout") throw new Error("timeout"); aStatus = action === "END" ? "ENDED" : "ACTIVE"; return { id };
  },
  ovoko: async (path, form) => {
    if (path === "/get/part_status") return { status_code: "R200", list: { "0": { pl: "Na stanie" }, "2": { pl: "Sprzedano" }, "4": { pl: "Wycofany" } } };
    const part = { id: "20", name: "Door", status: oStatus, external_id: mode === "foreign" ? "tymo:999:10" : stockMode ? "tymo:555:10:u:1" : "tymo:555:10" };
    if (path.startsWith("/get/part/")) return { status_code: "R200", list: [[part]] };
    if (path.startsWith("/v2/get/parts?")) return { status_code: "R200", data: [part], pagination: { page: 1, limit: 2, total_count: 1 } };
    assert.equal(path, "/crm/changePartStatus"); assert.ok([...jobs.values()].some(j => j.state === "running" && j.ovoko_state === "running")); writes.push(["ovoko", form.get("status")]); oStatus = form.get("status"); return { status_code: "R200" };
  } };
const { inventoryOperations: run } = load("inventory-operations", name => {
  if (name === "./sales-sync-connections") return { syncConnections: async () => c, syncAuthorization: async () => { if (!permitted) throw new read.OvokoError(403, "revoked"); } };
  if (name === "./sales-sync-store") return { ...store, salesSyncDb: () => db };
  if (name === "./ovoko-read") return read;
  if (name === "./ovoko-write-client") return { ovokoWriteDigest: digest };
  throw new Error(name);
});
const reservation = () => ({ customer: "Private customer", price: "100.00", deposit: "20", currency: "PLN", until: new Date(Date.now() + 3600000).toISOString(), comment: "Private note" });
const prepare = (kind = "reserve", extra = {}) => run(owner, env, { operation: "prepare", requestId: crypto.randomUUID(), kind, offerId: "10", partId: "20", targets: ["allegro", "ovoko"], ...(kind === "reserve" ? { reservation: reservation() } : {}), ...extra });
const execute = job => run(owner, env, { operation: "execute", jobId: job.id, confirm: true });
reset();
let job = await prepare(); assert.equal(writes.length, 0); assert.equal(job.reservation.customer, "Private customer");
job = await execute(job); assert.equal(job.allegro, "done"); assert.equal(job.ovoko, "done"); assert.deepEqual(writes, [["allegro", "END"], ["ovoko", "4"]]);
await execute(job); assert.equal(writes.length, 2, "Duplicate confirmation never repeats writes");
let restore = await run(owner, env, { operation: "prepare-restore", requestId: crypto.randomUUID(), reservationId: job.id });
assert.equal(writes.length, 2); const same = await run(owner, env, { operation: "prepare-restore", requestId: crypto.randomUUID(), reservationId: job.id }); assert.equal(same.id, restore.id, "One restore tombstone per reservation");
restore = await execute(restore); assert.equal(restore.allegro, "done"); assert.equal(restore.ovoko, "done"); assert.equal(jobs.get(job.id).closed, true); assert.deepEqual(writes.slice(2), [["allegro", "ACTIVATE"], ["ovoko", "0"]]);
assert.equal((await run(owner, env, { operation: "list" })).rows.length, 0);
for (const failure of ["stock", "sold", "generation", "restocked-sale"]) { reset(); job = await execute(await prepare()); if (failure === "stock") aStock = 0; if (failure === "sold") oStatus = "2"; if (failure === "generation") hash = "b".repeat(64); if (failure === "restocked-sale") aSold = 1; await assert.rejects(run(owner, env, { operation: "prepare-restore", requestId: crypto.randomUUID(), reservationId: job.id })); assert.equal(writes.length, 2, failure); }
reset(); mode = "timeout"; job = await execute(await prepare()); assert.equal(job.allegro, "uncertain"); assert.equal(job.ovoko, "done"); await execute(job); assert.equal(writes.length, 2); aStatus = "ENDED"; job = await run(owner, env, { operation: "status", jobId: job.id }); assert.equal(job.allegro, "done"); assert.equal(writes.length, 2, "Readback only");
for (const failure of ["rotate", "cas", "revoke"]) { reset(); job = await prepare("withdraw"); if (failure === "revoke") permitted = false; else mode = failure; await execute(job).catch(() => {}); assert.equal(writes.length, 0, failure); }
reset(); job = await prepare(); await run(owner, env, { operation: "cancel-plan", jobId: job.id, confirm: true }); assert.equal(jobs.get(job.id).closed, true); assert.equal(writes.length, 0);
reset(); oStatus = "2"; job = await execute(await prepare("withdraw", { targets: ["allegro"] })); assert.deepEqual(writes, [["allegro", "END"]]); assert.equal(job.ovoko, "not_requested");
reset(); job = await execute(await prepare("withdraw", { offerId: null, targets: ["ovoko"] })); assert.deepEqual(writes, [["ovoko", "4"]]);
reset(); mode = "foreign"; await assert.rejects(prepare()); assert.equal(writes.length, 0);
reset(); await assert.rejects(prepare("reserve", { reservation: { ...reservation(), deposit: "101" } })); await assert.rejects(prepare("reserve", { reservation: { ...reservation(), until: "2000-01-01T00:00:00Z" } }));
job = await prepare(); await assert.rejects(run("other", env, { operation: "status", jobId: job.id })); await assert.rejects(run(owner, env, { operation: "execute", jobId: job.id }));
reset(); job = await execute(await prepare()); const countBeforeArchive = writes.length;
await run(owner, env, { operation: "archive", jobId: job.id, confirm: true }); assert.equal(jobs.get(job.id).closed, true); assert.equal(writes.length, countBeforeArchive, "Removing a reservation never restores or deletes portal listings");
reset(); job = await execute(await prepare()); await run(owner, env, { operation: "prepare-restore", reservationId: job.id, requestId: crypto.randomUUID() }); await run(owner, env, { operation: "archive", jobId: job.id, confirm: true }); assert.equal(writes.length, 2, "Unstarted restore is cancelled without provider mutations");
reset(); job = await prepare(); const anchor = jobs.get(job.id); anchor.offer_id = "11"; anchor.part_id = "21"; anchor.target_key = "a:11";
const appended = await prepare("reserve", { reservationId: job.id, reservation: { ...reservation(), customer: "Tampered customer", price: "75", deposit: "5" } });
assert.equal(appended.reservation.groupId, job.id); assert.equal(appended.reservation.customer, "Private customer"); assert.equal(appended.reservation.price, "75"); assert.equal(writes.length, 0);
await assert.rejects(prepare("reserve", { reservationId: crypto.randomUUID() }));
anchor.closed = true; await assert.rejects(prepare("reserve", { reservationId: job.id }));
const sql = readFileSync(new URL("../supabase/017_inventory_operations.sql", import.meta.url), "utf8"); assert.match(sql, /enable row level security/); assert.match(sql, /revoke all.*from public,anon,authenticated/); assert.match(sql, /inventory_restore_once/);
const extraSql = readFileSync(new URL("../supabase/019_sync_ownership_reservations.sql", import.meta.url), "utf8"); assert.match(extraSql, /pg_advisory_xact_lock/); assert.match(extraSql, /ovoko_account text not null unique/); assert.match(extraSql, /owner_id uuid not null unique/); assert.match(extraSql, /before insert.*inventory_operations/); assert.match(extraSql, /parent_id=p_id.*for update/);
for (const value of ["separate", "shared"]) {
  reset(); stockMode = value;
  await assert.rejects(prepare(), /Rezerwacje grup/); assert.equal(jobs.size, 0); assert.equal(writes.length, 0);
  await assert.rejects(prepare("reserve", { partId: null, targets: ["allegro"] }), /Rezerwacje grup/);
  await assert.rejects(prepare("reserve", { offerId: null, targets: ["ovoko"] }), /Rezerwacje grup/);
  job = await prepare("withdraw"); assert.equal(jobs.get(job.id).publication_hash, hash); assert.equal(jobs.get(job.id).external_id, "tymo:555:10:u:1");
  job = await execute(job); assert.equal(job.allegro, "done"); assert.equal(job.ovoko, "done");
  reset(); stockMode = value; job = await prepare("withdraw", { targets: ["ovoko"] }); await execute(job); assert.deepEqual(writes, [["ovoko", "4"]]);
  for (const failure of ["foreign-owner", "foreign-seller", "foreign", "duplicate-unit", "no-unit", "pending-unit", "ordinal", "overlap", "missing-units", "missing-groups", "pending-sales_sync_actions", "pending-sales_sync_reverse_actions", "pending-ovoko_stock_actions", "publishing-group"]) {
    reset(); stockMode = value; mode = failure;
    await assert.rejects(prepare("withdraw"), undefined, `${value}:${failure}`); assert.equal(jobs.size, 0); assert.equal(writes.length, 0);
  }
  for (const failure of ["pending-sales_sync_actions", "pending-sales_sync_reverse_actions", "pending-ovoko_stock_actions", "generation"]) {
    reset(); stockMode = value; job = await prepare("withdraw");
    if (failure === "generation") hash = "b".repeat(64); else mode = failure;
    await assert.rejects(execute(job)); assert.equal(writes.length, 0);
  }
  for (const table of ["sales_sync_actions", "sales_sync_reverse_actions", "ovoko_stock_actions"]) {
    for (const state of ["review", "waiting", "queued", "preflight", "done"]) {
      reset(); stockMode = value; mode = `pending-${table}`; saleState = state;
      job = await execute(await prepare("withdraw")); assert.equal(job.ovoko, "done", `${value}:${table}:${state}`);
    }
    for (const state of ["running", "submitted", "uncertain"]) {
      reset(); stockMode = value; mode = `pending-${table}`; saleState = state;
      await assert.rejects(prepare("withdraw")); assert.equal(writes.length, 0, `${value}:${table}:${state}`);
    }
  }
}
console.log("Inventory operations: legacy behavior plus shared/separate exact unit binding, reservation rejection at remaining stock one, pending sales, owner/account isolation and no replay passed.");
