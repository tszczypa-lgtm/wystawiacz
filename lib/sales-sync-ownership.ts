import { OvokoError } from "./ovoko-read";
import { syncJson, type SyncDb } from "./sales-sync-store";
export async function syncAccountLock(db: SyncDb, owner: string, seller: string | null, ovoko: string | null, mode: "claim" | "check" | "release") {
  let result: unknown;
  try { result = await db("rpc/sync_account_lock", syncJson({ p_owner: owner, p_seller: seller, p_ovoko: ovoko, p_mode: mode })); }
  catch { throw new OvokoError(503, "Nie potwierdzono blokady synchronizacji. Wymagana migracja 019. Bez zmian na portalach."); }
  if (result !== true) throw new OvokoError(409, mode === "release" ? "Wylacz oba kierunki i sprawdz trwajace lub niepewne operacje. Nie zwolniono kont." : "Te konta sa juz obslugiwane przez inne konto Wystawiacza albo zmieniono polaczenie. Najpierw wylacz i zwolnij poprzednia synchronizacje.");
}
