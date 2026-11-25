import type { OvokoReadRow } from "./ovoko-read";
import type { OvokoTransfer } from "./ovoko-transfer-client";

export type AllegroInventoryRow = { id: string; name: string; image: string; externalId: string; status: string; stock: number | null; sold?: number | null; shippingRateId: string | null; price: { amount: string; currency: string } | null };
export type CombinedPart = { key: string; name: string; image: string; allegro?: AllegroInventoryRow; ovoko?: OvokoReadRow; ovokoUnits?: OvokoReadRow[]; conflict: boolean; transfer?: OvokoTransfer };
export type CombinedSnapshot = { allegro: AllegroInventoryRow[]; ovoko: OvokoReadRow[]; transfers: Record<string, OvokoTransfer>; sellerId: string; accountEmail?: string; ovokoVerifiedAt?: string; allegroComplete: boolean; ovokoComplete: boolean; allegroTotal: number; ovokoTotal: number; statuses: Record<string, string>; errors: string[]; admin: boolean; checkedAt: string };
export const emptyCombinedSnapshot = (): CombinedSnapshot => ({ allegro: [], ovoko: [], transfers: {}, sellerId: "", allegroComplete: false, ovokoComplete: false, allegroTotal: 0, ovokoTotal: 0, statuses: {}, errors: [], admin: false, checkedAt: "" });

