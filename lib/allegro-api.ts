type Env = {
  SUPABASE_SERVICE_ROLE_KEY?: string;
  ALLEGRO_ENCRYPTION_KEY?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
};
type Connection = {
  clientId: string;
  clientSecret: string;
  deviceCode?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
};
type RemotePayload = {
  errors?: { userMessage?: string; message?: string }[];
  error_description?: string;
  error?: string;
  access_token: string;
  refresh_token: string;
  expires_in: number;
  device_code: string;
  id: string;
  name: string;
  parent?: { id: string };
  [key: string]: unknown;
};
class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const apiBase = "https://api.allegro.pl";
const oauthBase = "https://allegro.pl/auth/oauth";
const accept = "application/vnd.allegro.public.v1+json";
const scopes = "allegro:api:profile:read allegro:api:sale:offers:read allegro:api:sale:offers:write allegro:api:sale:settings:read allegro:api:sale:settings:write";
const utf8 = new TextEncoder();
function base64(bytes: Uint8Array) { return btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join("")); }
function bytes(value: string) { return Uint8Array.from(atob(value), character => character.charCodeAt(0)); }
function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

export async function sealConnection(value: Connection, key: CryptoKey, owner: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: utf8.encode(owner) }, key, utf8.encode(JSON.stringify(value)));
  return `${base64(iv)}.${base64(new Uint8Array(encrypted))}`;
}
export async function openConnection(value: string, key: CryptoKey, owner: string): Promise<Connection> {
  const [iv, encrypted] = value.split(".");
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes(iv), additionalData: utf8.encode(owner) }, key, bytes(encrypted));
  return JSON.parse(new TextDecoder().decode(decrypted));
}

