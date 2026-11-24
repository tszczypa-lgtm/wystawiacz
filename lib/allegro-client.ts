import { createSupabaseBrowserClient } from "./supabase";

export class AllegroClientError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function allegroRequest<T>(path: string, options: { signal?: AbortSignal; method?: "GET" | "POST" } = {}): Promise<T> {
  const { data } = await createSupabaseBrowserClient().auth.getSession();
  if (!data.session) throw new AllegroClientError("Zaloguj sie ponownie do Wystawiacza.", 401);
  const response = await fetch(`/api/allegro${path}`, { method: options.method || "GET", signal: options.signal, cache: "no-store", headers: { Authorization: `Bearer ${data.session.access_token}` } });
  const result = await response.json().catch(() => null) as (T & { message?: string }) | null;
  if (!response.ok) throw new AllegroClientError(result?.message || "Nie udalo sie pobrac danych Allegro. Sprobuj ponownie.", response.status);
  if (!result) throw new Error("Serwer zwrocil nieprawidlowa odpowiedz.");
  return result as T;
}
