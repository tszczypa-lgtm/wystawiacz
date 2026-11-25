import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

function load(name, require = () => { throw new Error("Unexpected dependency"); }) {
  const result = ts.transpileModule(readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true,
  });
  assert.equal(result.diagnostics?.length || 0, 0);
  const module = { exports: {} };
  new Function("require", "module", "exports", result.outputText)(require, module, module.exports);
  return module.exports;
}
const read = load("ovoko-read"), store = load("sales-sync-store", () => read);
const parser = load("ovoko-sale-evidence", () => read);
const ownership = load("sales-sync-ownership", name => name === "./ovoko-read" ? read : store);
let mode, s, env, group, unit, event, action, stock, publication, partStatus, writes, reports, orderStatus, sourceReads, patches;
const owner = "00000000-0000-4000-8000-000000000001";
const uid = () => crypto.randomUUID();
const clone = v => structuredClone(v);
function nextSale(direction = "ovoko", quantity = 1) {
  event = { id: uid(), direction, reference: uid(), order_id: String(100 + writes.length), item_id: "line-1", quantity, bought_at: "2026-11-25T12:00:00Z", state: "queued" };
  action = { id: uid(), unit_id: unit.id, event_id: event.id, state: "queued", quantity_done: false,
    end_command_id: uid(), end_state: "pending", relist_state: "pending" };
  partStatus = direction === "ovoko" ? "2" : "0";
  orderStatus = direction === "ovoko" ? "NEW" : "READY_FOR_PROCESSING";
  sourceReads = 0;
}
function reset(direction = "ovoko", inventoryMode = "separate", quantity = 3) {
  mode = "ok"; writes = []; patches = []; reports = new Map(); stock = quantity; publication = "ACTIVE";
  env = { SALES_SYNC_ENABLED: "true" };
  s = { owner_id: owner, epoch: uid(), lease: uid(), lease_until: new Date(Date.now() + 300000).toISOString(), seller_id: "555",
    ovoko_account: "a".repeat(64), fingerprint: "fp", client_id: "client", enabled: true, armed_at: "2026-11-25T10:00:00Z" };
  group = { id: uid(), owner_id: owner, seller_id: "555", ovoko_account: s.ovoko_account, offer_id: "10", mode: inventoryMode, quantity, paused: false, created_at: "2026-11-25T10:30:00Z" };
  unit = { id: uid(), group_id: group.id, ovoko_account: s.ovoko_account, ordinal: 1, external_id: "tymo:555:10:u:1", state: "created",
    part_id: "20", request_hash: "b".repeat(64), created_at: "2026-11-25T11:00:00Z", updated_at: "2026-11-25T11:00:00Z" };
  nextSale(direction);
}
const matches = (row, params) => [...params].every(([k, v]) => !v.startsWith("eq.") || String(row[k]) === v.slice(3));
const db = async (path, init = {}) => {
  const url = new URL(path, "https://db.test"), table = url.pathname.slice(1), body = init.body ? JSON.parse(init.body) : {};
  if (table === "rpc/claim_ovoko_stock_action") {
    assert.deepEqual(body, { p_owner: owner, p_direction: event.direction, p_epoch: s.epoch, p_lease: s.lease });
    if (["done", "review"].includes(action.state) || mode === "none") return null;
    const executable = action.state === "queued";
    if (executable) action.state = "preflight";
    return clone({ action, unit, group, event, executable });
  }
  if (table === "rpc/sync_account_lock") return mode !== "ownership";
  if (table === "ovoko_stock_actions") {
    assert.equal(url.searchParams.has("owner_id"), false);
    assert.equal(url.searchParams.get("unit_id"), `eq.${unit.id}`);
    assert.equal(url.searchParams.get("event_id"), `eq.${event.id}`);
    assert.equal(init.method, "PATCH");
    if (!matches(action, url.searchParams) || mode === "cas" && (body.state === "running" || body.end_state === "running" || body.relist_state === "running")) return [];
    patches.push(clone(body)); Object.assign(action, body);
    if (mode === "quantity-ack-loss" && body.quantity_done) throw new Error("Lost DB acknowledgement");
    return [clone(action)];
  }
  if (table === "ovoko_stock_events") return [{ ...clone(event), state: mode === "event-cancel" ? "review" : event.state }];
  if (table === "ovoko_stock_groups") {
    assert.equal(url.searchParams.get("id"), `eq.${group.id}`);
    const current = clone(group);
    if (mode === "paused") current.paused = true;
    if (mode.startsWith("group-drift:")) {
      const field = mode.split(":")[1];
      current[field] = field === "quantity" ? current.quantity + 1 : "changed";
    }
    return [current];
  }
  if (table === "ovoko_stock_units") return [{ ...clone(unit), request_hash: mode === "generation" ? "c".repeat(64) : unit.request_hash }];
  if (["sales_sync", "sales_sync_reverse"].includes(table)) {
    if (mode === "disable") return [];
    return [{ ...s, lease_until: mode === "lease" ? "2020-01-01T00:00:00Z" : s.lease_until, fingerprint: mode === "binding" ? "changed" : s.fingerprint }];
  }
  if (table === "allegro_connections") return [{ sealed: mode === "rotate" ? "changed" : "a" }];
  if (table === "ovoko_connections") return [{ sealed: mode === "ovoko-rotate" ? "changed" : "o" }];
  throw new Error(`Unexpected database call ${path}`);
};
const connections = () => ({ sellerId: s.seller_id, clientId: s.client_id, account: s.ovoko_account, fingerprint: s.fingerprint, allegroSealed: "a", ovokoSealed: "o",
  allegro: async (path, init = {}) => {
    if (init.method) {
      const id = path.split("/").at(-1), payload = JSON.parse(init.body);
      assert.equal(init.method, "PUT");
      assert.equal(init.headers["Content-Type"], "application/vnd.allegro.public.v1+json");
      assert.equal(action.quantity_done, path.includes("publication") ? true : false);
      if (path.includes("quantity-change")) {
        assert.equal(id, action.id); assert.equal(action.state, "running");
        assert.deepEqual(payload, { modification: { changeType: "GAIN", value: -1 }, offerCriteria: [{ type: "CONTAINS_OFFERS", offers: [{ id: "10" }] }] });
        assert.deepEqual(action.command_payload, payload);
        if (mode !== "quantity-not-applied") stock--;
      } else {
        assert.equal(id, action.end_command_id); assert.equal(action.end_state, "running");
        assert.deepEqual(payload, { publication: { action: "END" }, offerCriteria: [{ type: "CONTAINS_OFFERS", offers: [{ id: "10" }] }] });
        if (mode !== "end-not-applied") publication = "ENDED";
      }
      assert.equal(reports.has(id), false, "Never submit an existing command again");
      writes.push({ provider: "allegro", path, id, payload }); reports.set(id, "success");
      if (["quantity-timeout", "quantity-not-applied"].includes(mode) && path.includes("quantity-change") || ["end-timeout", "end-not-applied"].includes(mode) && path.includes("publication")) throw new Error("HTTP 503/409 or timeout");
      return { id };
    }
    if (path.includes("/order/checkout-forms/")) {
      sourceReads++;
      return { status: mode === "cancel" || mode === "late-cancel" && sourceReads > 1 ? "CANCELLED" : orderStatus,
        lineItems: [{ id: "line-1", quantity: mode === "quantity-mismatch" ? 99 : event.quantity, boughtAt: event.bought_at, offer: { id: mode === "foreign-offer" ? "99" : "10" } }] };
    }
    if (path.startsWith("/sale/offers?")) return { offers: [{ id: mode === "foreign-owner" ? "99" : "10", stock: { available: stock }, publication: { status: publication } }] };
    const id = path.split("/")[3], tasks = path.includes("/tasks"), report = reports.get(id);
    if (!report || mode === "report-outage") throw new Error("Report unavailable");
    if (tasks) return { tasks: mode === "pending" ? [] : [{ offer: { id: mode === "foreign-task" ? "99" : "10" }, status: report === "failed" ? "FAIL" : "SUCCESS" }] };
    return { id: mode === "foreign-report" ? uid() : id, completedAt: mode === "pending" ? null : "2026-11-25T12:01:00Z",
      taskCount: mode === "pending" ? { total: 0, success: 0, failed: 0 } : { total: 1, success: report === "failed" ? 0 : 1, failed: report === "failed" ? 1 : 0 } };
  },
  ovoko: async (path, body) => {
    if (body) {
      assert.equal(path, "/crm/changePartStatus"); assert.equal(body.get("part_id"), "20");
      const relist = body.get("status") === "0";
      if (relist) { assert.equal(group.mode, "shared"); assert.equal(action.quantity_done, true); assert.equal(action.relist_state, "running"); assert.ok(stock > 0); }
      else { assert.equal(body.get("status"), "4"); assert.equal(action.state, "running"); }
      writes.push({ provider: "ovoko", part: "20", status: body.get("status") });
      if (mode !== "relist-not-applied") partStatus = body.get("status");
      if (["relist-timeout", "relist-not-applied", "withdraw-timeout"].includes(mode)) throw new Error("Timeout");
      return {};
    }
    if (path.startsWith("/v2/get/order/")) {
      sourceReads++;
      return { status_code: "R200", list: [{ order_id: event.order_id, order_source: mode === "manual" ? "crm" : "ovoko",
        order_status: mode === "cancel" || mode === "late-cancel" && sourceReads > 1 ? "CANCELLED" : orderStatus,
        order_date: "2026-11-25 12:00:00", item_list: [{ id: "20", external_id: mode === "foreign-external" ? "foreign" : unit.external_id }] }] };
    }
    if (path === "/get/part_status") return { status_code: "R200", list: { "0": { pl: "Na stanie" }, "2": { pl: "Sprzedano" }, "3": { pl: "Reserved" }, "4": { pl: "Wycofany" } } };
    if (path.startsWith("/v2/get/parts?")) return { status_code: "R200", data: [{ id: mode === "foreign-part" ? "99" : "20", external_id: mode === "foreign-external" ? "foreign" : unit.external_id, status: partStatus }], pagination: { page: 1, limit: 2, total_count: mode === "duplicate" ? 2 : 1 } };
    throw new Error(`Unexpected Ovoko call ${path}`);
  },
});
const { tickOvokoStockSync } = load("ovoko-stock-sync", name => {
  if (name === "./sales-sync-connections") return { syncAuthorization: async () => { if (mode === "revoke") throw new read.OvokoError(403, "revoked"); } };
  if (name === "./sales-sync-store") return store;
  if (name === "./sales-sync-ownership") return ownership;
  if (name === "./ovoko-read") return read;
  if (name === "./ovoko-sale-evidence") return parser;
  throw new Error(name);
});
async function tick() {
  const count = writes.length;
  const result = await tickOvokoStockSync(clone(s), env, db, connections(), event.direction);
  assert.ok(writes.length - count <= 1, "At most one provider mutation per tick");
  return result;
}

