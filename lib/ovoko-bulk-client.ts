import { createSupabaseBrowserClient } from "./supabase";
import type { OvokoRepairHint } from "./ovoko-read";
export class OvokoBulkClientError extends Error {
  constructor(message: string, public status: number, public code?: string, public repair?: OvokoRepairHint) { super(message); }
}
export async function ovokoBulkRequest<T>(body: unknown): Promise<T> {
  const { data } = await createSupabaseBrowserClient().auth.getSession();
  if (!data.session) throw new OvokoBulkClientError("Zaloguj sie ponownie.", 401);
  const stage = (body as { operation?: string })?.operation;
  const uncertain = stage === "item" ? "Wynik wysylki tej czesci jest niepewny. Sprawdz Ovoko; nie ponawiamy." : "Czesc nie zostala wyslana. Przygotowanie auta moze wymagac sprawdzenia. Nie ponawiamy tej pozycji.";
  let response: Response;
  try { response = await fetch("/api/ovoko/bulk", { method: "POST", cache: "no-store", headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
  catch { throw new OvokoBulkClientError(`Utracono odpowiedz (${stage}). ${uncertain}`, 502, "item_transport"); }
  const current = await createSupabaseBrowserClient().auth.getSession();
  if (!current.data.session || current.data.session.user.id !== data.session.user.id) throw new OvokoBulkClientError("Sesja Wystawiacza zmienila sie. Zatrzymano partie; sprawdz wynik biezacej oferty w Ovoko.", 401);
  const result = await response.json().catch(() => null) as { message?: string; code?: string; repair?: OvokoRepairHint } | null;
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new OvokoBulkClientError(`Serwer zwrocil HTML lub nieprawidlowe dane zamiast JSON (HTTP ${response.status}, etap ${stage}). ${uncertain}`, response.ok ? 502 : response.status, "item_transport");
  if (!response.ok) throw new OvokoBulkClientError(result.message || "Nie potwierdzono wysylki. Sprawdz Ovoko.", response.status, result.code, stage === "prepare" ? result.repair : undefined);
  return result as T;
}
