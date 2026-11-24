import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
const root = fileURLToPath(new URL("../", import.meta.url)), native = createRequire(import.meta.url), cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  const source = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("require", "module", "exports", source)(name => name.startsWith(".") ? load(path.resolve(path.dirname(file), name + ".ts")) : native(name), module, module.exports); return module.exports;
}
const { runSalesSync, salesSyncControl } = load(path.join(root, "lib/sales-sync.ts"));
const { handleOvokoApi } = load(path.join(root, "lib/ovoko-api.ts"));
const { sealConnection } = load(path.join(root, "lib/allegro-api.ts"));
const raw = new Uint8Array(32).fill(7), key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
const owner = "00000000-0000-4000-8000-000000000001";
const env = { SUPABASE_SERVICE_ROLE_KEY: "fixture", NEXT_PUBLIC_SUPABASE_URL: "https://database.test", ALLEGRO_ENCRYPTION_KEY: Buffer.from(raw).toString("base64"), ALLEGRO_CLIENT_ID: "client", ALLEGRO_CLIENT_SECRET: "secret", SALES_SYNC_ENABLED: "true" };
let sub, jobs, admin, suspended, mode, writes, partStatus, events, cursorCommits, providerReads, refreshes, aSealed, oSealed, sourceStock, log, purchaseAt;
let expireToken = false;
async function reset() {
  sub = undefined; jobs = []; admin = true; suspended = false; mode = "ok"; writes = 0; partStatus = "0"; events = []; cursorCommits = []; providerReads = 0; refreshes = 0; sourceStock = 0; log = [];
  aSealed = await sealConnection({ accessToken: "private-a", refreshToken: "private-r", expiresAt: expireToken ? 0 : Date.now() + 3600000, clientId: "client", sellerId: "555" }, key, owner);
  oSealed = await sealConnection({ username: "fixture", password: "private-o", user_token: "private-t" }, key, `ovoko:v1:${owner}`);
}
function matches(row, search) {
  for (const [key, value] of search) {
    if (value.startsWith("eq.") && String(row[key]) !== value.slice(3)) return false;
    if (value.startsWith("in.(") && !value.slice(4, -1).split(",").includes(String(row[key]))) return false;
  }
  return true;
}
const original = globalThis.fetch, originalConsole = console.error;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(input), method = init.method || "GET", body = init.body ? JSON.parse(String(init.body).startsWith("{") ? String(init.body) : "{}") : {};
  log.push([url.pathname, method]);
  if (url.hostname === "database.test") {
    if (url.pathname === "/auth/v1/user") return Response.json({ id: owner, email_confirmed_at: "2026-01-01T00:00:00Z" });
    const table = url.pathname.replace("/rest/v1/", "");
    if (table === "account_admins") return Response.json(admin ? [{ owner_id: owner }] : []);
    if (table === "customer_accounts") return Response.json([{ suspended }]);
    if (table === "allegro_connections") { if (method === "PATCH") { aSealed = body.sealed; return Response.json([{ sealed: aSealed }]); } return Response.json([{ sealed: aSealed }]); }
    if (table === "ovoko_connections") return Response.json([{ sealed: oSealed }]);
    if (table === "sales_sync") {
      if (method === "POST") { sub = structuredClone(body); return Response.json([sub]); }
      const matched = sub && matches(sub, url.searchParams);
      if (method === "PATCH") { if (matched) Object.assign(sub, body); return Response.json(matched ? [sub] : []); }
      return Response.json(matched ? [sub] : []);
    }
    if (table === "rpc/claim_sales_sync") {
      if (!sub?.enabled || sub.lease) return Response.json([]);
      sub.lease = crypto.randomUUID(); sub.lease_until = new Date(Date.now() + 300000).toISOString(); return Response.json([sub]);
    }
    if (table === "rpc/ingest_sales_sync") {
      assert.equal(body.p_cursor, sub.cursor); assert.equal(body.p_lease, sub.lease); assert.doesNotMatch(JSON.stringify(body), /private|buyer|email/);
      cursorCommits.push(body);
      for (const e of body.p_evidence) {
        const old = jobs.find(j => j.item_id === e.itemId);
        if (e.kind === "cancelled") { if (old) old.state = "review"; continue; }
        if (!old && e.quantity === 1 && e.boughtAt && Date.parse(e.boughtAt) >= Date.parse(sub.armed_at)) jobs.push({ id: crypto.randomUUID(), owner_id: owner, epoch: sub.epoch, seller_id: "555", offer_id: "10", part_id: "20", publication_hash: "a".repeat(64), item_id: e.itemId, order_id: e.orderId, bought_at: e.boughtAt, state: "queued" });
      }
      sub.cursor = body.p_next; sub.caught_up = body.p_caught_up; sub.last_checked_at = new Date().toISOString(); return Response.json(null);
    }
    if (table === "sales_sync_actions") {
      let found = jobs.filter(j => matches(j, url.searchParams));
      if (method === "PATCH") { if (mode === "lost-cas" && body.state === "running") found = []; found.forEach(j => Object.assign(j, body)); }
      return Response.json(url.searchParams.get("limit") === "1" ? found.slice(0, 1) : found);
    }
    if (table === "ovoko_single_publications") return Response.json([{ state: "created", part_id: "20", request_hash: mode === "generation" ? "b".repeat(64) : "a".repeat(64), updated_at: new Date(Date.now() - 60000).toISOString() }]);
    throw new Error(`Unexpected DB ${table}`);
  }
  if (url.hostname === "allegro.pl") { refreshes++; assert.equal(method, "POST"); return Response.json({ access_token: "private-new", refresh_token: "private-new-r", expires_in: 3600 }); }
  if (url.hostname === "api.allegro.pl") {
    assert.equal(method, "GET", "Pilot never mutates Allegro");
    if (url.pathname === "/me") return Response.json({ id: "555" });
    if (url.pathname === "/order/event-stats") return Response.json({ latestEvent: { id: "100", occurredAt: new Date().toISOString() } });
    if (url.pathname === "/order/events") {
      if (mode === "outage") return new Response("private", { status: 503 });
      if (mode === "binding") oSealed = "changed";
      return Response.json({ events });
    }
    if (url.pathname === "/order/checkout-forms/order-1") {
      if (mode === "suspend") suspended = true;
      if (mode === "disable") sub.enabled = false;
      return Response.json({ status: mode === "cancelled" ? "CANCELLED" : "READY_FOR_PROCESSING", lineItems: [{ id: "item-1", offer: { id: "10" }, quantity: mode === "quantity" ? 2 : 1, boughtAt: purchaseAt }] });
    }
    if (url.pathname === "/sale/offers") return Response.json({ offers: [{ id: "10", stock: { available: sourceStock }, publication: { status: "ENDED" } }] });
    throw new Error(`Unexpected Allegro ${url.pathname}`);
  }
  assert.equal(url.hostname, "api.rrr.lt"); assert.equal(method, "POST");
  if (url.pathname === "/get/part_status") return Response.json({ status_code: "R200", list: { "0": { pl: "Na stanie" }, "2": { pl: "Sprzedano" }, "4": { pl: "Wycofany" } } });
  if (url.pathname === "/v2/get/parts") {
    providerReads++;
    if (mode === "late-sold" && providerReads > 1) partStatus = "2";
    return Response.json({ status_code: "R200", data: [{ id: "20", external_id: mode === "foreign" ? "tymo:999:10" : "tymo:555:10", status: partStatus }], pagination: { page: 1, limit: 2, total_count: 1 } });
  }
  assert.equal(url.pathname, "/crm/changePartStatus", "No delete, import, update or relist endpoints");
  writes++; assert.equal(new URLSearchParams(init.body).get("status"), "4");
  if (mode === "timeout") throw new DOMException("private transport", "TimeoutError");
  partStatus = "4"; return Response.json({ status_code: "R200" });
};
console.error = () => {};
async function arm() {
  await reset(); const result = await salesSyncControl(owner, env, { operation: "enable", confirm: true });
  assert.equal(result.enabled, true); assert.equal(result.direction, "allegro_to_ovoko"); assert.equal(writes, 0); assert.equal(sub.cursor, "100");
  purchaseAt = new Date(Date.now() + 1000).toISOString();
  events = [{ id: "101", type: "READY_FOR_PROCESSING", occurredAt: purchaseAt, order: { seller: { id: "555" }, checkoutForm: { id: "order-1" }, buyer: { email: "private@test" }, lineItems: [{ id: "item-1", offer: { id: "10" }, quantity: 1, boughtAt: purchaseAt }] } }];
}
try {
  await arm(); await runSalesSync(env); assert.equal(writes, 1); assert.equal(jobs[0].state, "done"); assert.equal(sub.cursor, "101");
  events = []; await runSalesSync(env); assert.equal(writes, 1, "Never replay a completed action");
  for (const failure of ["foreign", "generation", "quantity", "cancelled", "suspend", "disable", "binding", "late-sold", "lost-cas"]) {
    await arm(); mode = failure; await runSalesSync(env); assert.equal(writes, 0, failure);
  }
  await arm(); sourceStock = 1; await runSalesSync(env); assert.equal(writes, 0); assert.equal(jobs[0].diagnostic, "not_last_single_unit");
  await arm(); mode = "outage"; await runSalesSync(env); assert.equal(sub.cursor, "100"); assert.equal(cursorCommits.length, 0); assert.ok(sub.last_error); assert.equal(writes, 0);
  await arm(); mode = "timeout"; await runSalesSync(env); assert.equal(writes, 1); assert.equal(jobs[0].state, "uncertain");
  events = []; mode = "ok"; await runSalesSync(env); assert.equal(writes, 1, "Ambiguous writes are read back, never replayed");
  partStatus = "4"; await runSalesSync(env); assert.equal(jobs[0].state, "done"); assert.equal(writes, 1);
  await arm(); await Promise.all([runSalesSync(env), runSalesSync(env)]); assert.equal(writes, 1, "Concurrent scheduled invocations share a durable lease");
  await arm(); await runSalesSync({ ...env, SALES_SYNC_ENABLED: "false" }); assert.equal(writes, 0); assert.equal(cursorCommits.length, 0);
  await salesSyncControl(owner, env, { operation: "disable" }); await runSalesSync(env); assert.equal(writes, 0);
  await arm(); events = Array.from({ length: 100 }, (_, i) => ({ ...events[0], id: String(101 + i) })); await runSalesSync(env); assert.equal(writes, 0); assert.equal(sub.caught_up, false);
  await arm(); events[0].order.seller.id = "666"; await runSalesSync(env); assert.equal(writes, 0); assert.equal(cursorCommits.length, 0);
  expireToken = true; await arm(); assert.equal(refreshes, 1); await runSalesSync(env); assert.equal(writes, 1, "Refreshed connection binding uses the new sealed value"); expireToken = false;
  for (const input of [{ operation: "enable" }, { operation: "wipe" }, { operation: "status", owner: "other" }]) await assert.rejects(salesSyncControl(owner, env, input));
  const request = (headers = {}, method = "POST", input = { operation: "status" }) => new Request("https://fixture.test/api/ovoko/sales-sync", { method, headers: { Authorization: "Bearer fixture", Origin: "https://fixture.test", "Content-Type": "application/json", ...headers }, ...(method === "POST" ? { body: JSON.stringify(input) } : {}) });
  const beforeApi = writes;
  admin = false; assert.equal((await handleOvokoApi(request(), env)).status, 403); admin = true;
  suspended = true; assert.equal((await handleOvokoApi(request(), env)).status, 403); suspended = false;
  assert.equal((await handleOvokoApi(request({ Origin: "https://foreign.test" }), env)).status, 403);
  assert.equal((await handleOvokoApi(request({ Authorization: "" }), env)).status, 401);
  assert.equal((await handleOvokoApi(request({}, "GET"), env)).status, 405);
  assert.equal((await handleOvokoApi(request({}, "POST", { operation: "status", owner: "other" }), env)).status, 400);
  const api = await handleOvokoApi(request(), env); assert.equal(api.status, 200); assert.equal((await api.json()).direction, "allegro_to_ovoko"); assert.equal(writes, beforeApi, "Status endpoint never changes a portal");
  const sql = readFileSync(new URL("../supabase/016_sales_sync.sql", import.meta.url), "utf8");
  for (const required of [/for update skip locked/i, /cursor is distinct from p_cursor/, /j\.updated_at<=b/, /b<s\.armed_at/, /unique\(owner_id,part_id,publication_hash,item_id\)/, /revoke all.*claim_sales_sync/]) assert.match(sql, required);
  console.log("Sales sync: explicit future-only consent, lease/cursor ingestion, exact generation/seller/stock guards, fresh order/cancellation checks, changed credentials, revocation, target races, durable write CAS, no retry after timeout, readback recovery, concurrency, kill switch and token refresh passed. Providers/SQL RPCs mocked; live DB migration not applied.");
} finally { globalThis.fetch = original; console.error = originalConsole; }
