import { syncConnections, syncAuthorization, type SalesSyncEnv } from "./sales-sync-connections";
import { salesSyncDb, syncRows, type SyncDb } from "./sales-sync-store";
import { OvokoError, ovokoPageData, parseOvokoRead } from "./ovoko-read";
import { ovokoWriteDigest } from "./ovoko-write-client";

type Kind = "withdraw" | "reserve" | "restore";
type Target = "allegro" | "ovoko";
type Data = Record<string, unknown>;
type Reservation = { customer: string; price: string; deposit: string; currency: string; until: string; comment: string; groupId?: string };
type Job = { id: string; owner_id: string; kind: Kind; request_hash: string; parent_id: string | null; target_key: string; seller_id: string; ovoko_account: string; fingerprint: string; offer_id: string | null; part_id: string | null; publication_hash: string | null; external_id: string | null; name: string; a_initial: string | null; a_stock: number | null; a_sold: number | null; o_initial: string | null; targets: Target[]; reservation: Reservation | null; closed: boolean; state: string; allegro_state: string; ovoko_state: string; diagnostic: string | null; expires_at: string; created_at: string };
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const aId = (v: unknown) => typeof v === "string" && /^\d{1,30}$/.test(v);
const oId = (v: unknown) => typeof v === "string" && /^[1-9]\d{0,11}$/.test(v);
const obj = (v: unknown): Data => v && typeof v === "object" && !Array.isArray(v) ? v as Data : {};
const publicJob = (j: Job) => ({ id: j.id, kind: j.kind, offerId: j.offer_id, partId: j.part_id, name: j.name, state: j.state, allegro: j.allegro_state, ovoko: j.ovoko_state, closed: j.closed, reservation: j.reservation, diagnostic: j.diagnostic, createdAt: j.created_at });
function reservationInput(v: unknown): Reservation {
  const r = obj(v);
  if (Object.keys(r).some(k => !["customer", "price", "deposit", "currency", "until", "comment", "groupId"].includes(k)) || r.groupId !== undefined && (typeof r.groupId !== "string" || !uuid.test(r.groupId)) || typeof r.customer !== "string" || !r.customer.trim() || r.customer.length > 200 || typeof r.comment !== "string" || r.comment.length > 2000 || /\0/.test(r.customer + r.comment) || !["PLN", "EUR"].includes(String(r.currency))) throw new OvokoError(400, "Wpisz klienta, walute i komentarz (do 2000 znakow).");
  for (const k of ["price", "deposit"]) if (typeof r[k] !== "string" || !/^\d{1,8}(\.\d{1,2})?$/.test(r[k] as string)) throw new OvokoError(400, "Cena i zaliczka: dodatnia kwota lub 0, maksymalnie 2 miejsca po przecinku.");
  if (Number(r.deposit) > Number(r.price)) throw new OvokoError(400, "Zaliczka nie moze przekraczac ceny.");
  if (typeof r.until !== "string" || !/^\d{4}-\d\d-\d\dT.*Z$/.test(r.until) || !Number.isFinite(Date.parse(r.until)) || Date.parse(r.until) <= Date.now() || Date.parse(r.until) > Date.now() + 366 * 86400000) throw new OvokoError(400, "Termin rezerwacji musi byc w przyszlosci, maksymalnie rok.");
  return { customer: r.customer.trim(), price: String(r.price), deposit: String(r.deposit), currency: String(r.currency), until: r.until, comment: r.comment.trim(), ...(r.groupId ? { groupId: String(r.groupId) } : {}) };
}

