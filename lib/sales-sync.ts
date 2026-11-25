import { syncAuthorization, syncConnections, type SalesSyncEnv } from "./sales-sync-connections";
import { salesSyncDb, syncRows, syncJson, type SyncAction, type SyncDb, type SyncSubscription } from "./sales-sync-store";
import { OvokoError, ovokoPageData, parseOvokoRead } from "./ovoko-read";
import { syncAccountLock } from "./sales-sync-ownership";
import { ovokoStockSyncStatus } from "./ovoko-stock-status";
import { tickOvokoStockSync } from "./ovoko-stock-sync";

const representation = { Prefer: "return=representation" };
const selection = (s: SyncSubscription) => `sales_sync?owner_id=eq.${s.owner_id}&epoch=eq.${s.epoch}&lease=eq.${s.lease}`;
const id = (v: unknown) => typeof v === "string" && /^\d{1,30}$/.test(v);
const instant = (v: unknown) => typeof v === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v));
const record = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};

export async function salesSyncControl(owner: string, env: SalesSyncEnv, input: Record<string, unknown>) {
  if (!['status', 'enable', 'disable', 'release'].includes(String(input.operation)) || Object.keys(input).some(key => !["operation", "confirm"].includes(key))) throw new OvokoError(400, "Nieprawidlowa operacja synchronizacji.");
  const db = salesSyncDb(env);
  if (input.operation === "release") {
    if (input.confirm !== true) throw new OvokoError(400, "Potwierdz zwolnienie kont.");
    await syncAccountLock(db, owner, null, null, "release");
  }
  const existing = syncRows<SyncSubscription>(await db(`sales_sync?owner_id=eq.${owner}&select=*`))[0];
  if (input.operation === "disable" && existing) {
    await db(`sales_sync?owner_id=eq.${owner}`, { method: "PATCH", body: JSON.stringify({ enabled: false }) });
  }
  if (input.operation === "enable") {
    await ovokoStockSyncStatus(db, owner, "allegro");
    if (input.confirm !== true) throw new OvokoError(400, "Potwierdz uruchomienie automatu od teraz.");
    if (env.SALES_SYNC_ENABLED !== "true" || env.OVOKO_TEST_ENABLED === "false") throw new OvokoError(503, "Wlacz SALES_SYNC_ENABLED=true i harmonogram Cloudflare po migracji 016.");
    if (!existing?.enabled) {
      if (existing?.lease_until && Date.parse(existing.lease_until) > Date.now()) throw new OvokoError(409, "Poprzednia kontrola jeszcze trwa. Odczekaj przed ponownym wlaczeniem.");
      const connections = await syncConnections(db, owner, env);
      const stats = await connections.allegro("/order/event-stats");
      const latest = stats.latestEvent === null ? null : record(stats.latestEvent);
      if (latest !== null && (!id(latest.id) || !instant(latest.occurredAt))) throw new OvokoError(502, "Nie potwierdzono punktu startowego zdarzen Allegro.");
      // Probe the order scope and withdrawal dictionary before recording consent. No writes to portals.
      await connections.allegro(`/order/events?limit=1${latest ? `&from=${latest.id}` : ""}`);
      const statuses = parseOvokoRead("statuses", await connections.ovoko("/get/part_status")).rows;
      if (statuses.filter(row => ["written off", "wycofany"].includes(row.name.toLowerCase().trim())).length !== 1) throw new OvokoError(502, "Nie potwierdzono statusu Wycofany w Ovoko.");
      const subscription = { owner_id: owner, epoch: crypto.randomUUID(), seller_id: connections.sellerId, ovoko_account: connections.account, fingerprint: connections.fingerprint, client_id: connections.clientId,
        enabled: true, armed_at: new Date().toISOString(), cursor: latest ? latest.id : null, caught_up: true, lease: null, lease_until: null, last_attempt_at: null, last_checked_at: null, last_error: null };
      // CAS prevents concurrent tabs from replacing an already active epoch/cursor.
      await syncAccountLock(db, owner, connections.sellerId, connections.account, "claim");
      const saved = existing ? await db(`sales_sync?owner_id=eq.${owner}&epoch=eq.${existing.epoch}&enabled=eq.false`, { method: "PATCH", headers: representation, body: JSON.stringify(subscription) }) : await db("sales_sync", { ...syncJson(subscription), headers: representation });
      if (syncRows<SyncSubscription>(saved).length !== 1) throw new OvokoError(409, "Ustawienia automatu zmienily sie w innej karcie. Odswiez status.");
    }
  }
  const rows = syncRows<SyncSubscription>(await db(`sales_sync?owner_id=eq.${owner}&select=*`));
  const jobs = syncRows<Record<string, unknown>>(await db(`sales_sync_actions?owner_id=eq.${owner}&select=id,offer_id,part_id,state,diagnostic,created_at&order=created_at.desc&limit=10`));
  const s = rows[0];
  const stock = await ovokoStockSyncStatus(db, owner, "allegro").catch(error => { if (input.operation === "disable" || input.operation === "release") return null; throw error; });
  return { configured: env.SALES_SYNC_ENABLED === "true" && env.OVOKO_TEST_ENABLED !== "false", enabled: s?.enabled === true, direction: "allegro_to_ovoko" as const,
    lastChecked: s?.last_checked_at || null, lastError: s?.last_error || null, caughtUp: s?.caught_up ?? false, armedAt: s?.armed_at || null, jobs, stock };
}

