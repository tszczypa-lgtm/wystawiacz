import type { OvokoReadRow } from "./ovoko-read";
import type { OvokoTransfer } from "./ovoko-transfer-client";

export type AllegroInventoryRow = { id: string; name: string; image: string; externalId: string; status: string; stock: number | null; shippingRateId: string | null; price: { amount: string; currency: string } | null };
export type CombinedPart = { key: string; name: string; image: string; allegro?: AllegroInventoryRow; ovoko?: OvokoReadRow; conflict: boolean; transfer?: OvokoTransfer };
export type CombinedSnapshot = { allegro: AllegroInventoryRow[]; ovoko: OvokoReadRow[]; transfers: Record<string, OvokoTransfer>; sellerId: string; accountEmail?: string; ovokoVerifiedAt?: string; allegroComplete: boolean; ovokoComplete: boolean; allegroTotal: number; ovokoTotal: number; statuses: Record<string, string>; errors: string[]; admin: boolean; checkedAt: string };
export const emptyCombinedSnapshot = (): CombinedSnapshot => ({ allegro: [], ovoko: [], transfers: {}, sellerId: "", allegroComplete: false, ovokoComplete: false, allegroTotal: 0, ovokoTotal: 0, statuses: {}, errors: [], admin: false, checkedAt: "" });

export function combineInventory(snapshot: CombinedSnapshot): CombinedPart[] {
  const byOffer = new Map(snapshot.allegro.map(row => [row.id, row]));
  const candidates = new Map<string, string[]>(), conflicts = new Set<string>();
  const partTargets = new Map<string, string[]>();
  const journal = new Map<string, string[]>();
  for (const [offerId, state] of Object.entries(snapshot.transfers)) if (state.state === "transferred" && state.partId && byOffer.has(offerId)) journal.set(state.partId, [...(journal.get(state.partId) || []), offerId]);
  for (const part of snapshot.ovoko) {
    const linked = new Set<string>();
    const external = part.externalId?.match(/^tymo:(\d{1,30}):(\d{1,30})$/);
    if (external && external[1] === snapshot.sellerId && byOffer.has(external[2])) linked.add(external[2]);
    for (const offerId of journal.get(part.id) || []) linked.add(offerId);
    const ids = [...linked];
    partTargets.set(part.id, ids);
    for (const offerId of ids) candidates.set(offerId, [...(candidates.get(offerId) || []), part.id]);
  }
  for (const [partId, ids] of partTargets) if (ids.length > 1) { conflicts.add(`o:${partId}`); ids.forEach(id => conflicts.add(`a:${id}`)); }
  for (const [offerId, ids] of candidates) if (ids.length > 1) { conflicts.add(`a:${offerId}`); ids.forEach(id => conflicts.add(`o:${id}`)); }
  const used = new Set<string>(), byPart = new Map(snapshot.ovoko.map(row => [row.id, row]));
  const result: CombinedPart[] = snapshot.allegro.map(allegro => {
    const ids = candidates.get(allegro.id) || [], target = ids.length === 1 ? ids[0] : undefined;
    const ovoko = target && !conflicts.has(`a:${allegro.id}`) && !conflicts.has(`o:${target}`) ? byPart.get(target) : undefined;
    if (ovoko) used.add(ovoko.id);
    return { key: `a:${allegro.id}`, name: allegro.name, image: allegro.image || ovoko?.image || "", allegro, ovoko, conflict: conflicts.has(`a:${allegro.id}`), transfer: snapshot.transfers[allegro.id] };
  });
  for (const ovoko of snapshot.ovoko) if (!used.has(ovoko.id)) result.push({ key: `o:${ovoko.id}`, name: ovoko.name, image: ovoko.image || "", ovoko, conflict: conflicts.has(`o:${ovoko.id}`) });
  return result;
}
export function ovokoInStock(row: OvokoReadRow | undefined, statuses: Record<string, string>) {
  return !!row && ["na stanie", "in stock"].includes((statuses[row.status || ""] || "").trim().toLowerCase());
}
export type CombinedFilter = { allegro: boolean; ovoko: boolean; coverage: string; query: string; priceFrom: string; priceTo: string; allStatuses: boolean; transfer?: string };
export const inventoryChannels = {
  all: { allegro: true, ovoko: true, coverage: "all" },
  allegro: { allegro: true, ovoko: false, coverage: "all" },
  ovoko: { allegro: false, ovoko: true, coverage: "all" },
  both: { allegro: true, ovoko: true, coverage: "both" },
  only_allegro: { allegro: true, ovoko: true, coverage: "allegro" },
  only_ovoko: { allegro: true, ovoko: true, coverage: "ovoko" },
} satisfies Record<string, Pick<CombinedFilter, "allegro" | "ovoko" | "coverage">>;
export type InventoryChannel = keyof typeof inventoryChannels;
export function inventoryChannel(filter: CombinedFilter): InventoryChannel {
  return (Object.keys(inventoryChannels) as InventoryChannel[]).find(key => {
    const value = inventoryChannels[key];
    return value.allegro === filter.allegro && value.ovoko === filter.ovoko && value.coverage === filter.coverage;
  }) || "all";
}
const folded = (value: string) => value.toLowerCase().replace(/ł/g, "l").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
export function filterCombinedInventory(rows: CombinedPart[], filter: CombinedFilter, snapshot: CombinedSnapshot) {
  const bound = (value: string) => !value.trim() ? null : /^\d+(?:[.,]\d{1,2})?$/.test(value.trim()) ? Number(value.replace(",", ".")) : NaN;
  const from = bound(filter.priceFrom), to = bound(filter.priceTo);
  if (Number.isNaN(from) || Number.isNaN(to) || from !== null && to !== null && from > to) throw new Error("Sprawdz zakres cen.");
  return rows.filter(row => {
    if (filter.transfer && filter.transfer !== "all" && row.transfer?.state !== filter.transfer) return false;
    const a = !!row.allegro && (filter.allStatuses || row.allegro.status === "ACTIVE");
    const o = !!row.ovoko && (filter.allStatuses || ovokoInStock(row.ovoko, snapshot.statuses));
    const aKnown = !row.allegro || ["ACTIVE", "ENDED", "INACTIVE", "ACTIVATING"].includes(row.allegro.status);
    const oKnown = !row.ovoko || !!snapshot.statuses[row.ovoko.status || ""];
    if ((filter.allegro || filter.ovoko) && !(filter.allegro && a || filter.ovoko && o)) return false;
    if (filter.coverage === "both" && !(a && o)) return false;
    if (filter.coverage === "allegro" && !(a && !o && oKnown && snapshot.ovokoComplete)) return false;
    if (filter.coverage === "ovoko" && !(o && !a && aKnown && snapshot.allegroComplete)) return false;
    if (filter.query && !folded([row.name, row.allegro?.id, row.allegro?.externalId, row.ovoko?.id, row.ovoko?.manufacturerCode, row.ovoko?.externalId].join(" ")).includes(folded(filter.query.trim()))) return false;
    // The range is always Allegro's source price; never compare an unconfirmed Ovoko currency.
    if (from !== null || to !== null) {
      if (!row.allegro?.price) return false;
      const price = Number(row.allegro.price.amount);
      if (!Number.isFinite(price) || from !== null && price < from || to !== null && price > to) return false;
    }
    return true;
  });
}