export async function inventoryOperations(owner: string, env: SalesSyncEnv & { INVENTORY_WITHDRAW_ENABLED?: string }, input: Data) {
  const operation = input.operation;
  if (!["list", "prepare", "execute", "status", "prepare-restore", "cancel-plan", "archive"].includes(String(operation))) throw new OvokoError(400, "Nieprawidlowa operacja magazynowa.");
  const allowed = operation === "prepare" ? ["operation", "requestId", "kind", "offerId", "partId", "targets", "reservation", "reservationId"] : operation === "prepare-restore" ? ["operation", "requestId", "reservationId"] : operation === "list" ? ["operation"] : ["operation", "jobId", "confirm"];
  if (Object.keys(input).some(k => !allowed.includes(k))) throw new OvokoError(400, "Nieobslugiwane pole operacji magazynowej.");
  const rawDb = salesSyncDb(env);
  const db: SyncDb = async (path, init) => { try { return await rawDb(path, init); } catch { throw new OvokoError(503, "Nie potwierdzono rejestru rezerwacji/operacji. Sprawdz migracje 017; nie ponawiaj niepewnego zapisu."); } };
  if (operation === "list") return { rows: syncRows<Job>(await db(`inventory_operations?owner_id=eq.${owner}&kind=eq.reserve&closed=eq.false&select=*&order=created_at.desc&limit=200`)).map(publicJob) };
  if (operation !== "status" && env.INVENTORY_WITHDRAW_ENABLED !== "true") throw new OvokoError(503, "Operacje wymagaja INVENTORY_WITHDRAW_ENABLED=true i migracji 017.");
  const c = await syncConnections(db, owner, env);
  const selector = (id: string) => `inventory_operations?id=eq.${id}&owner_id=eq.${owner}`;
  const one = async (id: unknown) => {
    if (typeof id !== "string" || !uuid.test(id)) throw new OvokoError(400, "Nieprawidlowy numer operacji.");
    const rows = syncRows<Job>(await db(`${selector(id)}&select=*`));
    if (rows.length !== 1 || rows[0].seller_id !== c.sellerId || rows[0].ovoko_account !== c.account || rows[0].fingerprint !== c.fingerprint) throw new OvokoError(409, "Operacja nie nalezy do aktualnego konta lub zmienilo sie polaczenie.");
    return rows[0];
  };
  const live = async (offerId: string | null, partId: string | null) => {
    let a: Data = {}, o: Data = {}, hash: string | null = null;
    if (offerId) {
      const data = await c.allegro(`/sale/offers?offer.id=${offerId}&limit=1`);
      const rows = Array.isArray(data.offers) ? data.offers.map(obj) : [];
      if (rows.length !== 1 || rows[0].id !== offerId) throw new OvokoError(409, "Nie potwierdzono wlasnosci oferty Allegro.");
      a = rows[0];
    }
    if (partId && offerId) {
      const external = `tymo:${c.sellerId}:${offerId}`;
      const page = ovokoPageData(await c.ovoko(`/v2/get/parts?external_ids=${encodeURIComponent(external)}&page=1&limit=2`), { page: 1, limit: 2 }, "operations.external");
      const journal = syncRows<{ state: string; part_id: string; request_hash: string }>(await db(`ovoko_single_publications?owner_id=eq.${owner}&ovoko_account=eq.${c.account}&allegro_seller_id=eq.${c.sellerId}&allegro_offer_id=eq.${offerId}&select=state,part_id,request_hash`));
      if (page.pagination.total !== 1 || page.data.length !== 1 || String(page.data[0].id) !== partId || page.data[0].external_id !== external || journal.length !== 1 || journal[0].state !== "created" || journal[0].part_id !== partId) throw new OvokoError(409, "Niejednoznaczne powiazanie czesci. Nie wykonano operacji.");
      o = page.data[0]; hash = journal[0].request_hash;
    } else if (partId) {
      const result = await c.ovoko(`/get/part/${partId}`);
      const rows = Array.isArray(result.list) ? result.list.flat(1) : [];
      if (rows.length !== 1 || String(rows[0]?.id) !== partId) throw new OvokoError(409, "Nie potwierdzono pojedynczej czesci Ovoko na tym koncie.");
      o = rows[0];
    }
    const statuses = partId ? parseOvokoRead("statuses", await c.ovoko("/get/part_status")).rows : [];
    const code = (names: string[]) => { const matches = statuses.filter(s => names.includes(s.name.trim().toLowerCase())); if (matches.length !== 1) throw new OvokoError(502, "Nie potwierdzono statusu Ovoko."); return matches[0].id; };
    return { a, o, aStatus: String(obj(a.publication).status || ""), stock: typeof obj(a.stock).available === "number" ? Number(obj(a.stock).available) : null, oStatus: String(o.status ?? ""), hash,
      stockCode: partId ? code(["na stanie", "in stock"]) : "", withdrawnCode: partId ? code(["wycofany", "written off"]) : "" };
  };
  if (operation === "prepare" || operation === "prepare-restore") {
    if (typeof input.requestId !== "string" || !uuid.test(input.requestId)) throw new OvokoError(400, "Brak unikalnego numeru operacji.");
    const requestHash = await ovokoWriteDigest(JSON.stringify(input));
    const existing = syncRows<Job>(await db(`${selector(input.requestId)}&select=*`));
    if (existing.length) { const job = await one(input.requestId); if (job.request_hash !== requestHash) throw new OvokoError(409, "Ten numer operacji byl juz uzyty do innych danych."); return publicJob(job); }
    const parent = operation === "prepare-restore" ? await one(input.reservationId) : null;
    if (parent && (parent.kind !== "reserve" || parent.closed || parent.state !== "settled")) throw new OvokoError(409, "Rezerwacja jest zamknieta albo jej wycofanie nie zostalo zakonczone. Sprawdz najpierw wynik.");
    if (parent) {
      if (!["done", "not_requested"].includes(parent.allegro_state) || !["done", "not_requested"].includes(parent.ovoko_state)) throw new OvokoError(409, "Najpierw potwierdz wycofanie obu kanalow przyciskiem Sprawdz wynik. Nie przywracamy przy niepewnej poprzedniej operacji.");
      const prior = syncRows<Job>(await db(`inventory_operations?owner_id=eq.${owner}&parent_id=eq.${parent.id}&kind=eq.restore&select=*&limit=2`));
      if (prior.length > 1) throw new OvokoError(409, "Niejednoznaczna historia przywracania.");
      if (prior[0]) {
        const restore = await one(prior[0].id);
        if (restore.state === "prepared" && Date.parse(restore.expires_at) <= Date.now()) await db(`${selector(restore.id)}&state=eq.prepared`, { method: "PATCH", body: JSON.stringify({ expires_at: new Date(Date.now() + 900000).toISOString() }) });
        return publicJob(restore);
      }
    }
    const kind: Kind = parent ? "restore" : input.kind === "reserve" ? "reserve" : input.kind === "withdraw" ? "withdraw" : (() => { throw new OvokoError(400, "Wybierz wycofanie albo rezerwacje."); })();
    const offerId = parent ? parent.offer_id : input.offerId == null ? null : aId(input.offerId) ? String(input.offerId) : (() => { throw new OvokoError(400, "Nieprawidlowe ID Allegro."); })();
    const partId = parent ? parent.part_id : input.partId == null ? null : oId(input.partId) ? String(input.partId) : (() => { throw new OvokoError(400, "Nieprawidlowe ID Ovoko."); })();
    const targets = parent ? parent.targets : input.targets;
    if (!Array.isArray(targets) || !targets.length || targets.length > 2 || new Set(targets).size !== targets.length || targets.some(t => !["allegro", "ovoko"].includes(t) || t === "allegro" && !offerId || t === "ovoko" && !partId)) throw new OvokoError(400, "Sprawdz wybrane kanaly operacji.");
    if (kind === "reserve" && ((offerId && !targets.includes("allegro")) || (partId && !targets.includes("ovoko")))) throw new OvokoError(400, "Rezerwacja musi wstrzymac wszystkie wskazane kanaly tej czesci.");
    let r = kind === "reserve" ? reservationInput(input.reservation) : null;
    if (input.reservationId !== undefined && kind !== "reserve" && operation !== "prepare-restore") throw new OvokoError(400, "Do rezerwacji dopisujemy tylko rezerwowane czesci.");
    if (kind === "reserve" && input.reservationId !== undefined) {
      const anchor = await one(input.reservationId);
      if (anchor.kind !== "reserve" || anchor.closed || !anchor.reservation || Date.parse(anchor.reservation.until) <= Date.now()) throw new OvokoError(409, "Rezerwacja jest zamknieta lub po terminie. Utworz nowa.");
      r = reservationInput({ ...anchor.reservation, groupId: anchor.reservation.groupId || anchor.id, price: r!.price, deposit: r!.deposit });
    }
    const target = await live(offerId, partId);
    if (offerId && !["ACTIVE", "ENDED", "INACTIVE"].includes(target.aStatus)) throw new OvokoError(409, "Allegro ma przejsciowy lub nieznany status. Ponow sam odczyt.");
    if (kind === "reserve" && offerId && obj(target.a.sellingMode).format && obj(target.a.sellingMode).format !== "BUY_NOW") throw new OvokoError(409, "Rezerwacja z przywracaniem obsluguje oferty Kup teraz, nie licytacje.");
    if (kind === "reserve" && !offerId && /^tymo:/.test(String(target.o.external_id || ""))) throw new OvokoError(409, "Czesc Ovoko ma powiazanie z Allegro. Odswiez pelna liste i zaznacz polaczona pozycje, zeby wstrzymac oba kanaly.");
    if (kind === "reserve" && offerId && !partId) {
      const links = syncRows(await db(`ovoko_single_publications?owner_id=eq.${owner}&ovoko_account=eq.${c.account}&allegro_seller_id=eq.${c.sellerId}&allegro_offer_id=eq.${offerId}&state=eq.created&select=part_id&limit=1`));
      if (links.length) throw new OvokoError(409, "Istnieje powiazanie Ovoko, ale nie wskazano tej czesci. Odswiez liste i sprawdz powiazanie przed rezerwacja.");
    }
    if (kind === "reserve" && (offerId && (target.aStatus !== "ACTIVE" || target.stock !== 1) || partId && target.oStatus !== target.stockCode)) throw new OvokoError(409, "Rezerwujemy dostepna pojedyncza sztuke. Jeden z kanalow jest juz niedostepny.");
    if (kind !== "restore" && targets.includes("ovoko") && ![target.stockCode, target.withdrawnCode].includes(target.oStatus)) throw new OvokoError(409, "Ovoko jest sprzedane, zarezerwowane lub ma nieznany status.");
    if (parent && (target.hash !== parent.publication_hash || String(target.o.external_id || "") !== (parent.external_id || "") || offerId && (target.stock !== parent.a_stock || target.stock !== 1) || partId && ![target.withdrawnCode, parent.o_initial].includes(target.oStatus))) throw new OvokoError(409, "Czesc lub stan zmienily sie od rezerwacji. Nie przywracamy sprzedanej ani niepotwierdzonej sztuki.");
    if (parent && offerId && parent.a_sold !== null && obj(target.a.stock).sold !== parent.a_sold) throw new OvokoError(409, "Po rezerwacji zmienil sie licznik sprzedazy Allegro. Nie przywracamy oferty.");
    const job: Job = { id: input.requestId, owner_id: owner, kind, request_hash: requestHash, parent_id: parent?.id || null, target_key: offerId ? `a:${offerId}` : `o:${partId}`, seller_id: c.sellerId, ovoko_account: c.account, fingerprint: c.fingerprint,
      offer_id: offerId, part_id: partId, publication_hash: target.hash, external_id: String(target.o.external_id || ""), name: String(target.a.name || target.o.name || "Czesc").slice(0, 500), a_initial: parent?.a_initial || target.aStatus, a_stock: parent?.a_stock ?? target.stock, o_initial: parent?.o_initial || target.oStatus,
      a_sold: parent ? parent.a_sold : Number.isSafeInteger(obj(target.a.stock).sold) ? Number(obj(target.a.stock).sold) : null,
      targets: targets as Target[], reservation: r, closed: kind !== "reserve", state: "prepared", allegro_state: targets.includes("allegro") ? "pending" : "not_requested", ovoko_state: targets.includes("ovoko") ? "pending" : "not_requested", diagnostic: null,
      expires_at: new Date(Date.now() + 900000).toISOString(), created_at: new Date().toISOString() };
    const saved = syncRows<Job>(await db("inventory_operations", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(job) }));
    if (saved.length !== 1 || saved[0].id !== job.id) throw new OvokoError(503, "Nie potwierdzono planu. Odswiez rejestr, nie tworz kolejnej operacji.");
    return publicJob(saved[0]);
  }
  const job = await one(input.jobId);
  if (operation === "archive") {
    if (input.confirm !== true || job.kind !== "reserve" || job.state !== "settled" || !["done", "not_requested"].includes(job.allegro_state) || !["done", "not_requested"].includes(job.ovoko_state)) throw new OvokoError(409, "Najpierw sprawdz wynik rezerwacji. Nie ukrywamy niepewnych operacji.");
    const restores = syncRows<Job>(await db(`inventory_operations?owner_id=eq.${owner}&parent_id=eq.${job.id}&kind=eq.restore&select=*&limit=1`));
    if (restores.some(r => r.state !== "prepared" && (r.allegro_state !== "done" && r.allegro_state !== "not_requested" || r.ovoko_state !== "done" && r.ovoko_state !== "not_requested"))) throw new OvokoError(409, "Przywracanie ma niepewny wynik. Najpierw sprawdz wynik.");
    const saved = syncRows<Job>(await db("rpc/archive_inventory_reservation", { method: "POST", body: JSON.stringify({ p_owner: owner, p_id: job.id }) }));
    if (saved.length !== 1) throw new OvokoError(409, "Rezerwacja zmienila sie.");
    return publicJob(saved[0]);
  }
  if (operation === "cancel-plan") {
    if (input.confirm !== true || job.kind === "restore" || job.state !== "prepared") throw new OvokoError(409, "Mozna anulowac tylko nieuruchomiony plan wycofania lub rezerwacji.");
    const rows = syncRows<Job>(await db(`${selector(job.id)}&state=eq.prepared`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ state: "settled", closed: true, allegro_state: "not_requested", ovoko_state: "not_requested", diagnostic: "Anulowano nieuruchomiony plan." }) }));
    if (rows.length !== 1) throw new OvokoError(409, "Plan zmienil sie w innej karcie.");
    return publicJob(rows[0]);
  }
  if (operation === "execute" && input.confirm !== true) throw new OvokoError(400, "Potwierdz operacje na wskazanych kanalach.");
  if (operation === "execute" && job.state !== "prepared") return publicJob(job);
  if (operation === "status" && job.state === "prepared") return publicJob(job);
  const save = async () => {
    const rows = syncRows(await db(selector(job.id), { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ state: job.state, allegro_state: job.allegro_state, ovoko_state: job.ovoko_state, diagnostic: job.diagnostic, updated_at: new Date().toISOString() }) }));
    if (rows.length !== 1) throw new OvokoError(503, "Nie potwierdzono zapisu wyniku. Sprawdz rejestr; bez ponawiania.");
  };
  const settleParent = async () => {
    if (job.kind === "restore" && ["done", "not_requested"].includes(job.allegro_state) && ["done", "not_requested"].includes(job.ovoko_state)) await db(`${selector(job.parent_id!)}&kind=eq.reserve`, { method: "PATCH", body: JSON.stringify({ closed: true, updated_at: new Date().toISOString() }) });
  };
  let target = await live(job.offer_id, job.part_id);
  if (target.hash !== job.publication_hash || String(target.o.external_id || "") !== (job.external_id || "")) throw new OvokoError(409, "Powiazanie czesci zmienilo sie. Niczego nie ponowiono.");
  const desiredA = job.kind === "restore" ? "ACTIVE" : "ENDED", desiredO = job.kind === "restore" ? job.o_initial : target.withdrawnCode;
  if (operation === "status") {
    if (["running", "submitted", "uncertain"].includes(job.allegro_state) && (target.aStatus === desiredA || desiredA === "ENDED" && target.aStatus === "INACTIVE")) job.allegro_state = "done";
    if (["running", "submitted", "uncertain"].includes(job.ovoko_state) && target.oStatus === desiredO) job.ovoko_state = "done";
    await save(); await settleParent(); return publicJob(job);
  }
  if (Date.parse(job.expires_at) <= Date.now()) throw new OvokoError(409, "Plan operacji wygasl. Nie wykonano zapisu.");
  if (job.kind === "restore" && job.offer_id && (target.stock !== job.a_stock || target.stock !== 1)) throw new OvokoError(409, "Brak potwierdzonej pojedynczej sztuki. Nie przywracamy oferty.");
  if (job.kind === "restore" && job.offer_id && job.a_sold !== null && obj(target.a.stock).sold !== job.a_sold) throw new OvokoError(409, "Licznik sprzedazy Allegro zmienil sie po rezerwacji. Nie przywracamy tej oferty.");
  await syncAuthorization(db, owner, env);
  const claim = syncRows(await db(`${selector(job.id)}&state=eq.prepared`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ state: "running" }) }));
  if (claim.length !== 1) throw new OvokoError(409, "Operacja juz uruchomiona. Nie powtarzamy zapisu.");
  job.state = "running";
  for (const channel of job.targets) {
    const field = channel === "allegro" ? "allegro_state" : "ovoko_state";
    try {
      target = await live(job.offer_id, job.part_id);
      if (target.hash !== job.publication_hash || String(target.o.external_id || "") !== (job.external_id || "")) throw new Error("changed binding");
      if (job.kind === "restore" && (job.offer_id && target.stock !== 1 || job.part_id && target.oStatus !== target.withdrawnCode && target.oStatus !== desiredO)) throw new Error("availability changed");
      if (job.kind === "restore" && job.offer_id && job.a_sold !== null && obj(target.a.stock).sold !== job.a_sold) throw new Error("sale counter changed");
      if (channel === "allegro" && (target.aStatus === desiredA || desiredA === "ENDED" && target.aStatus === "INACTIVE") || channel === "ovoko" && target.oStatus === desiredO) { job[field] = "done"; await save(); continue; }
      if (channel === "ovoko" && job.kind !== "restore" && target.oStatus !== target.stockCode) throw new Error("target not available");
      await syncAuthorization(db, owner, env);
      const aBinding = syncRows<{ sealed: string }>(await db(`allegro_connections?owner_id=eq.${owner}&select=sealed`)), oBinding = syncRows<{ sealed: string }>(await db(`ovoko_connections?owner_id=eq.${owner}&select=sealed`));
      if (aBinding.length !== 1 || oBinding.length !== 1 || aBinding[0].sealed !== c.allegroSealed || oBinding[0].sealed !== c.ovokoSealed) throw new Error("connection changed");
      job[field] = "running"; await save();
      // Each leg has its own durable lock. An exception never causes provider replay.
      if (channel === "allegro") {
        const receipt = await c.allegro(`/sale/offer-publication-commands/${job.id}`, { method: "PUT", headers: { "Content-Type": "application/vnd.allegro.public.v1+json" }, body: JSON.stringify({ publication: { action: job.kind === "restore" ? "ACTIVATE" : "END" }, offerCriteria: [{ type: "CONTAINS_OFFERS", offers: [{ id: job.offer_id }] }] }) });
        if (receipt.id !== job.id) throw new Error("command not confirmed");
      } else await c.ovoko("/crm/changePartStatus", new URLSearchParams({ part_id: job.part_id!, status: String(desiredO) }));
      job[field] = "submitted";
    } catch { job[field] = "uncertain"; job.diagnostic = "Sprawdz wynik na portalu. Nie ponawiamy zapisu."; }
    await save();
  }
  job.state = "settled"; await save();
  // Immediate readback, never a second mutation.
  target = await live(job.offer_id, job.part_id);
  if (job.targets.includes("allegro") && (target.aStatus === desiredA || desiredA === "ENDED" && target.aStatus === "INACTIVE")) job.allegro_state = "done";
  if (job.targets.includes("ovoko") && target.oStatus === desiredO) job.ovoko_state = "done";
  await save(); await settleParent(); return publicJob(job);
}