reset(); mode = "none"; assert.equal(await tick(), false);
reset(); env.SALES_SYNC_ENABLED = "false"; assert.equal(await tick(), false); assert.equal(writes.length, 0);
reset(); group.mode = "unknown"; await assert.rejects(tick(), /invalid_stock_action_claim/);
reset(); await tick(); assert.equal(stock, 2); assert.equal(action.state, "submitted"); await tick(); assert.equal(action.state, "done"); assert.equal(action.quantity_done, true); assert.equal(writes.length, 1);
assert.equal(await tick(), false, "Completed event cannot enqueue/replay through this claim fixture");

// The same shared physical proxy can serve distinct orders, never a repeated event.
reset("ovoko", "shared"); const proxy = unit.id;
for (const remaining of [2, 1, 0]) {
  await tick(); assert.equal(stock, remaining); assert.equal(action.quantity_done, false);
  await tick(); assert.equal(action.quantity_done, true);
  if (remaining) { assert.equal(action.relist_state, "done"); assert.equal(partStatus, "0"); }
  else { assert.equal(action.end_state, "submitted"); assert.equal(partStatus, "2"); await tick(); assert.equal(action.end_state, "done"); }
  assert.equal(action.state, "done"); const count = writes.length;
  assert.equal(await tick(), false); assert.equal(writes.length, count); assert.equal(unit.id, proxy);
  if (remaining) nextSale();
}
assert.equal(writes.filter(w => w.payload?.modification).length, 3);
assert.equal(writes.filter(w => w.provider === "ovoko").length, 2);
assert.equal(writes.filter(w => w.payload?.publication).length, 1);

