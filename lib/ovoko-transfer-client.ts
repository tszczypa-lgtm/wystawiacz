import { createSupabaseBrowserClient } from "./supabase";
export type OvokoTransfer = { state: "not_transferred" | "transferred" | "sending" | "uncertain"; partId?: string; partIds?: string[]; totalUnits?: number; completedUnits?: number; stockMode?: "separate" | "shared" };
export async function ovokoTransferRequest<T>(payload: unknown, signal: AbortSignal): Promise<T> {
  const { data } = await createSupabaseBrowserClient().auth.getSession();
  if (!data.session) throw new Error("Zaloguj sie ponownie.");
  const response = await fetch("/api/ovoko/transfer-inventory", { method: "POST", signal, cache: "no-store", headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const result = await response.json() as { message?: string };
  if (!response.ok) throw new Error(result.message || "Nie odczytano przeniesien Ovoko.");
  return result as T;
}
