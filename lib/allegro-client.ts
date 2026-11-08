import { createSupabaseBrowserClient } from "./supabase";

export async function allegroRequest<T>(path: string, options: { signal?: AbortSignal; method?: "GET" | "POST" } = {}): Promise<T> {
  const { data } = await createSupabaseBrowserClient().auth.getSession();
  if (!data.session) throw new Error("Zaloguj sie ponownie do Wystawiacza.");
  const response = await fetch(`/api/allegro${path}`, { method: options.method || "GET", signal: options.signal, cache: "no-store", headers: { Authorization: `Bearer ${data.session.access_token}` } });
  const result = await response.json().catch(() => null) as (T & { message?: string }) | null;
  if (!response.ok) throw new Error(result?.message || "Nie udalo sie pobrac danych Allegro. Sprobuj ponownie.");
  if (!result) throw new Error("Serwer zwrocil nieprawidlowa odpowiedz.");
  return result as T;
}