for (const inventoryMode of ["shared", "separate"]) {
  reset("allegro", inventoryMode); stock = 2; event.quantity = 2;
  await tick(); assert.equal(action.state, "done"); assert.equal(writes.length, inventoryMode === "shared" ? 0 : 1);
  if (inventoryMode === "shared") assert.equal(action.diagnostic, "stock_remains");
  reset("allegro", inventoryMode); stock = 0; event.quantity = 3; await tick(); assert.equal(partStatus, "4"); assert.equal(writes.length, 1);
}
for (const direction of ["allegro", "ovoko"]) {
  for (const failure of ["generation", "rotate", "ovoko-rotate", "disable", "lease", "binding", "ownership", "revoke", "event-cancel", "cas", "cancel", "late-cancel", "foreign-external", "foreign-part", "duplicate", "foreign-owner"]) {
    reset(direction); stock = 2; mode = failure; await tick();
    assert.equal(writes.length, 0, `${direction}: ${failure}`);
  }
}
for (const failure of ["quantity-mismatch", "foreign-offer"]) { reset("allegro"); mode = failure; await tick(); assert.equal(writes.length, 0); }
reset("allegro"); event.bought_at = "2026-11-25T09:00:00Z"; await tick(); assert.equal(writes.length, 0);
for (const status of ["2", "3"]) { reset("allegro"); partStatus = status; await tick(); assert.equal(action.state, "review"); assert.equal(writes.length, 0); }
reset("ovoko"); mode = "manual"; await tick(); assert.equal(writes.length, 0);
reset("ovoko"); stock = 0; await tick(); assert.equal(writes.length, 0); assert.equal(action.state, "review");

