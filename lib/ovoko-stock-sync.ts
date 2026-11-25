import { syncAuthorization, type syncConnections, type SalesSyncEnv } from "./sales-sync-connections";
import { syncJson, syncRows, type SyncDb } from "./sales-sync-store";
import { syncAccountLock } from "./sales-sync-ownership";
import { OvokoError, ovokoPageData, parseOvokoRead } from "./ovoko-read";
import { ovokoSaleOrders } from "./ovoko-sale-evidence";

type Data = Record<string, unknown>;
type Subscription = {
  owner_id: string; epoch: string; lease: string | null; lease_until: string | null;
  seller_id: string; ovoko_account: string; fingerprint: string; client_id: string;
  enabled?: boolean; armed_at?: string;
};
type Connections = Awaited<ReturnType<typeof syncConnections>>;
type Action = { id: string; unit_id: string; event_id: string; state: string; quantity_done: boolean;
  end_command_id: string | null; end_state: string; relist_state: string };
type Unit = { id: string; group_id: string; ovoko_account: string; ordinal: number; external_id: string;
  state: string; part_id: string; request_hash: string; created_at: string; updated_at: string };
type Group = { id: string; owner_id: string; ovoko_account: string; seller_id: string; offer_id: string;
  mode: "separate" | "shared"; quantity: number; paused: boolean; created_at: string };
type Event = { id: string; direction: string; reference: string; order_id: string; item_id: string | null;
  quantity: number; bought_at: string; state: string };
type Claim = { action: Action; unit: Unit; group: Group; event: Event; executable: boolean };
const obj = (v: unknown): Data => v && typeof v === "object" && !Array.isArray(v) ? v as Data : {};
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const numeric = (v: unknown): v is string => typeof v === "string" && /^\d{1,30}$/.test(v);
const instant = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v));
function fail(message: string): never { throw new OvokoError(409, message); }
const attempted = (state: string) => ["running", "submitted", "uncertain", "done"].includes(state);

// https://developer.allegro.pl/tutorials/jak-zarzadzac-ofertami-7GzB2L37ase#liczba-przedmiotow
// Stock movement cannot attribute a relative write; only its command report can.
async function commandReport(c: Connections, kind: "quantity" | "publication", id: string, offer: string) {
  const path = `/sale/offer-${kind === "quantity" ? "quantity-change" : "publication"}-commands/${id}`;
  const summary = await c.allegro(path), detail = await c.allegro(`${path}/tasks?limit=100&offset=0`);
  const count = obj(summary.taskCount);
  if (summary.id !== id || ![count.total, count.success, count.failed].every(n => Number.isSafeInteger(n) && Number(n) >= 0)
    || !Array.isArray(detail.tasks) || detail.tasks.length > 1 || Number(count.total) > 1
    || Number(count.success) + Number(count.failed) > Number(count.total)) fail("invalid_command_report");
  if (detail.tasks.some(t => obj(obj(t).offer).id !== offer)) fail("foreign_command_task");
  if (summary.completedAt == null) return "pending";
  if (!instant(summary.completedAt) || count.total !== 1 || Number(count.success) + Number(count.failed) !== 1 || detail.tasks.length !== 1) fail("inconsistent_command_report");
  const task = obj(detail.tasks[0]);
  if (count.success === 1 && count.failed === 0 && task.status === "SUCCESS") return "success";
  if (count.failed === 1 && count.success === 0 && task.status === "FAIL") return "failed";
  return fail("inconsistent_command_task");
}

