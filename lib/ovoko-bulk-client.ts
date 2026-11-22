import { createSupabaseBrowserClient } from "./supabase";
export class OvokoBulkClientError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export async function ovokoBulkRequest<T>(body: unknown): Promise<T> {
  const { data } = await createSupabaseBrowserClient().auth.getSession();
  if (!data.session) throw new OvokoBulkClientError("Zaloguj sie ponownie.", 401);
  const response = await fetch("/api/ovoko/bulk", { method: "POST", cache: "no-store", headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json() as { message?: string };
  if (!response.ok) throw new OvokoBulkClientError(result.message || "Nie potwierdzono wysylki. Sprawdz Ovoko.", response.status);
  return result as T;
}