export function combineInventory(snapshot: CombinedSnapshot): CombinedPart[] {
  const byOffer = new Map(snapshot.allegro.map(row => [row.id, row]));
  const candidates = new Map<string, string[]>(), conflicts = new Set<string>();
  const partTargets = new Map<string, string[]>();
  const journal = new Map<string, string[]>();
  for (const [offerId, state] of Object.entries(snapshot.transfers)) {
    if (!byOffer.has(offerId)) continue;
    for (const id of state.partIds || (state.state === "transferred" && state.partId ? [state.partId] : [])) journal.set(id, [...(journal.get(id) || []), offerId]);
  }
  const externalParts = new Map<string, string>();
  for (const part of snapshot.ovoko) {
    const linked = new Set<string>();
    const external = part.externalId?.match(/^tymo:(\d{1,30}):(\d{1,30})$/);
    if (external && external[1] === snapshot.sellerId && byOffer.has(external[2])) linked.add(external[2]);
    const suffix = part.externalId?.match(/^tymo:(\d{1,30}):(\d{1,30}):(.*)$/);
    if (suffix && suffix[1] === snapshot.sellerId && byOffer.has(suffix[2])) {
      linked.add(suffix[2]);
      const transfer = snapshot.transfers[suffix[2]], ordinal = suffix[3].match(/^u:([1-9]\d*)$/);
      const prior = externalParts.get(part.externalId!);
      if (!ordinal || !transfer?.stockMode || Number(ordinal[1]) > (transfer.totalUnits || 0) || !transfer.partIds?.includes(part.id) || prior) {
        conflicts.add(`a:${suffix[2]}`); conflicts.add(`o:${part.id}`);
        if (prior) conflicts.add(`o:${prior}`);
      }
      externalParts.set(part.externalId!, part.id);
    }
    for (const offerId of journal.get(part.id) || []) linked.add(offerId);
    for (const offerId of linked) {
      const transfer = snapshot.transfers[offerId];
      if (transfer?.stockMode && (!transfer.partIds?.includes(part.id) || part.externalId && (!suffix || suffix[1] !== snapshot.sellerId || suffix[2] !== offerId || !/^u:[1-9]\d*$/.test(suffix[3])))) {
        conflicts.add(`a:${offerId}`); conflicts.add(`o:${part.id}`);
      }
    }
    const ids = [...linked];
    partTargets.set(part.id, ids);
    for (const offerId of ids) candidates.set(offerId, [...(candidates.get(offerId) || []), part.id]);
  }
  for (const [partId, ids] of partTargets) if (ids.length > 1) { conflicts.add(`o:${partId}`); ids.forEach(id => conflicts.add(`a:${id}`)); }
  for (const [offerId, ids] of candidates) {
    const transfer = snapshot.transfers[offerId];
    const validGroup = !!transfer?.stockMode && ids.every(id => transfer.partIds?.includes(id));
    if (ids.length > 1 && !validGroup || conflicts.has(`a:${offerId}`)) { conflicts.add(`a:${offerId}`); ids.forEach(id => conflicts.add(`o:${id}`)); }
  }
  const used = new Set<string>(), byPart = new Map(snapshot.ovoko.map(row => [row.id, row]));
  const result: CombinedPart[] = snapshot.allegro.map(allegro => {
    const ids = candidates.get(allegro.id) || [];
    const units = !conflicts.has(`a:${allegro.id}`) && ids.every(id => !conflicts.has(`o:${id}`)) ? ids.map(id => byPart.get(id)!) : [];
    const ovoko = units.find(unit => ovokoInStock(unit, snapshot.statuses)) || units[0];
    units.forEach(unit => used.add(unit.id));
    return { key: `a:${allegro.id}`, name: allegro.name, image: allegro.image || ovoko?.image || "", allegro, ovoko, ...(snapshot.transfers[allegro.id]?.stockMode ? { ovokoUnits: units } : {}), conflict: conflicts.has(`a:${allegro.id}`), transfer: snapshot.transfers[allegro.id] };
  });
  for (const ovoko of snapshot.ovoko) if (!used.has(ovoko.id)) result.push({ key: `o:${ovoko.id}`, name: ovoko.name, image: ovoko.image || "", ovoko, conflict: conflicts.has(`o:${ovoko.id}`) });
  return result;
}
export const isStockGroup = (row: CombinedPart) => !!row.transfer?.stockMode || row.ovokoUnits !== undefined;
export const stockReservationError = "Rezerwacje grup wielosztukowych (osobnych i wspolnych) nie sa obslugiwane, nawet gdy pozostala jedna sztuka. Wymagaja osobnej rezerwacji jednostek.";
export function expandInventoryWithdrawal(rows: CombinedPart[], scope: string) {
  return rows.flatMap(row => {
    if (row.conflict) throw new Error("Niejednoznaczne powiazanie czesci.");
    const group = isStockGroup(row);
    if (group && scope !== "allegro" && (row.transfer?.state !== "transferred" || row.ovokoUnits?.length !== row.transfer.completedUnits)) throw new Error("Nie odczytano calej potwierdzonej grupy Ovoko. Odswiez liste; nie wycofano czesci grupy.");
    const units = scope === "allegro" ? [undefined] : group ? row.ovokoUnits! : [row.ovoko];
    return (units.length ? units : [undefined]).map((unit, index) => ({
      row, partId: unit?.id ?? null, offerId: row.allegro?.id ?? null,
      targets: [...(index === 0 && row.allegro && scope !== "ovoko" ? ["allegro" as const] : []), ...(unit && scope !== "allegro" ? ["ovoko" as const] : [])],
    }));
  });
}
export function ovokoInStock(row: OvokoReadRow | undefined, statuses: Record<string, string>) {
  return !!row && ["na stanie", "in stock"].includes((statuses[row.status || ""] || "").trim().toLowerCase());
}
export type CombinedFilter = { allegro: boolean; ovoko: boolean; coverage: string; query: string; priceFrom: string; priceTo: string; allStatuses: boolean; transfer?: string; lifecycle?: "available" | "all" | "ended" | "sold" | "ovoko_withdrawn" | "allegro_ended" | "ovoko_sold" | "ovoko_reserved" };
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
    const lifecycle = filter.lifecycle || (filter.allStatuses ? "all" : "available");
    const showInactive = lifecycle !== "available";
    const oStatus = (snapshot.statuses[row.ovoko?.status || ""] || "").trim().toLowerCase();
    const aSold = !!row.allegro && (row.allegro.sold ?? 0) > 0 && row.allegro.stock === 0;
    const oSold = ["sprzedano", "sold out"].includes(oStatus);
    const aEnded = !!row.allegro && ["ENDED", "INACTIVE"].includes(row.allegro.status) && !aSold;
    const oEnded = ["wycofany", "written off"].includes(oStatus);
    const selectedSold = filter.allegro && aSold || filter.ovoko && oSold;
    const selectedActive = filter.allegro && row.allegro?.status === "ACTIVE" || filter.ovoko && ovokoInStock(row.ovoko, snapshot.statuses);
    if (lifecycle === "available" && selectedSold) return false;
    if (lifecycle === "sold" && !selectedSold) return false;
    if (lifecycle === "ended" && (selectedSold || selectedActive || !(filter.allegro && aEnded || filter.ovoko && oEnded))) return false;
    if (lifecycle === "ovoko_withdrawn" && !["wycofany", "written off"].includes(oStatus)) return false;
    if (lifecycle === "ovoko_sold" && !["sprzedano", "sold out"].includes(oStatus)) return false;
    if (lifecycle === "ovoko_reserved" && !["zarezerwowano", "reserved"].includes(oStatus)) return false;
    if (lifecycle === "allegro_ended" && row.allegro?.status !== "ENDED") return false;
    if (filter.transfer && filter.transfer !== "all" && row.transfer?.state !== filter.transfer) return false;
    const a = !!row.allegro && (showInactive || row.allegro.status === "ACTIVE");
    const o = !!row.ovoko && (showInactive || ovokoInStock(row.ovoko, snapshot.statuses));
    const aKnown = !row.allegro || ["ACTIVE", "ENDED", "INACTIVE", "ACTIVATING"].includes(row.allegro.status);
    const oKnown = !row.ovoko || !!snapshot.statuses[row.ovoko.status || ""];
    if ((filter.allegro || filter.ovoko) && !(filter.allegro && a || filter.ovoko && o)) return false;
    if (filter.coverage === "both" && !(a && o)) return false;
    if (filter.coverage === "allegro" && !(a && !o && oKnown && snapshot.ovokoComplete)) return false;
    if (filter.coverage === "ovoko" && !(o && !a && aKnown && snapshot.allegroComplete)) return false;
    const haystack = folded([row.name, row.allegro?.id, row.allegro?.externalId, row.ovoko?.id, row.ovoko?.manufacturerCode, row.ovoko?.externalId, ...(row.ovokoUnits || []).flatMap(unit => [unit.id, unit.externalId, unit.manufacturerCode])].join(" "));
    if (folded(filter.query).trim().split(/\s+/).filter(Boolean).some(token => !haystack.includes(token) && !haystack.replace(/[-\s]/g, "").includes(token.replace(/-/g, "")))) return false;
    // The range is always Allegro's source price; never compare an unconfirmed Ovoko currency.
    if (from !== null || to !== null) {
      if (!row.allegro?.price) return false;
      const price = Number(row.allegro.price.amount);
      if (!Number.isFinite(price) || from !== null && price < from || to !== null && price > to) return false;
    }
    return true;
  });
}
export function sortCombinedInventory(rows: CombinedPart[], sort: string) {
  const direction = sort.startsWith("-") ? -1 : 1, mode = sort.replace(/^-/, "");
  if (mode === "source") return rows;
  return [...rows].sort((a, b) => {
    if (mode === "name") return direction * a.name.localeCompare(b.name, "pl", { numeric: true }) || a.key.localeCompare(b.key);
    if (mode === "age") {
      // Portal IDs increase within each portal; never compare unrelated portal IDs as timestamps.
      const channel = Number(!a.allegro) - Number(!b.allegro);
      if (channel) return channel;
      const left = BigInt(a.allegro?.id || a.ovoko!.id), right = BigInt(b.allegro?.id || b.ovoko!.id);
      return left === right ? 0 : (left < right ? -1 : 1) * direction;
    }
    const value = (r: CombinedPart) => { const raw = mode === "ovoko_price" ? r.ovoko?.price : r.allegro?.price?.amount; return raw != null && raw !== "" && Number.isFinite(Number(raw)) ? Number(raw) : null; };
    const left = value(a), right = value(b);
    return left === null ? right === null ? a.key.localeCompare(b.key) : 1 : right === null ? -1 : direction * (left - right) || a.key.localeCompare(b.key);
  });
}