// Unknown initial writes are report-only, even if native sales moved stock or ended the offer.
for (const state of ["preflight", "running", "submitted", "uncertain"]) {
  reset(); action.state = state; stock = 1; publication = "ENDED"; await tick(); assert.equal(writes.length, 0); assert.equal(action.state, "uncertain");
}
reset(); mode = "quantity-timeout"; await tick(); const quantityId = action.id;
mode = "report-outage"; await tick(); assert.equal(action.quantity_done, false);
mode = "pending"; await tick(); assert.equal(action.state, "submitted"); assert.equal(action.quantity_done, false);
mode = "ok"; await tick(); assert.equal(action.state, "done"); assert.equal(action.id, quantityId); assert.equal(writes.length, 1);
for (const failure of ["foreign-task", "foreign-report"]) { reset(); await tick(); mode = failure; await tick(); assert.equal(action.quantity_done, false); assert.equal(writes.length, 1); }
reset(); await tick(); reports.set(action.id, "failed"); await tick(); assert.equal(action.state, "review"); assert.equal(action.quantity_done, false);
reset("ovoko", "shared"); await tick(); mode = "cancel"; await tick(); assert.equal(action.quantity_done, true); assert.equal(action.state, "review"); assert.equal(writes.length, 1, "Confirmed decrement survives cancellation without relisting");
reset("ovoko", "shared"); await tick(); mode = "quantity-ack-loss"; await tick(); assert.equal(action.quantity_done, true);
mode = "ok"; await tick(); assert.equal(action.state, "done"); assert.equal(writes.filter(w => w.provider === "allegro").length, 1);