export async function handleAllegroApi(request: Request, env: Env): Promise<Response> {
  try {
    const authorization = request.headers.get("Authorization");
    if (!authorization?.startsWith("Bearer ")) throw new ApiError(401, "Zaloguj się do Wystawiacza.");
    if (!env.SUPABASE_SERVICE_ROLE_KEY || !env.ALLEGRO_ENCRYPTION_KEY) {
      throw new ApiError(503, "Połączenie Allegro wymaga konfiguracji serwera. Lokalne przygotowanie sesji i zdjęć jest dostępne.");
    }
    const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL || "https://wgshalvkjfefavnbccil.supabase.co";
    const publicKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_Tc8J1YDoJoslkenvJJ8e5w_eMa9GEet";
    const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { Authorization: authorization, apikey: publicKey } });
    if (!userResponse.ok) throw new ApiError(401, "Sesja wygasła. Zaloguj się ponownie.");
    const user = await userResponse.json() as { id: string };
    if (!user.id) throw new ApiError(401, "Nieprawidłowa sesja.");
    const keyBytes = bytes(env.ALLEGRO_ENCRYPTION_KEY);
    if (keyBytes.length !== 32) throw new ApiError(503, "Nieprawidłowy klucz szyfrowania serwera.");
    const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt", "decrypt"]);
    const table = `${supabaseUrl}/rest/v1/allegro_connections`;
    const dbHeaders = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" };
    async function db(path: string, options: RequestInit = {}) {
      const response = await fetch(table + path, { ...options, headers: { ...dbHeaders, ...options.headers } });
      if (!response.ok) throw new ApiError(503, "Nie udało się zapisać połączenia Allegro. Sprawdź konfigurację tabeli allegro_connections.");
      return response;
    }
    const rowResponse = await db(`?owner_id=eq.${encodeURIComponent(user.id)}&select=sealed`);
    const rows = await rowResponse.json() as { sealed: string }[];
    let connection: Connection | null = rows[0] ? await openConnection(rows[0].sealed, key, user.id) : null;
    async function save(value: Connection) {
      await db("?on_conflict=owner_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ owner_id: user.id, sealed: await sealConnection(value, key, user.id), updated_at: new Date().toISOString() }) });
      connection = value;
    }
    async function readRemote(response: Response) {
      const payload = await response.json().catch(() => ({})) as RemotePayload;
      if (!response.ok) {
        const message = payload.errors?.map((error: { userMessage?: string; message?: string }) => error.userMessage || error.message).join("; ") || payload.error_description || payload.error || "Allegro odrzuciło żądanie.";
        throw new ApiError(response.status >= 500 ? 502 : 400, message);
      }
      return payload;
    }
    async function oauth(path: string, values: Record<string, string>, current: Connection) {
      return fetch(oauthBase + path, { method: "POST", headers: { Authorization: `Basic ${base64(utf8.encode(`${current.clientId}:${current.clientSecret}`))}`, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(values) });
    }
    async function accessToken() {
      if (!connection?.accessToken) throw new ApiError(409, "Najpierw połącz konto Allegro.");
      if ((connection.expiresAt || 0) <= Date.now()) {
        if (!connection.refreshToken) throw new ApiError(409, "Połącz konto Allegro ponownie.");
        const result = await readRemote(await oauth("/token", { grant_type: "refresh_token", refresh_token: connection.refreshToken }, connection));
        await save({ ...connection, accessToken: result.access_token, refreshToken: result.refresh_token, expiresAt: Date.now() + (result.expires_in - 60) * 1000 });
      }
      return connection!.accessToken!;
    }
    async function remote(path: string, options: RequestInit = {}) {
      return readRemote(await fetch(apiBase + path, { ...options, headers: { Authorization: `Bearer ${await accessToken()}`, Accept: accept, "Accept-Language": "pl-PL", ...options.headers } }));
    }
    async function body() {
      if (Number(request.headers.get("Content-Length")) > 20 * 1024 * 1024) throw new ApiError(413, "Plik jest zbyt duży (maksimum 20 MB).");
      const text = await request.text();
      if (utf8.encode(text).length > 20 * 1024 * 1024) throw new ApiError(413, "Plik jest zbyt duży (maksimum 20 MB).");
      try { return JSON.parse(text); } catch { throw new ApiError(400, "Nieprawidłowe dane żądania."); }
    }
    const url = new URL(request.url);
    const path = url.pathname.slice("/api/allegro".length);
    if (request.method === "GET") {
      if (path === "/health") return json({ ok: true, connected: Boolean(connection?.accessToken), build: "2026-06-02.35", mode: "web" });
      // Secrets never return to the browser, unlike the original local helper.
      if (path === "/auth/credentials") return json({ clientId: connection?.clientId || "", clientSecret: "" });
      const routes: Record<string, string> = { "/me": "/me", "/shipping-rates": "/sale/shipping-rates", "/responsible-producers": "/sale/responsible-producers", "/responsible-persons": "/sale/responsible-persons" };
      if (routes[path]) return json(await remote(routes[path]));
      if (["/return-policies", "/implied-warranties", "/warranties"].includes(path)) {
        const seller = await remote("/me");
        return json(await remote(`/after-sales-service-conditions${path}?seller.id=${encodeURIComponent(seller.id)}`));
      }
      if (path === "/matching-categories") return json(await remote(`/sale/matching-categories?name=${encodeURIComponent(url.searchParams.get("name") || "")}`));
      if (path === "/categories") {
        const parent = url.searchParams.get("parentId");
        return json(await remote("/sale/categories" + (parent ? `?parent.id=${encodeURIComponent(parent)}` : "")));
      }
      if (path.startsWith("/category-parameters/")) {
        const id = path.slice("/category-parameters/".length);
        if (!/^\d+$/.test(id)) throw new ApiError(400, "Nieprawidłowa kategoria.");
        return json(await remote(`/sale/categories/${id}/parameters`));
      }
      if (path === "/category-path") {
        let id = url.searchParams.get("id") || "";
        const categories = [];
        const visited = new Set();
        while (id) {
          if (!/^\d+$/.test(id) || visited.has(id) || visited.size >= 30) throw new ApiError(400, "Nieprawidłowa ścieżka kategorii.");
          visited.add(id);
          const category = await remote(`/sale/categories/${id}`);
          categories.unshift({ id: category.id, name: category.name });
          id = category.parent?.id || "";
        }
        return json({ categories });
      }
    }
    if (request.method === "POST") {
      if (path === "/auth/logout") {
        await db(`?owner_id=eq.${encodeURIComponent(user.id)}`, { method: "DELETE" });
        return json({ connected: false });
      }
      if (path === "/auth/device") {
        const input = await body();
        if (typeof input.clientId !== "string" || typeof input.clientSecret !== "string" || !input.clientId || !input.clientSecret) throw new ApiError(400, "Brakuje Client ID lub Client Secret.");
        const current = { clientId: input.clientId, clientSecret: input.clientSecret };
        const result = await readRemote(await oauth("/device", { client_id: current.clientId, scope: scopes }, current));
        await save({ ...current, deviceCode: result.device_code });
        const { device_code: _secret, ...publicResult } = result;
        return json(publicResult);
      }
      if (path === "/auth/poll") {
        if (!connection?.deviceCode) throw new ApiError(409, "Najpierw rozpocznij logowanie Allegro.");
        const response = await oauth("/token", { grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: connection.deviceCode }, connection);
        const result = await response.clone().json() as RemotePayload;
        if (result.error && ["authorization_pending", "slow_down"].includes(result.error)) return json({ connected: false, status: result.error });
        await readRemote(response);
        await save({ clientId: connection.clientId, clientSecret: connection.clientSecret, accessToken: result.access_token, refreshToken: result.refresh_token, expiresAt: Date.now() + (result.expires_in - 60) * 1000 });
        return json({ connected: true });
      }
      if (path === "/upload-image") {
        const input = await body();
        if (!input.image?.base64 || !["image/jpeg", "image/png", "image/webp"].includes(input.image.contentType || "image/jpeg")) throw new ApiError(400, "Nieprawidłowe zdjęcie.");
        const image = bytes(input.image.base64);
        return json(await readRemote(await fetch("https://upload.allegro.pl/sale/images", { method: "POST", headers: { Authorization: `Bearer ${await accessToken()}`, Accept: accept, "Content-Type": input.image.contentType || "image/jpeg" }, body: image })));
      }
      if (path === "/product-offers") {
        const input = await body();
        const offer = input.offerBase64 ? JSON.parse(new TextDecoder().decode(bytes(input.offerBase64))) : input.offer;
        if (!offer || typeof offer !== "object" || Array.isArray(offer)) throw new ApiError(400, "Brakuje danych oferty.");
        return json(await remote("/sale/product-offers", { method: "POST", headers: { "Content-Type": accept }, body: JSON.stringify(offer) }));
      }
    }
    return json({ message: "Nieznana trasa API." }, 404);
  } catch (error) {
    return json({ message: error instanceof ApiError ? error.message : "Błąd obsługi Allegro. Sprawdź konfigurację serwera i spróbuj ponownie." }, error instanceof ApiError ? error.status : 500);
  }
}
