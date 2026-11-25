import type { accountContext } from "./account-api";
import { handleAllegroApi, inventoryQuery } from "./allegro-api";
import { loadOvokoConnection, ovokoConnectionKey } from "./ovoko-connection";
import { ovokoWriteDigest } from "./ovoko-write-client";
import type { OvokoPublishEnv } from "./ovoko-publish";
import { OvokoError } from "./ovoko-read";
import type { OvokoTransfer as Transfer } from "./ovoko-transfer-client";
type Context = Awaited<ReturnType<typeof accountContext>>;
export function stockTransferStatuses(value: unknown, ids: string[]): Record<string, Transfer> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new OvokoError(502, "Nieprawidlowe podsumowanie grup Ovoko.");
  const result: Record<string, Transfer> = {};
  for (const [id, raw] of Object.entries(value)) {
    const row = raw as Omit<Transfer, "partId"> & { partId?: string | null };
    if (!ids.includes(id) || !row || !["separate", "shared"].includes(String(row.stockMode)) || !["transferred", "sending", "uncertain"].includes(row.state) || !Number.isSafeInteger(row.totalUnits) || row.totalUnits! < (row.stockMode === "shared" ? 1 : 2) || row.totalUnits! > 10000 || row.stockMode === "shared" && row.totalUnits !== 1 || !Number.isSafeInteger(row.completedUnits) || row.completedUnits! < 0 || row.completedUnits! > row.totalUnits! || !Array.isArray(row.partIds) || row.partIds.length !== row.completedUnits || row.partIds.some(part => typeof part !== "string" || !/^[1-9]\d{0,11}$/.test(part)) || new Set(row.partIds).size !== row.partIds.length || row.partId != null && row.partId !== row.partIds[0] || (row.state === "transferred") !== (row.completedUnits === row.totalUnits)) throw new OvokoError(502, "Niekompletne podsumowanie grup Ovoko.");
    result[id] = { state: row.state, stockMode: row.stockMode, partIds: row.partIds, totalUnits: row.totalUnits, completedUnits: row.completedUnits, ...(row.partIds[0] ? { partId: row.partIds[0] } : {}) };
  }
  return result;
}
export async function ovokoTransferInventory(request: Request, env: OvokoPublishEnv, context: Context, input: Record<string, unknown>) {
  const headers = { Authorization: request.headers.get("Authorization")! };
  const allegro = async (path: string) => {
    const response = await handleAllegroApi(new Request(`${new URL(request.url).origin}/api/allegro${path}`, { headers }), env);
    const body = await response.json() as Record<string, any>;
    if (!response.ok) throw new OvokoError(response.status, body.message || "Nie potwierdzono odczytu Allegro.");
    return body;
  };
  if (Object.keys(input).some(key => !["operation", "offerIds", "filters", "offset", "transfer"].includes(key))) throw new OvokoError(400, "Nieprawidlowy filtr przeniesienia.");
  if (!["statuses", "inventory"].includes(String(input.operation))) throw new OvokoError(400, "Nieznana operacja listy.");
  let params: URLSearchParams | null = null;
  if (input.operation === "statuses") {
    if (!Array.isArray(input.offerIds) || input.offerIds.length > 200 || !input.offerIds.every(id => typeof id === "string" && /^\d{1,30}$/.test(id))) throw new OvokoError(400, "Nieprawidlowe ID ofert.");
  } else {
    if (!input.filters || typeof input.filters !== "object" || Array.isArray(input.filters) || !Object.values(input.filters).every(value => typeof value === "string") || !Number.isSafeInteger(input.offset) || Number(input.offset) < 0 || Number(input.offset) >= 10000000 || !["not_transferred", "transferred", "sending", "uncertain"].includes(String(input.transfer))) throw new OvokoError(400, "Nieprawidlowe filtry przeniesienia.");
    params = new URLSearchParams(input.filters as Record<string, string>);
    params.set("offset", String(Math.min(Number(input.offset), 9999800)));
    try { inventoryQuery(params); } catch { throw new OvokoError(400, "Nieprawidlowe filtry Allegro."); }
  }
  const credentials = await loadOvokoConnection(context, await ovokoConnectionKey(env));
  const account = await ovokoWriteDigest(credentials.username.trim().toLowerCase());
  const { sellerId } = await allegro("/seller-identity");
  if (typeof sellerId !== "string" || !/^\d{1,30}$/.test(sellerId)) throw new OvokoError(502, "Niepotwierdzone konto Allegro.");
  const statuses = async (ids: string[]): Promise<Record<string, Transfer>> => {
    if (!ids.length) return {};
    let rows, stock;
    try {
      rows = await context.db(`ovoko_single_publications?owner_id=eq.${context.user.id}&ovoko_account=eq.${account}&allegro_seller_id=eq.${sellerId}&allegro_offer_id=in.(${[...new Set(ids)].join(",")})&select=allegro_offer_id,state,part_id&limit=200`);
      stock = await context.db("rpc/ovoko_stock_transfer_status", { method: "POST", body: JSON.stringify({ p_owner: context.user.id, p_account: account, p_seller: sellerId, p_offers: [...new Set(ids)] }) });
    }
    catch { throw new OvokoError(503, "Nie odczytano rejestru przeniesien Ovoko. Nie oznaczamy ofert jako nieprzeniesione przy bledzie bazy."); }
    if (!Array.isArray(rows) || rows.length > ids.length) throw new OvokoError(502, "Nieprawidlowy rejestr przeniesien.");
    const groups = stockTransferStatuses(stock, ids);
    const output: Record<string, Transfer> = Object.fromEntries(ids.map(id => [id, { state: "not_transferred", totalUnits: 0, completedUnits: 0, partIds: [] }]));
    const seen = new Set<string>();
    for (const row of rows) {
      if (!row || !ids.includes(row.allegro_offer_id) || seen.has(row.allegro_offer_id) || !["created", "sending", "uncertain"].includes(row.state)) throw new OvokoError(502, "Niepelny rejestr przeniesien.");
      seen.add(row.allegro_offer_id);
      const confirmed = row.state === "created" && /^[1-9]\d{0,11}$/.test(String(row.part_id));
      if (groups[row.allegro_offer_id]) throw new OvokoError(409, "Nakladajace sie rejestry pojedynczej czesci i grupy Ovoko.");
      output[row.allegro_offer_id] = confirmed ? { state: "transferred", partId: String(row.part_id), partIds: [String(row.part_id)], totalUnits: 1, completedUnits: 1 } : { state: row.state === "sending" ? "sending" : "uncertain", partIds: [], totalUnits: 1, completedUnits: 0 };
    }
    return { ...output, ...groups };
  };
  if (input.operation === "statuses") return { ok: true, statuses: await statuses(input.offerIds as string[]) };
  const limit = Number(params!.get("limit") || "50"), offers: any[] = [];
  let cursor = Number(input.offset), total = 0, scanned = 0;
  // A bounded forward scan preserves Allegro's filtering/order without pretending this is a filtered total.
  for (let batch = 0; batch < 5 && offers.length < limit; batch++) {
    if (cursor >= 10000000) break;
    const batchOffset = Math.min(cursor, 9999800);
    params!.set("limit", "200"); params!.set("offset", String(batchOffset));
    const data = await allegro(`/inventory?${params}`);
    total = data.totalCount;
    if (!Array.isArray(data.offers) || data.offers.length > 200 || !Number.isSafeInteger(total) || total < 0 || data.offers.some((row: any) => typeof row?.id !== "string" || !/^\d{1,30}$/.test(row.id)) || new Set(data.offers.map((row: any) => row.id)).size !== data.offers.length) throw new OvokoError(502, "Nieprawidlowa lista Allegro.");
    const remaining = data.offers.slice(cursor - batchOffset);
    if (!remaining.length) { if (cursor < total) throw new OvokoError(502, "Allegro zwrocilo niepelna strone. Nie potwierdzono wynikow filtra."); break; }
    const states = await statuses(remaining.map((row: any) => row.id));
    for (const row of remaining) {
      cursor++; scanned++;
      if (states[row.id].state === input.transfer) offers.push({ ...row, ovokoTransfer: states[row.id] });
      if (offers.length === limit) break;
    }
    if (cursor >= total) break;
  }
  return { offers, totalCount: total, count: offers.length, limit, offset: input.offset, nextOffset: cursor < Math.min(total, 10000000) ? cursor : null, scanned, fetchedAt: new Date().toISOString() };
}
