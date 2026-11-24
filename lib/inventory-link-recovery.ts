import { syncAuthorization, syncConnections, type SalesSyncEnv } from "./sales-sync-connections";
import { salesSyncDb, syncRows, syncJson, type SyncDb } from "./sales-sync-store";
import { OvokoError, ovokoPageData } from "./ovoko-read";
import { ovokoWriteDigest } from "./ovoko-write-client";

type Data = Record<string, unknown>;
type Plan = { id: string; owner_id: string; seller_id: string; ovoko_account: string; fingerprint: string; client_id: string; offer_id: string; part_id: string; state: string; expires_at: string };
type Connection = Awaited<ReturnType<typeof syncConnections>>;
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const offerId = (v: unknown): v is string => typeof v === "string" && /^\d{1,30}$/.test(v);
const partId = (v: unknown): v is string => typeof v === "string" && /^[1-9]\d{0,11}$/.test(v);
const obj = (v: unknown): Data => v && typeof v === "object" && !Array.isArray(v) ? v as Data : {};
const publicPlan = (p: Plan) => ({ id: p.id, offerId: p.offer_id, partId: p.part_id, state: p.state, expiresAt: p.expires_at });

export function recoveryCandidates(data: Data[], seller: string) {
  const rows: { offerId: string; partId: string; name: string }[] = [];
  let skipped = 0, last = BigInt(0);
  for (const part of data) {
    const id = String(part.id);
    if (!partId(id) || BigInt(id) <= last) throw new OvokoError(502, "Ovoko nie potwierdzilo kolejnosci czesci. Niczego nie odbudowano.");
    last = BigInt(id);
    const match = typeof part.external_id === "string" ? /^tymo:(\d{1,30}):(\d{1,30})$/.exec(part.external_id) : null;
    if (!match || match[1] !== seller) { skipped++; continue; }
    rows.push({ offerId: match[2], partId: id, name: typeof part.name === "string" ? part.name.slice(0,500) : "Czesc Ovoko" });
  }
  return { rows, skipped };
}
export async function recoveryLiveProof(c: Connection, offer: string, part: string) {
  const external = `tymo:${c.sellerId}:${offer}`;
  const result = ovokoPageData(await c.ovoko(`/v2/get/parts?external_ids=${encodeURIComponent(external)}&page=1&limit=2`), { page: 1, limit: 2 }, "links.external");
  if (result.pagination.total !== 1 || result.data.length !== 1 || String(result.data[0].id) !== part || result.data[0].external_id !== external) throw new OvokoError(409, "Brak jednoznacznej pary w Ovoko. Duplikat, inne ID lub zmieniony identyfikator: potrzebna kontrola reczna.");
  const a = await c.allegro(`/sale/offers?offer.id=${offer}&limit=1`);
  if (!Array.isArray(a.offers) || a.offers.length !== 1 || obj(a.offers[0]).id !== offer) throw new OvokoError(409, "Nie potwierdzono tej aukcji na polaczonym koncie Allegro. Nie laczymy po tytule ani OE.");
  const row = obj(a.offers[0]);
  return { name: typeof row.name === "string" ? row.name.slice(0,500) : "Oferta Allegro", allegroStatus: String(obj(row.publication).status || "nieznany"), stock: typeof obj(row.stock).available === "number" ? obj(row.stock).available : null, ovokoStatus: String(result.data[0].status ?? "nieznany") };
}
async function paused(db: SyncDb, owner: string) {
  for (const table of ["sales_sync", "sales_sync_reverse"]) {
    const rows = syncRows<{ enabled: boolean; lease_until: string | null }>(await db(`${table}?owner_id=eq.${owner}&select=enabled,lease_until`));
    if (rows.length>1 || rows.some(s => typeof s.enabled!=="boolean" || s.lease_until!==null && !Number.isFinite(Date.parse(s.lease_until)) || s.enabled || s.lease_until && Date.parse(s.lease_until)>Date.now())) throw new OvokoError(409, "Przed odbudowa wylacz oba kierunki synchronizacji i poczekaj na zakonczenie kontroli.");
  }
  for (const table of ["sales_sync_actions", "sales_sync_reverse_actions"]) if (syncRows(await db(`${table}?owner_id=eq.${owner}&state=in.(preflight,running,submitted,uncertain)&select=id&limit=1`)).length) throw new OvokoError(409, "Synchronizacja ma trwajacy lub niepewny zapis. Najpierw sprawdz jego wynik; nie nadpisujemy historii.");
}
export async function inventoryLinkRecovery(owner: string, env: SalesSyncEnv, input: Data) {
  const operation = input.operation;
  const allowed = operation === "discover" ? ["operation","page"] : operation === "check" ? ["operation","offerId","partId"] : operation === "plans" ? ["operation"] : ["operation","planId","confirm"];
  if (!["discover","check","confirm","cancel","plans"].includes(String(operation)) || Object.keys(input).some(k => !allowed.includes(k))) throw new OvokoError(400, "Nieprawidlowa operacja odzyskiwania powiazan.");
  const raw = salesSyncDb(env);
  const db: SyncDb = async (path, init) => { try { return await raw(path, init); } catch { throw new OvokoError(409, "Nie potwierdzono rejestru odzyskiwania. Sprawdz migracje 020, wylaczenie obu kierunkow, biezace powiazania i polaczenia. Nie zmieniono aukcji."); } };
  if (operation === "plans") {
    const seen=new Set<string>();
    return { rows: syncRows<Plan>(await db(`inventory_link_recovery?owner_id=eq.${owner}&select=id,offer_id,part_id,state,expires_at&order=created_at.desc&limit=20`)).filter(p=>{const k=`${p.offer_id}:${p.part_id}`;if(seen.has(k))return false;seen.add(k);return true;}).map(publicPlan) };
  }
  if (operation === "cancel") {
    if (typeof input.planId !== "string" || !uuid.test(input.planId) || input.confirm !== true) throw new OvokoError(400, "Potwierdz anulowanie planu.");
    const rows = syncRows<Plan>(await db(`inventory_link_recovery?id=eq.${input.planId}&owner_id=eq.${owner}&state=eq.prepared`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ state: "cancelled" }) }));
    if (rows.length !== 1) throw new OvokoError(409, "Plan jest juz rozstrzygniety lub nie nalezy do tego konta.");
    return { ...publicPlan(rows[0]), message: "Anulowano plan. Synchronizacja pozostaje wylaczona." };
  }
  const c = await syncConnections(db, owner, env);
  if (operation === "discover") {
    if (!Number.isSafeInteger(input.page) || Number(input.page)<1 || Number(input.page)>1000) throw new OvokoError(400, "Wybierz strone skanowania 1-1000.");
    const page = Number(input.page), result = ovokoPageData(await c.ovoko(`/v2/get/parts?page=${page}&limit=100&sort[id]=asc`), { page, limit: 100 }, "links.discover");
    if (result.data.length !== Math.min(100, Math.max(0,result.pagination.total-(page-1)*100))) throw new OvokoError(502, "Niepelna strona Ovoko. Nie wyciagamy wnioskow o brakujacych czesciach.");
    return { readOnly: true, page, total: result.pagination.total, ...recoveryCandidates(result.data,c.sellerId), next: page*100<result.pagination.total && page<1000 ? page+1 : null };
  }
  if (operation === "check") {
    if (!offerId(input.offerId) || !partId(input.partId)) throw new OvokoError(400, "Nieprawidlowe ID aukcji lub czesci.");
    const proof = await recoveryLiveProof(c,input.offerId,input.partId);
    const rows = syncRows<{ owner_id: string; state: string; part_id: string }>(await db(`ovoko_single_publications?ovoko_account=eq.${c.account}&allegro_seller_id=eq.${c.sellerId}&allegro_offer_id=eq.${input.offerId}&select=owner_id,state,part_id`));
    if (rows.length) {
      if (rows.length === 1 && rows[0].owner_id === owner && rows[0].state === "created" && rows[0].part_id === input.partId) return { ...proof, alreadyLinked: true, state: "applied", message: "To powiazanie juz istnieje. Nie zmieniono historii." };
      throw new OvokoError(409, "Istnieje inny, obcy lub niepewny zapis publikacji. Nie nadpisujemy go odzyskiwaniem.");
    }
    await paused(db,owner);
    await syncAuthorization(db,owner,env);
    const hash = await ovokoWriteDigest(`recovered:v1:${owner}:${c.sellerId}:${c.account}:${input.offerId}:${input.partId}:${crypto.randomUUID()}`);
    const plans = syncRows<Plan>(await db("rpc/prepare_inventory_link_recovery", syncJson({ p_owner: owner,p_seller:c.sellerId,p_account:c.account,p_fingerprint:c.fingerprint,p_client:c.clientId,p_offer:input.offerId,p_part:input.partId,p_hash:hash,p_allegro:c.allegroSealed,p_ovoko:c.ovokoSealed })));
    if (plans.length!==1) throw new OvokoError(503,"Nie potwierdzono planu. Odswiez plany; niczego nie wystawiono.");
    return { ...publicPlan(plans[0]), ...proof, message: "Podglad na 5 minut. Potwierdzenie odbuduje tylko powiazanie, nie wystawi ani nie wycofa czesci. Nie odzyska historii sprzedazy i rezerwacji." };
  }
  if (typeof input.planId!=="string" || !uuid.test(input.planId) || input.confirm!==true) throw new OvokoError(400,"Potwierdz odbudowe wskazanego planu.");
  const plans = syncRows<Plan>(await db(`inventory_link_recovery?id=eq.${input.planId}&owner_id=eq.${owner}&select=*`)), p=plans[0];
  if (plans.length!==1 || !offerId(p.offer_id) || !partId(p.part_id) || p.seller_id!==c.sellerId || p.ovoko_account!==c.account || p.fingerprint!==c.fingerprint || p.client_id!==c.clientId) throw new OvokoError(409,"Plan nie nalezy do aktualnych kont lub zmienily sie polaczenia.");
  if (p.state==="applied") return { ...publicPlan(p), message:"Powiazanie juz odbudowane. Niczego nie ponowiono." };
  if (p.state!=="prepared" || Date.parse(p.expires_at)<=Date.now()) throw new OvokoError(409,"Plan wygasl lub zostal anulowany. Sprawdz pare ponownie.");
  await paused(db,owner);
  await recoveryLiveProof(c,p.offer_id,p.part_id);
  await syncAuthorization(db,owner,env);
  const applied = await db("rpc/apply_inventory_link_recovery", syncJson({ p_owner:owner,p_id:p.id,p_allegro:c.allegroSealed,p_ovoko:c.ovokoSealed,p_fingerprint:c.fingerprint,p_client:c.clientId }));
  if (applied!==true) throw new OvokoError(503,"Nie potwierdzono zapisu. Odswiez plany zamiast ponawiac publikacje.");
  return { ...publicPlan(p), state:"applied", message:"Odbudowano powiazanie. Aukcje, ceny, stany i zdjecia bez zmian. Synchronizacja pozostaje wylaczona; wlacz ja osobno od teraz po kontroli." };
}
