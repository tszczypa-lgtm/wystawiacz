import type { accountContext } from "./account-api";
import { OvokoError } from "./ovoko-read";
import { ovokoWriteDigest, ovokoRemoteDiagnosis, type ovokoWriteClient } from "./ovoko-write-client";

type Context = Awaited<ReturnType<typeof accountContext>>;
type Group = { id: string; owner_id: string; ovoko_account: string; seller_id: string; offer_id: string; quantity: number; mode: "separate" | "shared"; paused?: boolean };
type Unit = { id: string; group_id: string; ovoko_account: string; ordinal: number; external_id: string; state: "pending" | "sending" | "created" | "uncertain"; part_id: string | null; request_hash: string | null };
export type StockPublication = { group: Group; units: Unit[] };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function publicationStockMode(value: unknown): Group["mode"] {
  if (value === undefined) return "shared";
  if (value !== "shared" && value !== "separate") throw new OvokoError(400, "Wybierz sposob przenoszenia zapasu.");
  return value;
}
async function stockDb(context: Context, path: string, options?: RequestInit) {
  try { return await context.db(path, options); }
  catch { throw new OvokoError(503, "Nie potwierdzono rejestru zapasu Ovoko. Sprawdz migracje 026: ovoko_stock_groups, ovoko_stock_units i prepare_ovoko_stock_group. Nie ponawiaj niepewnej wysylki.", "stock_publication_locked"); }
}
export async function readStockPublication(context: Context, account: string, seller: string, offer: string): Promise<StockPublication | null> {
  const rows = await stockDb(context, `ovoko_stock_groups?ovoko_account=eq.${account}&seller_id=eq.${seller}&offer_id=eq.${offer}&select=*`);
  const invalid = () => new OvokoError(503, "Niekompletny lub nieprawidlowy rejestr zapasu Ovoko. Nie wyslano czesci.", "stock_publication_locked");
  if (!Array.isArray(rows) || rows.length > 1) throw invalid();
  if (!rows.length) return null;
  const group = rows[0] as Group;
  if (group.owner_id !== context.user.id) throw new OvokoError(409, "Ta grupa nalezy do innego wlasciciela. Nie wyslano czesci.", "stock_publication_locked");
  if (!uuid.test(group.id) || group.ovoko_account !== account || group.seller_id !== seller || group.offer_id !== offer || !Number.isInteger(group.quantity) || group.quantity < 2 || group.quantity > 10000 || !["shared", "separate"].includes(group.mode) || group.paused !== undefined && typeof group.paused !== "boolean") throw invalid();
  const count = group.mode === "shared" ? 1 : group.quantity;
  const units: Unit[] = [];
  for (let offset = 0; offset < count; offset += 1000) {
    const page = await stockDb(context, `ovoko_stock_units?group_id=eq.${group.id}&ovoko_account=eq.${account}&select=*&order=ordinal.asc&limit=1000&offset=${offset}`);
    if (!Array.isArray(page)) throw invalid();
    units.push(...page);
  }
  if (units.length !== count || units.some((unit, i) => !uuid.test(unit.id) || unit.group_id !== group.id || unit.ovoko_account !== account || unit.ordinal !== i + 1 || unit.external_id !== `tymo:${seller}:${offer}:u:${i + 1}` || !["pending", "sending", "created", "uncertain"].includes(unit.state) || unit.state === "created" && !/^[1-9]\d{0,11}$/.test(String(unit.part_id)) || unit.state === "pending" && (unit.part_id !== null || unit.request_hash !== null))) throw invalid();
  if (new Set(units.filter(unit => unit.part_id).map(unit => unit.part_id)).size !== units.filter(unit => unit.part_id).length) throw invalid();
  return { group, units };
}
export function checkStockPublication(stock: StockPublication, quantity: number | null, mode: Group["mode"]) {
  const completed = stock.units.filter(unit => unit.state === "created").length;
  const counts = `Rekordy Ovoko: ${completed}/${stock.units.length}; zapas poczatkowy: ${stock.group.quantity}.`;
  if (completed === stock.units.length) return;
  if (stock.group.paused && stock.units.some(unit => unit.state === "pending")) throw new OvokoError(409, `Transfer zostal recznie wstrzymany. Nie wyslano kolejnego rekordu. ${counts}`, "stock_changed");
  if (stock.group.mode !== mode) throw new OvokoError(409, `Tryb istniejacego transferu (${stock.group.mode}) jest niezmienny. Wybierz poprzedni tryb; nie tworzymy innego powiazania. ${counts}`, "stock_changed");
  if (stock.units.some(unit => unit.state === "sending" || unit.state === "uncertain")) throw new OvokoError(409, `Grupa ma rozpoczeta lub niepewna wysylke. Sprawdz Ovoko; nie ponawiamy ani nie omijamy blokady. ${counts}`, "stock_publication_locked");
  if (stock.units.some(unit => unit.state === "pending") && stock.group.quantity !== quantity) throw new OvokoError(409, `Liczba sztuk Allegro zmienila sie podczas transferu. Zatrzymano wysylke. ${counts}`, "stock_changed");
}
export function stockPublicationResult(stock: StockPublication, partId?: string, alreadyCreated = false) {
  const created = stock.units.filter(unit => unit.state === "created");
  const message = [alreadyCreated ? `Grupa juz przeniesiona w trybie ${stock.group.mode}. Zachowano istniejace powiazanie; nie utworzono nowych rekordow.` : "", stock.group.paused ? "Grupa recznie wstrzymana. Nie wznowiono publikacji ani dostepnosci w Ovoko." : ""].filter(Boolean).join(" ");
  return { ok: true, partId: partId || created[created.length - 1]?.part_id || "", alreadyCreated, visibilityConfirmed: false, completedUnits: created.length, totalUnits: stock.units.length, initialStock: stock.group.quantity, stockMode: stock.group.mode, paused: stock.group.paused === true, ...(message ? { message } : {}), moreUnits: stock.units.some(unit => unit.state === "pending"), partIds: created.map(unit => unit.part_id!) };
}
export async function prepareStockPublication(context: Context, account: string, seller: string, offer: string, quantity: number, mode: Group["mode"]) {
  await stockDb(context, "rpc/prepare_ovoko_stock_group", { method: "POST", body: JSON.stringify({ p_owner: context.user.id, p_account: account, p_seller: seller, p_offer: offer, p_quantity: quantity, p_mode: mode }) });
  const stock = await readStockPublication(context, account, seller, offer);
  if (!stock) throw new OvokoError(503, "Nie potwierdzono przygotowania grupy Ovoko.", "stock_publication_locked");
  checkStockPublication(stock, quantity, mode);
  return stock;
}
export async function publishStockUnit(context: Context, remote: ReturnType<typeof ovokoWriteClient>, stock: StockPublication, form: URLSearchParams) {
  const unit = stock.units.find(row => row.state === "pending");
  if (!unit) return stockPublicationResult(stock, undefined, true);
  checkStockPublication(stock, stock.group.quantity, stock.group.mode);
  const currentGroup = await stockDb(context, `ovoko_stock_groups?id=eq.${stock.group.id}&owner_id=eq.${context.user.id}&ovoko_account=eq.${stock.group.ovoko_account}&select=paused`);
  if (!Array.isArray(currentGroup) || currentGroup.length !== 1 || currentGroup[0]?.paused !== undefined && typeof currentGroup[0].paused !== "boolean") throw new OvokoError(503, "Nie potwierdzono blokady grupy Ovoko.", "stock_publication_locked");
  if (currentGroup[0].paused === true) throw new OvokoError(409, "Transfer zostal recznie wstrzymany. Nie wyslano kolejnego rekordu.", "stock_changed");
  if (form.get("external_id") !== unit.external_id) throw new OvokoError(409, "Kolejnosc sztuk zmienila sie. Nie wyslano czesci.", "stock_publication_locked");
  const hash = await ovokoWriteDigest(`${crypto.randomUUID()}:${form.toString()}`);
  const selector = `ovoko_stock_units?id=eq.${unit.id}&group_id=eq.${stock.group.id}&ovoko_account=eq.${stock.group.ovoko_account}`;
  const patch = (query: string, body: Record<string, unknown>) => stockDb(context, `${selector}${query}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ ...body, updated_at: new Date().toISOString() }) });
  const reserved = await patch("&state=eq.pending&part_id=is.null&request_hash=is.null", { state: "sending", request_hash: hash });
  if (!Array.isArray(reserved) || reserved.length !== 1 || reserved[0].id !== unit.id || reserved[0].group_id !== stock.group.id || reserved[0].ovoko_account !== stock.group.ovoko_account || reserved[0].state !== "sending" || reserved[0].request_hash !== hash || reserved[0].part_id !== null || reserved[0].external_id !== unit.external_id) throw new OvokoError(409, "Nie potwierdzono rezerwacji rekordu Ovoko. Nie ponawiaj wysylki.", "stock_publication_locked");
  let accepted = "";
  const confirmed = (rows: unknown): boolean => Array.isArray(rows) && rows.length === 1 && rows[0].id === unit.id && rows[0].state === "created" && rows[0].part_id === accepted && rows[0].request_hash === hash;
  try {
    // Exactly one import per request. Sold/absent created units are never reset by publication.
    const result = await remote("/crm/importPart", form);
    if (!/^[1-9]\d{0,11}$/.test(String(result.part_id))) throw new Error("Brak poprawnego part_id");
    accepted = String(result.part_id);
    if (!confirmed(await patch(`&state=eq.sending&request_hash=eq.${hash}`, { state: "created", part_id: accepted }))) throw new Error("Niepotwierdzony zapis");
  } catch (error) {
    let recovered = false;
    if (accepted) try { recovered = confirmed(await stockDb(context, `${selector}&select=*`)); } catch { /* Keep the lock. */ }
    if (!recovered) {
      try { await patch(`&state=eq.sending&request_hash=eq.${hash}`, { state: "uncertain", ...(accepted ? { part_id: accepted } : {}) }); } catch { /* Sending also blocks replay. */ }
      const completed = stock.units.filter(row => row.state === "created").length;
      throw new OvokoError(409, `Niepewny wynik wysylki rekordu ${unit.ordinal}/${stock.units.length}. Potwierdzono: ${completed}/${stock.units.length}. ${accepted ? `Ovoko ID ${accepted}; nie potwierdzono zapisu.` : ovokoRemoteDiagnosis(error)} Sprawdz ${unit.external_id} w Ovoko. Nie ponawiaj.`, "stock_publication_locked");
    }
  }
  unit.state = "created"; unit.part_id = accepted; unit.request_hash = hash;
  return stockPublicationResult(stock, accepted);
}