export async function tickOvokoStockSync(s: Subscription, env: SalesSyncEnv, db: SyncDb, c: Connections, direction: "allegro" | "ovoko"): Promise<boolean> {
  if (env.SALES_SYNC_ENABLED !== "true" || env.OVOKO_TEST_ENABLED === "false" || s.enabled === false) return false;
  if (!uuid(s.owner_id) || !uuid(s.epoch) || !uuid(s.lease) || !instant(s.lease_until) || Date.parse(s.lease_until) <= Date.now()
    || c.sellerId !== s.seller_id || c.account !== s.ovoko_account || c.fingerprint !== s.fingerprint || c.clientId !== s.client_id) fail("stock_subscription_changed");
  const raw = await db("rpc/claim_ovoko_stock_action", syncJson({ p_owner: s.owner_id, p_direction: direction, p_epoch: s.epoch, p_lease: s.lease }));
  if (raw === null) return false;
  const claim = raw as Claim;
  const { action: a, unit: u, group: g, event: e } = claim;
  if (!a || !u || !g || !e || ![a.id, a.unit_id, a.event_id, u.id, u.group_id, g.id, e.id].every(uuid)
    || a.unit_id !== u.id || a.event_id !== e.id || u.group_id !== g.id || g.owner_id !== s.owner_id
    || g.seller_id !== s.seller_id || g.ovoko_account !== s.ovoko_account || u.ovoko_account !== s.ovoko_account
    || !numeric(g.offer_id) || !numeric(u.part_id) || !Number.isSafeInteger(g.quantity) || g.quantity < 1
    || !["separate", "shared"].includes(g.mode) || !Number.isSafeInteger(u.ordinal) || u.ordinal < 1
    || u.ordinal > (g.mode === "shared" ? 1 : g.quantity)
    || u.external_id !== `tymo:${s.seller_id}:${g.offer_id}:u:${u.ordinal}` || u.state !== "created"
    || typeof u.request_hash !== "string" || !/^[a-f0-9]{64}$/.test(u.request_hash) || e.direction !== direction
    || typeof claim.executable !== "boolean" || typeof a.quantity_done !== "boolean"
    || !["preflight", "running", "submitted", "uncertain"].includes(a.state)
    || claim.executable && a.state !== "preflight") fail("invalid_stock_action_claim");
  const target = `ovoko_stock_actions?id=eq.${a.id}&unit_id=eq.${u.id}&event_id=eq.${e.id}`;
  const patch = async (body: Data, filter = "") => {
    const rows = syncRows<Action>(await db(`${target}${filter}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ ...body, checked_at: new Date().toISOString() }) }));
    if (rows.length !== 1 || rows[0].id !== a.id || rows[0].unit_id !== u.id || rows[0].event_id !== e.id) fail("stock_action_cas_lost");
    Object.assign(a, body);
  };
  const save = (state: string, diagnostic: string) => patch({ state, diagnostic });
  const freshEvent = async () => {
    const rows = syncRows<Event>(await db(`ovoko_stock_events?id=eq.${e.id}&select=*`));
    if (rows.length !== 1 || ["id", "direction", "reference", "order_id", "item_id", "quantity", "bought_at"].some(k => obj(rows[0])[k] !== obj(e)[k])) fail("stock_event_changed");
    return rows[0];
  };
  const freshUnit = async () => {
    const rows = syncRows<Unit>(await db(`ovoko_stock_units?id=eq.${u.id}&group_id=eq.${g.id}&ovoko_account=eq.${s.ovoko_account}&select=*`));
    if (rows.length !== 1 || ["id", "group_id", "ovoko_account", "ordinal", "external_id", "state", "part_id", "request_hash", "created_at", "updated_at"].some(k => obj(rows[0])[k] !== obj(u)[k])) fail("stock_unit_changed");
  };
  const liveOffer = async () => {
    const data = await c.allegro(`/sale/offers?offer.id=${g.offer_id}&limit=1`);
    const offers = Array.isArray(data.offers) ? data.offers.map(obj) : [];
    if (offers.length !== 1 || offers[0].id !== g.offer_id) fail("stock_offer_ownership_unconfirmed");
    const available = obj(offers[0].stock).available, status = obj(offers[0].publication).status;
    if (!Number.isSafeInteger(available) || Number(available) < 0 || Number(available) > g.quantity || !["ACTIVE", "ENDED", "INACTIVE"].includes(String(status))) fail("stock_offer_changed");
    return { available: Number(available), status };
  };
  const statuses = async () => parseOvokoRead("statuses", await c.ovoko("/get/part_status")).rows;
  const statusId = async (names: string[]) => {
    const matches = (await statuses()).filter(r => names.includes(r.name.trim().toLowerCase()));
    if (matches.length !== 1) fail("stock_status_dictionary_ambiguous");
    return matches[0].id;
  };
  const readPart = async () => {
    const page = ovokoPageData(await c.ovoko(`/v2/get/parts?external_ids=${encodeURIComponent(u.external_id)}&page=1&limit=2`), { page: 1, limit: 2 }, "stock.sync");
    if (page.pagination.total !== 1 || page.data.length !== 1 || String(page.data[0].id) !== u.part_id || page.data[0].external_id !== u.external_id) fail("stock_part_link_changed");
    return String(page.data[0].status);
  };
  const source = async (requireSold = true) => {
    await freshUnit();
    if (direction === "allegro") {
      if (!e.order_id || !e.item_id || !instant(e.bought_at) || !instant(s.armed_at) || Date.parse(e.bought_at) < Date.parse(s.armed_at)
        || !instant(u.created_at) || Date.parse(u.created_at) > Date.parse(e.bought_at)
        || !Number.isSafeInteger(e.quantity) || e.quantity < 1 || e.quantity > g.quantity) fail("stock_purchase_time_or_quantity");
      const order = await c.allegro(`/order/checkout-forms/${encodeURIComponent(e.order_id)}`);
      const items = Array.isArray(order.lineItems) ? order.lineItems.map(obj).filter(i => i.id === e.item_id) : [];
      if (!["BOUGHT", "FILLED_IN", "READY_FOR_PROCESSING"].includes(String(order.status)) || items.length !== 1 || obj(items[0].offer).id !== g.offer_id
        || items[0].quantity !== e.quantity || !instant(items[0].boughtAt) || Date.parse(items[0].boughtAt) !== Date.parse(e.bought_at)) fail("stock_purchase_not_confirmed");
    } else {
      if (!numeric(e.order_id)) fail("stock_order_id_invalid");
      const orders = ovokoSaleOrders(await c.ovoko(`/v2/get/order/${e.order_id}`));
      const order = orders[0], items = order?.parts.filter(p => p.id === u.part_id) || [];
      if (orders.length !== 1 || order.id !== e.order_id || order.source !== "ovoko" || order.status !== "NEW" || items.length !== 1 || items[0].external !== u.external_id) fail("stock_source_sale_not_confirmed");
      if (requireSold && await readPart() !== await statusId(["sprzedano", "sold out"])) fail("stock_source_not_sold");
    }
  };
  const authorizeWrite = async () => {
    const groups = syncRows<Group>(await db(`ovoko_stock_groups?id=eq.${g.id}&select=*`));
    if (groups.length !== 1 || groups[0].paused !== false
      || ["id", "owner_id", "ovoko_account", "seller_id", "offer_id", "mode", "quantity"].some(k => obj(groups[0])[k] !== obj(g)[k])) fail("stock_group_paused_or_changed");
    await syncAuthorization(db, s.owner_id, env);
    await syncAccountLock(db, s.owner_id, s.seller_id, s.ovoko_account, "check");
    const table = direction === "allegro" ? "sales_sync" : "sales_sync_reverse";
    const rows = syncRows<Subscription>(await db(`${table}?owner_id=eq.${s.owner_id}&epoch=eq.${s.epoch}&lease=eq.${s.lease}&enabled=eq.true&select=*`));
    const current = rows[0];
    if (rows.length !== 1 || !current || current.enabled !== true || !instant(current.lease_until) || Date.parse(current.lease_until) <= Date.now()
      || ["owner_id", "epoch", "lease", "seller_id", "ovoko_account", "fingerprint", "client_id"].some(k => obj(current)[k] !== obj(s)[k])
      || direction === "allegro" && current.armed_at !== s.armed_at) fail("stock_consent_changed");
    const allegro = syncRows<{ sealed: string }>(await db(`allegro_connections?owner_id=eq.${s.owner_id}&select=sealed`));
    const ovoko = syncRows<{ sealed: string }>(await db(`ovoko_connections?owner_id=eq.${s.owner_id}&select=sealed`));
    if (allegro.length !== 1 || ovoko.length !== 1 || allegro[0].sealed !== c.allegroSealed || ovoko[0].sealed !== c.ovokoSealed
      || env.SALES_SYNC_ENABLED !== "true" || env.OVOKO_TEST_ENABLED === "false") fail("stock_connection_changed");
    await source();
    if ((await freshEvent()).state !== "queued") fail("stock_event_not_queued");
  };
  try {
    await freshEvent();
    if (direction === "allegro") {
      await source();
      const offer = await liveOffer();
      if (g.mode === "shared" && offer.available > 0) { await save("done", "stock_remains"); return true; }
      const withdrawn = await statusId(["written off", "wycofany"]), status = await readPart();
      if (status === withdrawn) { await save("done", "confirmed_withdrawn"); return true; }
      if (status !== await statusId(["in stock", "na stanie"])) { await save("review", "target_sold_reserved_or_unknown"); return true; }
      if (!claim.executable) { await save("uncertain", "withdrawal_not_confirmed_no_retry"); return true; }
      await authorizeWrite();
      const latest = await liveOffer();
      if (g.mode === "shared" && latest.available > 0) { await save("done", "stock_remains"); return true; }
      if (await readPart() !== status) fail("stock_target_changed_before_write");
      await patch({ state: "running" }, "&state=eq.preflight");
      try {
        await c.ovoko("/crm/changePartStatus", new URLSearchParams({ part_id: u.part_id, status: withdrawn }));
        await save("submitted", "awaiting_withdrawal_readback");
        if (await readPart() === withdrawn) await save("done", "confirmed_withdrawn");
      } catch { await save("uncertain", "withdrawal_not_confirmed_no_retry"); }
      return true;
    }

    if (!a.quantity_done) {
      if (claim.executable) {
        await source();
        const offer = await liveOffer();
        if (offer.status !== "ACTIVE" || offer.available < 1) { await save("review", "stock_or_double_sale"); return true; }
        await authorizeWrite();
        const latest = await liveOffer();
        if (latest.status !== "ACTIVE" || latest.available < 1) fail("stock_changed_before_decrement");
        const payload = { modification: { changeType: "GAIN", value: -1 }, offerCriteria: [{ type: "CONTAINS_OFFERS", offers: [{ id: g.offer_id }] }] };
        await patch({ state: "running", command_payload: payload }, "&state=eq.preflight&quantity_done=eq.false");
        try {
          const receipt = await c.allegro(`/sale/offer-quantity-change-commands/${a.id}`, { method: "PUT", headers: { "Content-Type": "application/vnd.allegro.public.v1+json" }, body: JSON.stringify(payload) });
          if (receipt.id !== a.id) throw new Error("unconfirmed quantity command");
          await save("submitted", "awaiting_quantity_report");
        } catch { await save("uncertain", "quantity_not_confirmed_no_retry"); }
        return true;
      }
      const report = await commandReport(c, "quantity", a.id, g.offer_id);
      if (report === "failed") { await save("review", "quantity_command_failed"); return true; }
      if (report === "pending") { await save("submitted", "awaiting_quantity_report"); return true; }
      await patch({ quantity_done: true }, "&quantity_done=eq.false");
    }

    // Each follow-up has its own durable fence. Neither can replay the decrement.
    if (g.mode === "shared" && attempted(a.relist_state)) {
      if (await readPart() === await statusId(["in stock", "na stanie"])) {
        let sourceUnchanged = true;
        try { await source(false); if ((await freshEvent()).state !== "queued") sourceUnchanged = false; } catch { sourceUnchanged = false; }
        await patch({ state: sourceUnchanged ? "done" : "review", relist_state: "done", diagnostic: sourceUnchanged ? "quantity_and_relist_confirmed" : "source_changed_after_relist_confirmed" });
      } else await patch({ state: "uncertain", relist_state: "uncertain", diagnostic: "relist_not_confirmed_no_retry" });
      return true;
    }
    if (attempted(a.end_state)) {
      if (!uuid(a.end_command_id) || a.end_command_id === a.id) fail("stock_end_command_id_invalid");
      const report = await commandReport(c, "publication", a.end_command_id, g.offer_id);
      if (report === "success") await patch({ state: "done", end_state: "done", diagnostic: "quantity_and_end_confirmed" });
      else if (report === "failed") await patch({ state: "review", end_state: "done", diagnostic: "end_command_failed" });
      else await patch({ state: "submitted", end_state: "submitted", diagnostic: "awaiting_end_report" });
      return true;
    }
    // Cancellation blocks new writes, not reconciliation of a command already sent.
    try { await source(); }
    catch { await save("review", "source_changed_after_quantity_no_relist"); return true; }
    const offer = await liveOffer();
    if (offer.available > 0) {
      if (g.mode === "separate") { await save("done", "quantity_confirmed"); return true; }
      if (offer.status !== "ACTIVE" || a.relist_state !== "pending") fail("stock_relist_not_safe");
      const inStock = await statusId(["in stock", "na stanie"]);
      await authorizeWrite();
      const latest = await liveOffer();
      if (latest.available < 1 || latest.status !== "ACTIVE") fail("stock_changed_before_relist");
      await patch({ relist_state: "running" }, "&quantity_done=eq.true&relist_state=eq.pending");
      try {
        await c.ovoko("/crm/changePartStatus", new URLSearchParams({ part_id: u.part_id, status: inStock }));
        await patch({ state: "submitted", relist_state: "submitted", diagnostic: "awaiting_relist_readback" });
        if (await readPart() === inStock) await patch({ state: "done", relist_state: "done", diagnostic: "quantity_and_relist_confirmed" });
      } catch { await patch({ state: "uncertain", relist_state: "uncertain", diagnostic: "relist_not_confirmed_no_retry" }); }
      return true;
    }
    if (["ENDED", "INACTIVE"].includes(String(offer.status))) { await save("done", "quantity_confirmed_zero_inactive"); return true; }
    if (!uuid(a.end_command_id) || a.end_command_id === a.id || a.end_state !== "pending") fail("stock_end_phase_invalid");
    await authorizeWrite();
    const latest = await liveOffer();
    if (latest.available !== 0 || latest.status !== "ACTIVE") fail("stock_changed_before_end");
    await patch({ end_state: "running" }, "&quantity_done=eq.true&end_state=eq.pending");
    try {
      const receipt = await c.allegro(`/sale/offer-publication-commands/${a.end_command_id}`, { method: "PUT", headers: { "Content-Type": "application/vnd.allegro.public.v1+json" }, body: JSON.stringify({ publication: { action: "END" }, offerCriteria: [{ type: "CONTAINS_OFFERS", offers: [{ id: g.offer_id }] }] }) });
      if (receipt.id !== a.end_command_id) throw new Error("unconfirmed end command");
      await patch({ state: "submitted", end_state: "submitted", diagnostic: "awaiting_end_report" });
    } catch { await patch({ state: "uncertain", end_state: "uncertain", diagnostic: "end_not_confirmed_no_retry" }); }
    return true;
  } catch (error) {
    const started = !claim.executable || a.state !== "preflight" || a.quantity_done || attempted(a.end_state) || attempted(a.relist_state);
    await save(started ? "uncertain" : "review", error instanceof OvokoError ? error.message : "stock_preflight_or_readback_failed");
    return true;
  }
}
