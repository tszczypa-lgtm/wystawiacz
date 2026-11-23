import { createSupabaseBrowserClient } from "./supabase";
export class OvokoBulkClientError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}
export async function ovokoBulkRequest<T>(body: unknown): Promise<T> {
  const { data } = await createSupabaseBrowserClient().auth.getSession();
  if (!data.session) throw new OvokoBulkClientError("Zaloguj sie ponownie.", 401);
  const response = await fetch("/api/ovoko/bulk", { method: "POST", cache: "no-store", headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json() as { message?: string; code?: string };
  if (!response.ok) throw new OvokoBulkClientError(result.message || "Nie potwierdzono wysylki. Sprawdz Ovoko.", response.status, (body as { operation?: string })?.operation === "prepare" && ["vehicle_creation_locked", "publication_locked"].includes(result.code || "") ? result.code : undefined);
  return result as T;
}
