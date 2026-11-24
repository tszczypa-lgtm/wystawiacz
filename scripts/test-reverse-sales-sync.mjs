import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
function load(name, require = () => { throw new Error("dependency"); }) { const code = ts.transpileModule(readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText; const module = { exports: {} }; new Function("require", "module", "exports", code)(require, module, module.exports); return module.exports; }
const read = load("ovoko-read"), store = load("sales-sync-store", () => read), parser = load("ovoko-sale-evidence", () => read), ownership = load("sales-sync-ownership", name => name === "./ovoko-read" ? read : store);
const owner = "00000000-0000-4000-8000-000000000001", env = { SALES_SYNC_ENABLED: "true" };
let s, jobs, orders, mode, aStatus, stock, oStatus, writes, lastError, sourceReads, linkedCount;
const record = () => ({ order_id: "100", order_source: "ovoko", order_status: "NEW", order_date: new Date().toISOString().slice(0, 19).replace("T", " "), item_list: [{ id: "20", external_id: "tymo:555:10" }], client_email: "private@test" });
const match = (row, query) => [...query].every(([k, v]) => v.startsWith("eq.") ? String(row[k]) === v.slice(3) : v.startsWith("in.(") ? v.slice(4, -1).split(",").includes(String(row[k])) : true);
function reset() { s = undefined; jobs = []; orders = [record()]; mode = "ok"; aStatus = "ACTIVE"; stock = 1; oStatus = "0"; writes = []; lastError = null; sourceReads = 0; linkedCount = 40000; }
const db = async (path, init = {}) => {
  const u = new URL(path, "https://db.test"), table = u.pathname.slice(1), method = init.method || "GET", b = init.body ? JSON.parse(init.body) : {};
  if (table === "rpc/sync_account_lock") return mode !== "ownership-conflict";
  if (table === "rpc/reverse_sales_sync_coverage") { if(mode==="missing-migration")throw new Error("missing RPC");return{scopeVersion:2,linked:s?linkedCount:0,blocked:0}; }
  if (table === "sales_sync_reverse") {
    if (method === "POST") { s = structuredClone(b); return [structuredClone(s)]; }
    const found = s && match(s, u.searchParams);
    if (method === "PATCH" && found) { Object.assign(s, b); if (b.last_error) lastError = b.last_error; }
    return found ? [structuredClone(s)] : [];
  }
  if (table === "rpc/claim_reverse_sales_sync") { if (!s?.enabled || s.lease) return []; s.lease = crypto.randomUUID(); s.lease_until = new Date(Date.now() + 300000).toISOString(); return [structuredClone(s)]; }
  if (table === "rpc/ingest_reverse_sales_sync") {
    assert.equal(b.p_lease, s.lease); assert.doesNotMatch(JSON.stringify(b), /private|client_email/);
    for (const row of b.p_rows) {
      if (s.baseline.includes(row.orderId)) continue;
      const old = jobs.find(j => j.part_id === row.partId);
      if (!old) jobs.push({ id: crypto.randomUUID(), owner_id: owner, epoch: s.epoch, order_id: row.orderId, offer_id: "10", part_id: "20", publication_hash: "a".repeat(64), state: row.status === "NEW" ? "queued" : "review" });
      else if (old.order_id !== row.orderId || row.status !== "NEW") old.state = "review";
    }
    s.last_checked_at = new Date().toISOString(); return null;
  }
  if (table === "sales_sync_reverse_actions") { let rows = jobs.filter(j => match(j, u.searchParams)); if (method === "PATCH") { if (mode === "cas" && b.state === "running") rows = []; rows.forEach(j => Object.assign(j, b)); } return structuredClone(u.searchParams.get("limit") === "1" ? rows.slice(0, 1) : rows); }
  if (table === "ovoko_single_publications") return [{ allegro_offer_id: "10", state: "created", part_id: "20", request_hash: mode === "generation" ? "b".repeat(64) : "a".repeat(64) }];
  if (table === "allegro_connections") return [{ sealed: mode === "rotate" ? "changed" : "a" }];
  if (table === "ovoko_connections") return [{ sealed: "o" }];
  throw new Error(path);
};
const c = { sellerId: "555", clientId: "client", account: "account", fingerprint: "fp", allegroSealed: "a", ovokoSealed: "o",
  allegro: async (path, init = {}) => {
    if (init.method) { assert.equal(init.method, "PUT"); const id = path.split("/").at(-1); assert.equal(jobs.find(j => j.id === id).state, "running"); assert.equal(JSON.parse(init.body).publication.action, "END"); writes.push(id); if (mode === "timeout") throw new Error("timeout"); aStatus = "ENDED"; return { id }; }
    return { offers: [{ id: "10", stock: { available: stock }, publication: { status: aStatus } }], totalCount: 1 };
  },
  ovoko: async path => {
    assert.ok(path.startsWith("/v2/get/") || path === "/get/part_status", "Reverse direction never mutates Ovoko");
    if (mode === "outage") throw new Error("provider read failed");
    if (path.startsWith("/v2/get/orders/")) return { status_code: "R200", list: orders };
    if (path.startsWith("/v2/get/order/")) return { status_code: "R200", list: orders.filter(o => o.order_id === path.split("/").at(-1)).map(o => ({ ...o, order_status: mode === "cancelled" ? "CANCELLED" : o.order_status })) };
    if (path === "/get/part_status") return { status_code: "R200", list: { "0": { pl: "Na stanie" }, "2": { pl: "Sprzedano" }, "4": { pl: "Wycofany" } } };
    sourceReads++; if (mode === "late-revert" && sourceReads > 1) oStatus = "0";
    const q = new URL(path, "https://api.rrr.lt"); const limit = Number(q.searchParams.get("limit"));
    return { status_code: "R200", data: [{ id: "20", external_id: mode === "foreign" ? "tymo:999:10" : "tymo:555:10", status: oStatus }], pagination: { page: 1, limit, total_count: 1 } };
  } };
const { reverseSyncControl, runReverseSalesSync } = load("reverse-sales-sync", name => {
  if (name === "./sales-sync-ownership") return ownership;
  if (name === "./sales-sync-connections") return { syncConnections: async () => c, syncAuthorization: async () => { if (mode === "revoke") throw new read.OvokoError(403, "revoked"); if (mode === "disable") s.enabled = false; } };
  if (name === "./sales-sync-store") return { ...store, salesSyncDb: () => db };
  if (name === "./ovoko-read") return read;
  if (name === "./ovoko-sale-evidence") return parser;
  throw new Error(name);
});
const originalError = console.error; console.error = () => {};
async function arm() { reset(); const result = await reverseSyncControl(owner, env, { operation: "enable", confirm: true }); assert.equal(result.enabled, true); assert.equal(result.linkedCount,40000);assert.equal(result.scope,"all_linked");assert.equal(s.watch.length,0,"No frozen initial sample or inventory scan"); assert.equal(writes.length, 0); orders = [{ ...record(), order_id: "101" }]; oStatus = "2"; sourceReads = 0; }
try {
  await arm(); await runReverseSalesSync(env); assert.equal(writes.length, 1); assert.equal(jobs[0].state, "submitted"); await runReverseSalesSync(env); assert.equal(jobs[0].state, "done"); assert.equal(writes.length, 1);
  for (const failure of ["generation", "foreign", "cancelled", "rotate", "revoke", "disable", "cas", "late-revert", "ownership-conflict"]) { await arm(); mode = failure; await runReverseSalesSync(env); assert.equal(writes.length, 0, failure); }
  await arm(); stock = 0; await runReverseSalesSync(env); assert.equal(writes.length, 0); assert.equal(jobs[0].diagnostic, "stock_or_double_sale");
  await arm(); oStatus = "4"; await runReverseSalesSync(env); assert.equal(writes.length, 0, "A manual withdrawal is never a sale");
  await arm(); orders[0].order_id = "100"; await runReverseSalesSync(env); assert.equal(jobs.length, 0, "Existing baseline orders are never replayed");
  await arm(); orders[0].order_source = "crm"; await runReverseSalesSync(env); assert.equal(jobs.length, 0, "Manual CRM orders are not Ovoko purchases");
  await arm(); orders[0].order_status = "UNKNOWN"; await runReverseSalesSync(env); assert.equal(writes.length, 0); assert.equal(jobs[0].state, "review");
  await arm(); mode = "timeout"; await runReverseSalesSync(env); assert.equal(writes.length, 1); mode = "ok"; await runReverseSalesSync(env); assert.equal(writes.length, 1, "Never retry uncertain END"); aStatus = "ENDED"; await runReverseSalesSync(env); assert.equal(jobs[0].state, "done");
  await arm(); await Promise.all([runReverseSalesSync(env), runReverseSalesSync(env)]); assert.equal(writes.length, 1);
  await arm(); await runReverseSalesSync({ SALES_SYNC_ENABLED: "false" }); assert.equal(writes.length, 0);
  await arm(); mode = "outage"; await runReverseSalesSync(env); assert.ok(lastError); assert.equal(writes.length, 0);
  await arm();linkedCount=40001;assert.equal((await reverseSyncControl(owner,env,{operation:"status"})).linkedCount,40001,"Status uses current mappings, not initial watch length");
  await arm();mode="missing-migration";await runReverseSalesSync(env);assert.equal(writes.length,0);assert.equal(jobs.length,0);assert.match(lastError,/022/);
  const disabled=await reverseSyncControl(owner,env,{operation:"disable"});assert.equal(disabled.enabled,false);assert.equal(disabled.linkedCount,null,"Missing scope migration must never prevent disabling consent");
  assert.throws(() => parser.ovokoSaleOrders({ status_code: "R200", list: [{ ...record(), item_list: [{ id: "20" }, { id: "20" }] }] }));
  const parsed = parser.ovokoSaleOrders({ status_code: "R200", list: [record()] }); assert.doesNotMatch(JSON.stringify(parsed), /private|client_email/);
  const sql = readFileSync(new URL("../supabase/022_reverse_sync_all_links.sql", import.meta.url), "utf8"); assert.match(sql, /s\.baseline \?/);assert.doesNotMatch(sql,/jsonb_array_elements\(s.watch\)|j.updated_at>=s.armed_at/);
  console.log("Reverse sales sync: future-only baseline/watch, exact order/seller/part/generation proof, manual/unknown/cancelled exclusions, stock/double-sale guards, role/credential/CAS races, source recheck, concurrent leases and uncertain END readback without replay passed. Providers/DB RPCs mocked.");
} finally { console.error = originalError; }
