import { sealConnection, openConnection } from "./allegro-api";
import { accountContext } from "./account-api";
import { OvokoError } from "./ovoko-read";

export type OvokoCredentials = { username: string; password: string; user_token: string };
type Context = Awaited<ReturnType<typeof accountContext>>;
export type OvokoKeyEnv = { OVOKO_ENCRYPTION_KEY?: string; ALLEGRO_ENCRYPTION_KEY?: string };
export function validateOvokoCredentials(values: Record<string, unknown>): OvokoCredentials {
  const result = {} as OvokoCredentials;
  for (const [name, max] of [["username", 256], ["password", 1024], ["user_token", 2048]] as const) {
    const value = values[name];
    if (typeof value !== "string" || !value.trim() || value.length > max || /[\r\n\0]/.test(value)) throw new OvokoError(400, "Wypelnij login, haslo i token API. Nie podawaj linku z menedzera hasel.");
    result[name] = name === "password" ? value : value.trim();
  }
  return result;
}
export async function ovokoConnectionKey(env: OvokoKeyEnv) {
  try {
    const raw = Uint8Array.from(atob(env.OVOKO_ENCRYPTION_KEY || env.ALLEGRO_ENCRYPTION_KEY || ""), character => character.charCodeAt(0));
    if (raw.length !== 32) throw new Error();
    return await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  } catch { throw new OvokoError(503, "Zapis polaczenia wymaga poprawnego klucza szyfrowania na serwerze."); }
}
async function db(context: Context, query: string, options?: RequestInit) {
  try { return await context.db(`ovoko_connections${query}`, options); }
  catch { throw new OvokoError(503, "Nie udalo sie odczytac lub zapisac polaczenia Ovoko. Sprawdz migracje 011 w Supabase."); }
}
export async function ovokoConnectionStatus(context: Context) {
  const rows = await db(context, `?owner_id=eq.${context.user.id}&select=verified_at`);
  if (!Array.isArray(rows) || rows.length > 1) throw new OvokoError(503, "Nieprawidlowy zapis polaczenia Ovoko.");
  return { connected: rows.length === 1, verifiedAt: rows[0]?.verified_at || null };
}
export async function loadOvokoConnection(context: Context, key: CryptoKey): Promise<OvokoCredentials> {
  const rows = await db(context, `?owner_id=eq.${context.user.id}&select=sealed`);
  if (!Array.isArray(rows) || rows.length !== 1 || typeof rows[0]?.sealed !== "string") throw new OvokoError(409, "Brak zapisanego polaczenia Ovoko. Polacz konto ponownie.");
  try {
    // Separate AAD prevents copying ciphertext between owners or from Allegro connections.
    return validateOvokoCredentials(await openConnection<Record<string, unknown>>(rows[0].sealed, key, `ovoko:v1:${context.user.id}`));
  } catch { throw new OvokoError(503, "Nie mozna odszyfrowac polaczenia Ovoko. Sprawdz klucz szyfrowania lub polacz konto ponownie."); }
}
export async function saveOvokoConnection(context: Context, key: CryptoKey, credentials: OvokoCredentials, verifiedAt: string) {
  const sealed = await sealConnection(credentials, key, `ovoko:v1:${context.user.id}`);
  await db(context, "?on_conflict=owner_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ owner_id: context.user.id, sealed, verified_at: verifiedAt, updated_at: verifiedAt }) });
}
export async function removeOvokoConnection(context: Context) {
  await db(context, `?owner_id=eq.${context.user.id}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
}
