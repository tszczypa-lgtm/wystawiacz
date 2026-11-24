import { OvokoError } from "./ovoko-read";
export type OvokoSaleOrder = { id: string; source: string; status: string; date: string; parts: { id: string; external: string | null }[] };
const obj = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
export function ovokoSaleOrders(value: unknown): OvokoSaleOrder[] {
  const data = obj(value);
  if (data.status_code !== "R200" || !Array.isArray(data.list) || data.list.length >= 1000) throw new OvokoError(502, "Niepotwierdzona lub zbyt dluga lista zamowien Ovoko.");
  const ids = new Set<string>();
  return data.list.map(raw => {
    const o = obj(raw);
    if (typeof o.order_id !== "string" || !/^\d{1,30}$/.test(o.order_id) || ids.has(o.order_id) || typeof o.order_source !== "string" || typeof o.order_status !== "string" || !/^[A-Z_ -]{1,80}$/i.test(o.order_status) || typeof o.order_date !== "string" || !/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)?$/.test(o.order_date) || !Array.isArray(o.item_list) || !o.item_list.length || o.item_list.length > 500) throw new OvokoError(502, "Nieprawidlowy format zamowienia Ovoko. Nie zakonczono Allegro.");
    ids.add(o.order_id); const parts = new Set<string>();
    return { id: o.order_id, source: o.order_source.toLowerCase().trim(), status: o.order_status.toUpperCase().trim(), date: o.order_date,
      parts: o.item_list.map(rawItem => { const p = obj(rawItem); if (typeof p.id !== "string" || !/^[1-9]\d{0,11}$/.test(p.id) || parts.has(p.id) || p.external_id != null && (typeof p.external_id !== "string" || p.external_id.length > 1000)) throw new OvokoError(502, "Niepotwierdzone pozycje zamowienia Ovoko."); parts.add(p.id); return { id: p.id, external: typeof p.external_id === "string" && p.external_id ? p.external_id : null }; }) };
  });
}
