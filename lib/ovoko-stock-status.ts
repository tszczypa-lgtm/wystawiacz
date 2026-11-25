import { OvokoError } from "./ovoko-read";
import { syncJson, type SyncDb } from "./sales-sync-store";

export type StockSyncStatus = { groups: number; units: number; pending: number; review: number; paused: number; recent: Record<string, unknown>[] };
export async function ovokoStockSyncStatus(db: SyncDb, owner: string, direction: "allegro" | "ovoko"): Promise<StockSyncStatus> {
  let value: unknown;
  try { value = await db("rpc/ovoko_stock_sync_status", syncJson({ p_owner: owner, p_direction: direction })); }
  catch { throw new OvokoError(503, "Nie potwierdzono obslugi wielu sztuk. Wykonaj poprawke bazy 026; sam Push origin nie aktualizuje SQL."); }
  const data = value as StockSyncStatus | null;
  if (!data || [data.groups, data.units, data.pending, data.review, data.paused ?? 0].some(n => !Number.isSafeInteger(n) || n < 0) || !Array.isArray(data.recent) || data.recent.length > 10) throw new OvokoError(503, "Nieprawidlowy zakres synchronizacji wielu sztuk.");
  return { ...data, paused: data.paused ?? 0 };
}