export async function runSalesSync(env: SalesSyncEnv) {
  if (env.SALES_SYNC_ENABLED !== "true" || env.OVOKO_TEST_ENABLED === "false") return false;
  const db = salesSyncDb(env);
  let subscription: SyncSubscription | undefined;
  try {
    subscription = syncRows<SyncSubscription>(await db("rpc/claim_sales_sync", syncJson({})))[0];
    if (!subscription) return false;
    await tickSalesSync(subscription, env, db);
  } catch (error) {
    const message = error instanceof OvokoError ? error.message : "Kontrola automatu nie zostala potwierdzona. Nie ponawiamy niepewnych zapisow.";
    if (subscription) try { await db(selection(subscription), { method: "PATCH", body: JSON.stringify({ last_error: message }) }); } catch { /* Keep the lease: never replay an ambiguous mutation. */ }
    console.error(JSON.stringify({ event: "sales_sync_check_failed", code: error instanceof OvokoError ? error.status : 503 }));
  } finally {
    if (subscription) try { await db(selection(subscription), { method: "PATCH", body: JSON.stringify({ lease: null, lease_until: null }) }); } catch { /* Lease expires; actions keep their own durable write locks. */ }
  }
  return !!subscription;
}

export async function tickSalesSync(s: SyncSubscription, env: SalesSyncEnv, db: SyncDb) {
  if (Date.now() - Date.parse(s.last_checked_at || s.armed_at) > 55 * 86400000) throw new OvokoError(409, "Przerwa przekroczyla bezpieczny zakres historii Allegro. Wylacz i ponownie wlacz automat po recznym sprawdzeniu ofert.");
  const connections = await syncConnections(db, s.owner_id, env);
  await syncAccountLock(db, s.owner_id, connections.sellerId, connections.account, "claim");
  if (connections.sellerId !== s.seller_id || connections.clientId !== s.client_id || connections.account !== s.ovoko_account || connections.fingerprint !== s.fingerprint) throw new OvokoError(409, "Konto lub dane polaczenia zmienily sie. Automat wstrzymany; sprawdz oferty i ponownie wlacz zgode.");
  const batch = await connections.allegro(`/order/events?limit=100${s.cursor ? `&from=${s.cursor}` : ""}`);
  if (!Array.isArray(batch.events) || batch.events.length > 100) throw new OvokoError(502, "Nieprawidlowy dziennik zdarzen Allegro; nie przesunieto kursora.");
  const { allegroSaleEvidence } = await import("./allegro-sale-evidence");
  if (typeof allegroSaleEvidence !== "function") throw new OvokoError(503, "Parser zdarzen nie jest dostepny w pakiecie automatu.");
  const evidence = allegroSaleEvidence(batch, s.seller_id);
  let previous = s.cursor;
  for (const raw of batch.events) {
    const event = record(raw);
    if (!id(event.id) || previous !== null && BigInt(String(event.id)) <= BigInt(previous)) throw new OvokoError(502, "Niepotwierdzona kolejnosc zdarzen Allegro. Nie przesunieto kursora.");
    previous = String(event.id);
  }
  // Purchase time, not the later event time, prevents old purchases from affecting a new publication.
  const bought = new Map<string, string>();
  for (const raw of batch.events) {
    const order = record(record(raw).order);
    if (Array.isArray(order.lineItems)) for (const rawItem of order.lineItems) {
      const item = record(rawItem); if (typeof item.id === "string" && instant(item.boughtAt)) bought.set(item.id, String(item.boughtAt));
    }
  }
  if (evidence.length > 5000) throw new OvokoError(502, "Za duzo pozycji zdarzen w jednej kontroli.");
  const caughtUp = batch.events.length < 100;
  await db("rpc/ingest_sales_sync_with_stock", syncJson({ p_owner: s.owner_id, p_epoch: s.epoch, p_lease: s.lease, p_cursor: s.cursor, p_next: previous, p_caught_up: caughtUp, p_evidence: evidence.map(item => ({ ...item, ...(bought.has(item.itemId) ? { boughtAt: bought.get(item.itemId) } : {}) })) }));
  if (!caughtUp) return; // Drain all cancellations before considering any provider mutation.
  const jobs = syncRows<SyncAction>(await db(`sales_sync_actions?owner_id=eq.${s.owner_id}&epoch=eq.${s.epoch}&state=in.(queued,preflight,running,submitted,uncertain)&order=checked_at.asc.nullsfirst,created_at.asc&limit=1`));
  // Alternate priority so a busy legacy queue cannot starve stock-unit sales.
  if ((!jobs[0] || new Date().getUTCMinutes() % 2 === 0) && await tickOvokoStockSync(s, env, db, connections, "allegro")) return;
  if (!jobs[0]) return;
  const job = jobs[0];
  const target = `sales_sync_actions?id=eq.${job.id}&owner_id=eq.${s.owner_id}&epoch=eq.${s.epoch}`;
  let executable = false;
  if (job.state === "queued") {
    const claimed = syncRows<SyncAction>(await db(`${target}&state=eq.queued`, { method: "PATCH", headers: representation, body: JSON.stringify({ state: "preflight", checked_at: new Date().toISOString() }) }));
    if (claimed.length !== 1) return;
    executable = true;
  }
  const save = async (state: string, diagnostic: string) => { await db(target, { method: "PATCH", body: JSON.stringify({ state, diagnostic, checked_at: new Date().toISOString() }) }); };
  try {
    const external = `tymo:${s.seller_id}:${job.offer_id}`;
    const readPart = async () => {
      const page = ovokoPageData(await connections.ovoko(`/v2/get/parts?external_ids=${encodeURIComponent(external)}&page=1&limit=2`), { page: 1, limit: 2 }, "sync.external");
      if (page.pagination.total !== 1 || page.data.length !== 1 || String(page.data[0].id) !== job.part_id || page.data[0].external_id !== external) throw new OvokoError(409, "Powiazanie Ovoko nie jest jednoznaczne. Potrzebna kontrola reczna.");
      return page.data[0];
    };
    const statuses = parseOvokoRead("statuses", await connections.ovoko("/get/part_status")).rows;
    const withdrawn = statuses.filter(row => ["written off", "wycofany"].includes(row.name.trim().toLowerCase()));
    if (withdrawn.length !== 1) throw new OvokoError(502, "Nie potwierdzono statusu Wycofany.");
    const part = await readPart();
    if (String(part.status) === withdrawn[0].id) { await save("done", "confirmed_withdrawn"); return; }
    if (!executable) { await save("uncertain", "write_not_confirmed_no_retry"); return; }
    const current = statuses.find(row => row.id === String(part.status));
    if (!current || !["na stanie", "in stock"].includes(current.name.trim().toLowerCase())) { await save("review", "target_sold_reserved_or_unknown"); return; }
    const journal = syncRows<{ state: string; part_id: string; request_hash: string; updated_at: string }>(await db(`ovoko_single_publications?owner_id=eq.${s.owner_id}&ovoko_account=eq.${s.ovoko_account}&allegro_seller_id=eq.${s.seller_id}&allegro_offer_id=eq.${job.offer_id}&select=state,part_id,request_hash,updated_at`));
    if (journal.length !== 1 || journal[0].state !== "created" || journal[0].part_id !== job.part_id || journal[0].request_hash !== job.publication_hash || Date.parse(journal[0].updated_at) > Date.parse(job.bought_at)) { await save("review", "publication_changed"); return; }
    const peers = syncRows(await db(`sales_sync_actions?owner_id=eq.${s.owner_id}&part_id=eq.${job.part_id}&publication_hash=eq.${job.publication_hash}&select=id&limit=2`));
    if (peers.length !== 1 || !job.order_id) { await save("review", "multiple_purchases_or_missing_order"); return; }
    const order = await connections.allegro(`/order/checkout-forms/${encodeURIComponent(job.order_id)}`);
    if (!["BOUGHT", "FILLED_IN", "READY_FOR_PROCESSING"].includes(String(order.status)) || !Array.isArray(order.lineItems)) { await save("review", "order_cancelled_or_unknown"); return; }
    const items = order.lineItems.map(record).filter(item => item.id === job.item_id);
    if (items.length !== 1 || record(items[0].offer).id !== job.offer_id || items[0].quantity !== 1 || !instant(items[0].boughtAt) || Date.parse(String(items[0].boughtAt)) !== Date.parse(job.bought_at) || Date.parse(job.bought_at) < Date.parse(s.armed_at)) { await save("review", "purchase_not_confirmed"); return; }
    const source = await connections.allegro(`/sale/offers?offer.id=${job.offer_id}&limit=1`);
    const offers = Array.isArray(source.offers) ? source.offers.map(record) : [];
    if (offers.length !== 1 || offers[0].id !== job.offer_id || record(offers[0].stock).available !== 0 || !["ACTIVE", "ENDED", "INACTIVE"].includes(String(record(offers[0].publication).status))) { await save("review", "not_last_single_unit"); return; }
    await syncAuthorization(db, s.owner_id, env);
    await syncAccountLock(db, s.owner_id, s.seller_id, s.ovoko_account, "check");
    const consent = syncRows<SyncSubscription>(await db(`${selection(s)}&enabled=eq.true&select=*`))[0];
    if (!consent || Date.parse(consent.lease_until || "") <= Date.now() || env.SALES_SYNC_ENABLED !== "true" || env.OVOKO_TEST_ENABLED === "false") throw new OvokoError(409, "Zgoda lub rezerwacja automatu wygasla.");
    const a = syncRows<{ sealed: string }>(await db(`allegro_connections?owner_id=eq.${s.owner_id}&select=sealed`));
    const o = syncRows<{ sealed: string }>(await db(`ovoko_connections?owner_id=eq.${s.owner_id}&select=sealed`));
    if (a.length !== 1 || o.length !== 1 || a[0].sealed !== connections.allegroSealed || o[0].sealed !== connections.ovokoSealed) throw new OvokoError(409, "Polaczenie zmienilo sie przed zapisem. Sprawdz recznie.");
    // Final target read is immediately before the durable write reservation.
    if (String((await readPart()).status) !== String(part.status)) { await save("review", "target_changed_before_write"); return; }
    const reserved = syncRows(await db(`${target}&state=eq.preflight`, { method: "PATCH", headers: representation, body: JSON.stringify({ state: "running" }) }));
    if (reserved.length !== 1) return;
    try {
      await connections.ovoko("/crm/changePartStatus", new URLSearchParams({ part_id: job.part_id, status: withdrawn[0].id }));
      await save("submitted", "awaiting_readback");
      if (String((await readPart()).status) === withdrawn[0].id) await save("done", "confirmed_withdrawn");
    } catch { await save("uncertain", "write_not_confirmed_no_retry"); }
  } catch (error) {
    await save(executable ? "review" : "uncertain", "preflight_or_readback_failed");
    throw error;
  }
}
