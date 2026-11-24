import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
function load(name, require = () => { throw new Error("Unexpected dependency"); }) { const source = ts.transpileModule(readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText; const module = { exports: {} }; new Function("require", "module", "exports", source)(require, module, module.exports); return module.exports; }
const read = load("ovoko-read"), store = load("sales-sync-store", n => { assert.equal(n, "./ovoko-read"); return read; });
let jobs, aStatus, aStock, aSold, oStatus, mode, writes, hash, permitted, dbWrites;
const owner = "00000000-0000-4000-8000-000000000001", env = { INVENTORY_WITHDRAW_ENABLED: "true" };
const digest = async value => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map(v => v.toString(16).padStart(2, "0")).join("");
function reset() { jobs = new Map(); aStatus = "ACTIVE"; aStock = 1; aSold = 0; oStatus = "0"; mode = "ok"; writes = []; hash = "a".repeat(64); permitted = true; dbWrites = []; }
function matches(row, search) { return [...search].every(([k, v]) => !v.startsWith("eq.") || String(row[k]) === v.slice(3)); }
const db = async (path, init = {}) => {
  const url = new URL(path, "https://db.test"); const table = url.pathname.slice(1), method = init.method || "GET", body = init.body ? JSON.parse(init.body) : undefined;
  if (table === "ovoko_single_publications") return [{ state: "created", part_id: "20", request_hash: hash }];
  if (table === "allegro_connections") return [{ sealed: mode === "rotate" ? "changed" : "a-sealed" }];
  if (table === "ovoko_connections") return [{ sealed: "o-sealed" }];
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
    const part = { id: "20", name: "Door", status: oStatus, external_id: mode === "foreign" ? "tymo:999:10" : "tymo:555:10" };
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
const sql = readFileSync(new URL("../supabase/017_inventory_operations.sql", import.meta.url), "utf8"); assert.match(sql, /enable row level security/); assert.match(sql, /revoke all.*from public,anon,authenticated/); assert.match(sql, /inventory_restore_once/);
console.log("Inventory operations: exact scopes incl. Ovoko-only, private reservation validation, durable per-target locks, partial timeout/no replay, stock/sold/generation/credential/role/CAS guards, non-mutating preparation, manual safe restore, plan cancellation and owner isolation passed. DB/provider fixtures only.");