for (const failure of ["relist-timeout", "relist-not-applied"]) {
  reset("ovoko", "shared"); await tick(); mode = failure; await tick(); assert.equal(action.relist_state, "uncertain");
  const count = writes.length; mode = "ok"; await tick(); assert.equal(writes.length, count);
  if (failure === "relist-not-applied") { assert.equal(action.state, "uncertain"); partStatus = "0"; await tick(); }
  assert.equal(action.state, "done"); assert.equal(action.relist_state, "done");
}
for (const failure of ["cancel", "event-cancel", "rotate", "revoke", "cas"]) {
  reset("ovoko", "shared"); await tick(); mode = failure; await tick(); assert.equal(writes.length, 1, `No unsafe relist: ${failure}`);
}
for (const inactive of ["ENDED", "INACTIVE"]) {
  reset("ovoko", "shared"); stock = 1; await tick(); publication = inactive; await tick(); assert.equal(action.state, "done"); assert.equal(writes.length, 1); assert.equal(partStatus, "2");
}
reset("ovoko", "shared"); stock = 1; await tick(); mode = "end-timeout"; await tick();
assert.equal(action.end_state, "uncertain"); const endId = action.end_command_id;
mode = "report-outage"; await tick(); assert.equal(action.state, "uncertain");
mode = "ok"; await tick(); assert.equal(action.state, "done"); assert.equal(action.end_command_id, endId); assert.equal(writes.length, 2);
reset("ovoko", "shared"); stock = 1; await tick(); mode = "end-timeout"; await tick(); mode = "cancel"; await tick();
assert.equal(action.end_state, "done"); assert.equal(action.state, "done"); assert.equal(writes.length, 2, "Cancellation cannot prevent readback of the already-sent END command");
reset("ovoko", "shared"); stock = 1; await tick(); await tick();
assert.equal(publication, "ENDED"); mode = "report-outage"; await tick();
assert.notEqual(action.state, "done", "Ended offer alone never proves the END command"); assert.equal(writes.length, 2);
mode = "ok"; await tick(); assert.equal(action.state, "done");
reset("ovoko", "shared"); await tick(); partStatus = "0"; await tick();
assert.equal(action.quantity_done, true); assert.equal(action.state, "review", "In-stock without this action's relist attempt is not a successful relist"); assert.equal(writes.length, 1);
reset("ovoko", "shared"); await tick(); mode = "relist-not-applied"; await tick();
mode = "cancel"; partStatus = "0"; await tick(); assert.equal(action.state, "review"); assert.equal(writes.length, 2);
for (const phase of ["running", "submitted", "uncertain"]) {
  reset("ovoko", "shared"); action.state = "submitted"; action.quantity_done = true; action.end_state = phase; stock = 0;
  await tick(); assert.equal(writes.length, 0, `Never replay END ${phase}`); assert.equal(action.state, "uncertain");
  reset("ovoko", "shared"); action.state = "submitted"; action.quantity_done = true; action.relist_state = phase;
  await tick(); assert.equal(writes.length, 0, `Never replay relist ${phase}`); assert.equal(action.state, "uncertain");
}
reset("allegro"); stock = 0; mode = "withdraw-timeout"; await tick(); assert.equal(action.state, "uncertain"); mode = "ok"; await tick(); assert.equal(action.state, "done"); assert.equal(writes.length, 1);

// The claim snapshot may predate a manual withdrawal. Only a fresh group can authorize writes.
for (const direction of ["allegro", "ovoko"]) {
  reset(direction); stock = 2; mode = "paused"; await tick();
  assert.equal(group.paused, false, "Claim snapshot is deliberately stale");
  assert.equal(writes.length, 0, `Paused group blocks initial ${direction} mutation`);
}
for (const field of ["owner_id", "ovoko_account", "seller_id", "offer_id", "mode", "quantity"]) {
  reset(); mode = `group-drift:${field}`; await tick(); assert.equal(writes.length, 0, `Fresh group ${field} binding`);
}
for (const initialStock of [3, 1]) {
  reset("ovoko", "shared"); stock = initialStock; await tick(); mode = "paused"; await tick();
  assert.equal(action.quantity_done, true, "Paused follow-up preserves confirmed decrement");
  assert.equal(writes.length, 1, "Pause blocks both relist and END follow-up mutations");
  assert.equal(action.relist_state, "pending"); assert.equal(action.end_state, "pending");
}
reset(); await tick(); mode = "paused"; await tick(); assert.equal(action.state, "done", "Paused separate quantity readback remains available");
reset("ovoko", "shared"); await tick(); mode = "relist-timeout"; await tick(); mode = "paused"; await tick();
assert.equal(action.state, "done", "Paused relist readback confirms the previous attempt"); assert.equal(writes.length, 2);
reset("ovoko", "shared"); stock = 1; await tick(); mode = "end-timeout"; await tick(); mode = "paused"; await tick();
assert.equal(action.state, "done", "Paused END command readback remains available"); assert.equal(writes.length, 2);
console.log("Ovoko stock sync: separate/shared, shared 3->2->1->0 same proxy, multi-quantity forward, exact source/account/event/CAS guards, command reports, durable quantity/END/relist phases, cancellation and timeout no-replay passed. Providers and DB mocked; SQL ingestion/deduplication/concurrency require SQL tests.");
