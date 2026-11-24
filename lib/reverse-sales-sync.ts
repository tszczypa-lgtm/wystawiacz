import { syncAuthorization, syncConnections, type SalesSyncEnv } from "./sales-sync-connections";
import { salesSyncDb, syncJson, syncRows, type SyncDb } from "./sales-sync-store";
import { OvokoError, ovokoPageData, parseOvokoRead } from "./ovoko-read";
import { ovokoSaleOrders } from "./ovoko-sale-evidence";
type Data = Record<string, unknown>;
type Subscription = { owner_id: string; epoch: string; enabled: boolean; seller_id: string; ovoko_account: string; fingerprint: string; client_id: string; armed_at: string; baseline: string[]; watch: { offerId: string; partId: string; hash: string }[]; lease: string | null; lease_until: string | null; last_checked_at: string | null; last_error: string | null };
type Action = { id: string; owner_id: string; epoch: string; order_id: string; part_id: string; offer_id: string; publication_hash: string; state: string };
const obj = (v: unknown): Data => v && typeof v === "object" && !Array.isArray(v) ? v as Data : {};
const selection = (s: Subscription) => `sales_sync_reverse?owner_id=eq.${s.owner_id}&epoch=eq.${s.epoch}&lease=eq.${s.lease}`;
const date = (n: number) => new Date(n).toISOString().slice(0, 10);
const windowFor = (since: string) => ({ from: date(Date.parse(since) - 86400000), to: date(Date.now() + 86400000) });
function reverseDb(env: SalesSyncEnv): SyncDb {
  const db = salesSyncDb(env);
  return async (path, init) => { try { return await db(path, init); } catch (e) {
    if (/^(sales_sync_reverse|rpc\/(claim_reverse_sales_sync|ingest_reverse_sales_sync))/.test(path)) throw new OvokoError(503, "Nie potwierdzono rejestru Ovoko -> Allegro. Wykonaj migracje 018; nie ponawiamy niepewnych zapisow.");
    throw e;
  } };
}
async function orderWindow(c: Awaited<ReturnType<typeof syncConnections>>, since: string) {
  const range = windowFor(since);
  const orders = ovokoSaleOrders(await c.ovoko(`/v2/get/orders/${range.from}/${range.to}`));
  if (orders.some(o => o.date.slice(0, 10) < range.from || o.date.slice(0, 10) > range.to)) throw new OvokoError(502, "Ovoko nie potwierdzilo zakresu dat zamowien.");
  return orders;
}
export async function reverseSyncControl(owner: string, env: SalesSyncEnv, input: Data) {
  if (!["status", "enable", "disable"].includes(String(input.operation)) || Object.keys(input).some(k => !["operation", "confirm"].includes(k))) throw new OvokoError(400, "Nieprawidlowa operacja synchronizacji Ovoko.");
  const db = reverseDb(env);
  const existing = syncRows<Subscription>(await db(`sales_sync_reverse?owner_id=eq.${owner}&select=*`))[0];
  if (input.operation === "disable") await db(`sales_sync_reverse?owner_id=eq.${owner}`, { method: "PATCH", body: JSON.stringify({ enabled: false }) });
  if (input.operation === "enable" && !existing?.enabled) {
    if (input.confirm !== true || env.SALES_SYNC_ENABLED !== "true") throw new OvokoError(400, "Potwierdz wlaczenie synchronizacji; wymagane SALES_SYNC_ENABLED=true i migracja 018.");
    if (existing?.lease_until && Date.parse(existing.lease_until) > Date.now()) throw new OvokoError(409, "Poprzednia kontrola jeszcze trwa.");
    const c = await syncConnections(db, owner, env), start = new Date().toISOString();
    const baseline = (await orderWindow(c, start)).map(o => o.id);
    const journal = syncRows<{ allegro_offer_id: string; part_id: string; request_hash: string }>(await db(`ovoko_single_publications?owner_id=eq.${owner}&ovoko_account=eq.${c.account}&allegro_seller_id=eq.${c.sellerId}&state=eq.created&select=allegro_offer_id,part_id,request_hash&limit=500`));
    if (journal.length >= 500) throw new OvokoError(409, "Pierwsze wlaczenie obejmuje do 499 powiazanych czesci. Potrzebna rozszerzona kontrola zakresu.");
    const active = new Map<string, Data>();
    for (let offset = 0; offset < 2000; offset += 1000) {
      const data = await c.allegro(`/sale/offers?publication.status=ACTIVE&limit=1000&offset=${offset}`);
      if (!Array.isArray(data.offers) || data.offers.length > 1000 || !Number.isSafeInteger(data.totalCount) || Number(data.totalCount) > 2000) throw new OvokoError(502, "Niepelny zakres ofert Allegro podczas wlaczania synchronizacji.");
      for (const raw of data.offers) { const a = obj(raw); if (typeof a.id !== "string" || active.has(a.id)) throw new OvokoError(502, "Niejednoznaczna lista Allegro."); active.set(a.id, a); }
      if (offset + data.offers.length >= Number(data.totalCount)) break;
      if (data.offers.length !== 1000) throw new OvokoError(502, "Niepelna strona Allegro.");
    }
    const parts = new Map<string, Data>();
    for (let page = 1; page <= 20; page++) {
      const data = ovokoPageData(await c.ovoko(`/v2/get/parts?page=${page}&limit=100&sort[id]=asc`), { page, limit: 100 }, "reverse.baseline");
      if (data.pagination.total > 2000 || data.data.length !== Math.min(100, Math.max(0, data.pagination.total - (page - 1) * 100))) throw new OvokoError(502, "Niepelny zakres Ovoko podczas wlaczania synchronizacji.");
      for (const p of data.data) { if (parts.has(String(p.id))) throw new OvokoError(502, "Powtorzona czesc Ovoko."); parts.set(String(p.id), p); }
      if (parts.size >= data.pagination.total) break;
    }
    const statuses = parseOvokoRead("statuses", await c.ovoko("/get/part_status")).rows;
    const stock = statuses.filter(s => ["na stanie", "in stock"].includes(s.name.trim().toLowerCase()));
    if (stock.length !== 1) throw new OvokoError(502, "Nie potwierdzono statusu Na stanie.");
    const watch = journal.filter(j => obj(active.get(j.allegro_offer_id)?.stock).available === 1 && String(parts.get(j.part_id)?.status) === stock[0].id && parts.get(j.part_id)?.external_id === `tymo:${c.sellerId}:${j.allegro_offer_id}`).map(j => ({ offerId: j.allegro_offer_id, partId: j.part_id, hash: j.request_hash }));
    const s = { owner_id: owner, epoch: crypto.randomUUID(), enabled: true, seller_id: c.sellerId, ovoko_account: c.account, fingerprint: c.fingerprint, client_id: c.clientId, armed_at: start, baseline, watch, lease: null, lease_until: null, last_attempt_at: null, last_checked_at: null, last_error: null };
    const saved = existing ? await db(`sales_sync_reverse?owner_id=eq.${owner}&epoch=eq.${existing.epoch}&enabled=eq.false`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(s) }) : await db("sales_sync_reverse", { ...syncJson(s), headers: { Prefer: "return=representation" } });
    if (syncRows(saved).length !== 1) throw new OvokoError(409, "Ustawienia synchronizacji zmienily sie w innej karcie.");
  }
  const s = syncRows<Subscription>(await db(`sales_sync_reverse?owner_id=eq.${owner}&select=*`))[0];
  const jobs = syncRows<Data>(await db(`sales_sync_reverse_actions?owner_id=eq.${owner}&select=id,offer_id,part_id,state,diagnostic&order=created_at.desc&limit=10`));
  return { configured: env.SALES_SYNC_ENABLED === "true", enabled: s?.enabled === true, lastChecked: s?.last_checked_at || null, lastError: s?.last_error || null, watched: s?.watch.length || 0, jobs };
}
export async function runReverseSalesSync(env: SalesSyncEnv): Promise<boolean> {
  if (env.SALES_SYNC_ENABLED !== "true" || env.OVOKO_TEST_ENABLED === "false") return false;
  const db = reverseDb(env); let s: Subscription | undefined;
  try {
    s = syncRows<Subscription>(await db("rpc/claim_reverse_sales_sync", syncJson({})))[0];
    if (!s) return false;
    await tickReverseSalesSync(s, env, db);
  } catch (e) {
    if (s) try { await db(selection(s), { method: "PATCH", body: JSON.stringify({ last_error: e instanceof OvokoError ? e.message : "Nie potwierdzono kontroli Ovoko. Bez ponawiania niepewnych zapisow." }) }); } catch { /* Keep durable action locks. */ }
    console.error(JSON.stringify({ event: "reverse_sales_sync_failed", code: e instanceof OvokoError ? e.status : 503 }));
  } finally { if (s) try { await db(selection(s), { method: "PATCH", body: JSON.stringify({ lease: null, lease_until: null }) }); } catch { /* Lease expires; mutations remain locked. */ } }
  return !!s;
}
export async function tickReverseSalesSync(s: Subscription, env: SalesSyncEnv, db: SyncDb) {
  if (Date.now() - Date.parse(s.last_checked_at || s.armed_at) > 7 * 86400000) throw new OvokoError(409, "Przerwa przekroczyla 7 dni. Sprawdz recznie oferty i ponownie wlacz synchronizacje Ovoko.");
  const c = await syncConnections(db, s.owner_id, env);
  if (c.sellerId !== s.seller_id || c.clientId !== s.client_id || c.account !== s.ovoko_account || c.fingerprint !== s.fingerprint) throw new OvokoError(409, "Konto lub polaczenie zmienily sie. Synchronizacja Ovoko wstrzymana.");
  const orders = (await orderWindow(c, s.last_checked_at || s.armed_at)).filter(o => o.source === "ovoko" && !s.baseline.includes(o.id));
  const rows = orders.flatMap(o => o.parts.map(p => ({ orderId: o.id, partId: p.id, status: o.status })));
  if (rows.length > 5000) throw new OvokoError(502, "Przekroczony bezpieczny zakres zamowien Ovoko.");
  await db("rpc/ingest_reverse_sales_sync", syncJson({ p_owner: s.owner_id, p_epoch: s.epoch, p_lease: s.lease, p_rows: rows }));
  const jobs = syncRows<Action>(await db(`sales_sync_reverse_actions?owner_id=eq.${s.owner_id}&epoch=eq.${s.epoch}&state=in.(queued,preflight,running,submitted,uncertain)&order=checked_at.asc.nullsfirst,created_at.asc&limit=1`));
  const job = jobs[0]; if (!job) return;
  const target = `sales_sync_reverse_actions?id=eq.${job.id}&owner_id=eq.${s.owner_id}&epoch=eq.${s.epoch}`;
  let executable = false;
  if (job.state === "queued") { const claim = syncRows(await db(`${target}&state=eq.queued`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ state: "preflight" }) })); if (claim.length !== 1) return; executable = true; }
  const save = (state: string, diagnostic: string) => db(target, { method: "PATCH", body: JSON.stringify({ state, diagnostic, checked_at: new Date().toISOString() }) });
  try {
    const source = ovokoSaleOrders(await c.ovoko(`/v2/get/order/${job.order_id}`));
    if (source.length !== 1 || source[0].id !== job.order_id || source[0].source !== "ovoko" || source[0].status !== "NEW" || source[0].parts.filter(p => p.id === job.part_id).length !== 1) { await save("review", "order_cancelled_or_unknown"); return; }
    const external = `tymo:${s.seller_id}:${job.offer_id}`;
    const item = source[0].parts.find(p => p.id === job.part_id)!;
    if (item.external && item.external !== external) { await save("review", "source_external_conflict"); return; }
    const journal = syncRows<{ part_id: string; request_hash: string; state: string }>(await db(`ovoko_single_publications?owner_id=eq.${s.owner_id}&ovoko_account=eq.${s.ovoko_account}&allegro_seller_id=eq.${s.seller_id}&allegro_offer_id=eq.${job.offer_id}&select=part_id,request_hash,state`));
    if (journal.length !== 1 || journal[0].state !== "created" || journal[0].part_id !== job.part_id || journal[0].request_hash !== job.publication_hash) { await save("review", "publication_changed"); return; }
    const statuses = parseOvokoRead("statuses", await c.ovoko("/get/part_status")).rows;
    const sold = statuses.filter(r => ["sprzedano", "sold out"].includes(r.name.trim().toLowerCase()));
    if (sold.length !== 1) throw new OvokoError(502, "Nie potwierdzono statusu Sprzedano.");
    const readSource = async () => {
      const page = ovokoPageData(await c.ovoko(`/v2/get/parts?external_ids=${encodeURIComponent(external)}&page=1&limit=2`), { page: 1, limit: 2 }, "reverse.sale");
      return page.pagination.total === 1 && page.data.length === 1 && String(page.data[0].id) === job.part_id && page.data[0].external_id === external && String(page.data[0].status) === sold[0].id;
    };
    if (!await readSource()) { await save("review", "source_sale_not_confirmed"); return; }
    const data = await c.allegro(`/sale/offers?offer.id=${job.offer_id}&limit=1`), offers = Array.isArray(data.offers) ? data.offers.map(obj) : [];
    if (offers.length !== 1 || offers[0].id !== job.offer_id) throw new OvokoError(409, "Nie potwierdzono wlasnosci Allegro.");
    const status = obj(offers[0].publication).status;
    if (["ENDED", "INACTIVE"].includes(String(status))) { await save("done", "allegro_end_confirmed"); return; }
    if (!executable) { await save("uncertain", "write_not_confirmed_no_retry"); return; }
    if (status !== "ACTIVE" || obj(offers[0].stock).available !== 1) { await save("review", "stock_or_double_sale"); return; }
    await syncAuthorization(db, s.owner_id);
    const consent = syncRows<Subscription>(await db(`${selection(s)}&enabled=eq.true&select=*`))[0];
    const a = syncRows<{ sealed: string }>(await db(`allegro_connections?owner_id=eq.${s.owner_id}&select=sealed`)), o = syncRows<{ sealed: string }>(await db(`ovoko_connections?owner_id=eq.${s.owner_id}&select=sealed`));
    if (!consent || Date.parse(consent.lease_until || "") <= Date.now() || a.length !== 1 || o.length !== 1 || a[0].sealed !== c.allegroSealed || o[0].sealed !== c.ovokoSealed || env.SALES_SYNC_ENABLED !== "true" || !await readSource()) throw new OvokoError(409, "Zgoda, polaczenie lub zrodlo sprzedazy zmienily sie.");
    const reserved = syncRows(await db(`${target}&state=eq.preflight`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ state: "running" }) })); if (reserved.length !== 1) return;
    try {
      const receipt = await c.allegro(`/sale/offer-publication-commands/${job.id}`, { method: "PUT", headers: { "Content-Type": "application/vnd.allegro.public.v1+json" }, body: JSON.stringify({ publication: { action: "END" }, offerCriteria: [{ type: "CONTAINS_OFFERS", offers: [{ id: job.offer_id }] }] }) });
      if (receipt.id !== job.id) throw new Error("unconfirmed command");
      await save("submitted", "awaiting_readback");
    } catch { await save("uncertain", "write_not_confirmed_no_retry"); }
  } catch (e) { await save(executable ? "review" : "uncertain", "preflight_or_readback_failed"); throw e; }
}
