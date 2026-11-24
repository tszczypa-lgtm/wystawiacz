import { createSupabaseBrowserClient } from "./supabase";
export type InventoryJob = { id: string; kind: string; offerId: string | null; partId: string | null; name: string; state: string; allegro: string; ovoko: string; closed: boolean; reservation: { customer: string; price: string; deposit: string; currency: string; until: string; comment: string } | null; diagnostic: string | null; createdAt: string };
export async function inventoryOperation<T = InventoryJob>(body: Record<string, unknown>): Promise<T> {
  const { data } = await createSupabaseBrowserClient().auth.getSession();
  if (!data.session) throw new Error("Zaloguj sie do Wystawiacza.");
  const response = await fetch("/api/ovoko/inventory-actions", { method: "POST", cache: "no-store", headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json() as T & { message?: string };
  const latest = await createSupabaseBrowserClient().auth.getSession();
  if (!latest.data.session || data.session.user?.id !== latest.data.session.user?.id) throw new Error("Konto zmienilo sie podczas operacji. Odswiez strone.");
  if (!response.ok) throw new Error(result.message || "Nie potwierdzono operacji. Sprawdz wynik zamiast ponawiac zapis.");
  return result;
}
export const operationState: Record<string, string> = { pending: "Przygotowane", running: "Zapis w toku / niepotwierdzony", submitted: "Wyslano; czeka na potwierdzenie", done: "Potwierdzone", uncertain: "Niepewny wynik - sprawdz portal", not_requested: "Bez zmian" };
