type Env = {
  SUPABASE_SERVICE_ROLE_KEY?: string;
  ALLEGRO_ENCRYPTION_KEY?: string;
  ALLEGRO_CLIENT_ID?: string;
  ALLEGRO_CLIENT_SECRET?: string;
  ALLEGRO_REDIRECT_URI?: string;
  SERPAPI_API_KEY?: string;
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
type OAuthCookie = { owner: string; state: string; verifier: string; expiresAt: number; clientId: string; redirectUri: string };
const oauthCookieName = "__Host-wystawiacz-oauth";
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
type Title = { title: string; url: string };
type TitleGroup = { source: string; titles: Title[]; message?: string; errorCode?: string };
const titleCache = new Map<string, { until: number; result: { groups: TitleGroup[] } }>();
const titleLimits = new Map<string, number[]>();
export function exactPartNumber(text: string, number: string) {
  const pattern = number.split("").join("[ .\\/-]*");
  return new RegExp(`(?:^|[^A-Z0-9])${pattern}(?![A-Z0-9]|[ .\\/-]+[A-Z0-9](?:$|[^A-Z0-9]))`, "i").test(text);
}
export function matchesTitleResult(title: string, snippet: string, number: string) {
  if (exactPartNumber(title, number)) return true;
  const family = number.replace(/[A-Z]+$/, "") || number;
  const mentionsFamily = new RegExp(`(?:^|[^A-Z0-9])${family.split("").join("[ .\\/-]*")}`, "i").test(title);
  return !mentionsFamily && exactPartNumber(snippet, number);
}
export async function searchTitleSuggestions(number: string, owner: string, env: Env, remote: (path: string, options?: RequestInit) => Promise<RemotePayload>) {
  if (!/^[A-Z0-9]{6,32}$/.test(number) || !/\d/.test(number)) throw new ApiError(400, "Wpisz poprawny, pelny numer czesci.");
  const now = Date.now();
  const cacheKey = `${owner}:${number}:${Boolean(env.SERPAPI_API_KEY)}`;
  const cached = titleCache.get(cacheKey);
  if (cached && cached.until > now) return cached.result;
  const recent = (titleLimits.get(owner) || []).filter(time => now - time < 60000);
  if (recent.length >= 8) throw new ApiError(429, "Za duzo wyszukiwan. Poczekaj minute przed kolejnym numerem.");
  if (titleLimits.size >= 1000) titleLimits.delete(titleLimits.keys().next().value!);
  titleLimits.set(owner, [...recent, now]);
  const finishTitle = (value: string) => {
    const clean = value.replace(/\s+/g, " ").trim().slice(0, 500);
    if (!clean || clean.length < 5) return "";
    // Reserve room for the full number, including its suffix, in Allegro's title.
    const tail = new RegExp(`\\s*${number.split("").join("[ .\\/-]*")}\\s*$`, "i");
    const base = clean.replace(tail, "").trim();
    return `${base.slice(0, 74 - number.length).trim()} ${number}`.trim();
  };
  const unique = (titles: Title[]) => {
    const seen = new Set<string>();
    return titles.filter(item => { const key = item.title.toLowerCase(); if (!item.title || seen.has(key)) return false; seen.add(key); return true; }).slice(0, 2);
  };
  const allegro = async (): Promise<TitleGroup> => {
    try {
      const data = await remote(`/sale/products?phrase=${encodeURIComponent(number)}&mode=MPN&language=pl-PL`, { signal: AbortSignal.timeout(10000) });
      const products = Array.isArray(data.products) ? data.products as { name?: string }[] : [];
      const titles = unique(products.filter(item => typeof item.name === "string").map(item => ({ title: finishTitle(item.name!), url: `https://allegro.pl/listing?string=${encodeURIComponent(number)}` })));
      return { source: "allegro", titles, ...(!titles.length ? { message: "Brak produktu z tym numerem w katalogu Allegro." } : {}) };
    } catch { return { source: "allegro", titles: [], message: "Nie udalo sie pobrac katalogu Allegro. Sprawdz polaczenie konta." }; }
  };
  const google = async (): Promise<TitleGroup> => {
    const apiKey = env.SERPAPI_API_KEY?.trim();
    if (!apiKey) return { source: "google", titles: [], message: "Google nie jest jeszcze podlaczone: administrator musi dodac SERPAPI_API_KEY na serwerze." };
    const failure = (errorCode: string, message: string): TitleGroup => ({ source: "google", titles: [], errorCode, message });
    try {
      const url = new URL("https://serpapi.com/search.json");
      url.search = new URLSearchParams({ engine: "google", q: `${number} -site:allegro.pl`, hl: "pl", gl: "pl", api_key: apiKey }).toString();
      const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
      if (response.status === 401) return failure("invalid_key", "Google: SerpApi odrzucilo klucz (401). Administrator musi poprawic sekret SERPAPI_API_KEY w Cloudflare Production.");
      if (response.status === 403) return failure("account_denied", "Google: konto SerpApi nie ma dostepu (403). Sprawdz status konta SerpApi.");
      if (response.status === 429) return failure("quota", "Google: wyczerpany limit wyszukiwan lub limit godzinowy SerpApi (429). Sprawdz wykorzystanie w panelu SerpApi.");
      if (response.status === 400) return failure("request", "Google: SerpApi odrzucilo parametry wyszukiwania (400). Zglos blad administratorowi aplikacji.");
      if (!response.ok) return failure("provider", `Google: blad uslugi SerpApi (HTTP ${response.status}). Sprobuj ponownie pozniej.`);
      const data = await response.json() as { error?: string; search_metadata?: { status?: string }; search_information?: { organic_results_state?: string }; organic_results?: { title?: string; snippet?: string; link?: string }[] };
      // SerpApi can include an error field for a successful search with no results.
      const successful = data.search_metadata?.status === "Success";
      if (data.search_metadata?.status === "Error" || (data.error && !successful)) return failure("search", "Google: SerpApi nie wykonalo wyszukiwania. Sprawdz ostatnie zapytanie w panelu SerpApi.");
      if (!Array.isArray(data.organic_results) && !successful) return failure("response", "Google: nieprawidlowa odpowiedz SerpApi. Sprobuj ponownie pozniej.");
      const titles: Title[] = [];
      for (const item of data.organic_results || []) {
        if (typeof item.title !== "string" || typeof item.link !== "string" || !matchesTitleResult(item.title, typeof item.snippet === "string" ? item.snippet : "", number)) continue;
        try {
          const link = new URL(item.link);
          if (link.protocol !== "https:" || link.username || link.password || /(^|\.)allegro\.pl$/i.test(link.hostname)) continue;
          titles.push({ title: finishTitle(item.title.replace(/\s+[|].*$/, "")), url: link.href });
        } catch {}
      }
      const results = unique(titles);
      const emptyMessage = data.organic_results?.length
        ? `Google zwrocilo ${data.organic_results.length} wynikow, ale nie potwierdzaja pelnego numeru ${number}. Nie podpowiadamy innych koncowek.`
        : `Google nie znalazlo wynikow dla numeru ${number} poza Allegro.`;
      return { source: "google", titles: results, ...(!results.length ? { message: emptyMessage } : {}) };
    } catch (error) {
      if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) return failure("timeout", "Google: przekroczono czas oczekiwania na SerpApi (12 sekund). Sprobuj ponownie.");
      return failure("network", "Google: nie udalo sie odczytac odpowiedzi SerpApi. Sprobuj ponownie pozniej.");
    }
  };
  const result = { groups: await Promise.all([allegro(), google()]) };
  if (titleCache.size >= 200) titleCache.delete(titleCache.keys().next().value!);
  if (!result.groups.some(group => group.errorCode)) titleCache.set(cacheKey, { until: now + 300000, result });
  return result;
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
function base64url(value: Uint8Array) { return base64(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function cookie(value: string, age: number) { return `${oauthCookieName}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`; }
async function encryptionKey(env: Env) {
  if (!env.ALLEGRO_ENCRYPTION_KEY) throw new ApiError(503, "Brakuje klucza szyfrowania serwera.");
  const raw = bytes(env.ALLEGRO_ENCRYPTION_KEY);
  if (raw.length !== 32) throw new ApiError(503, "Nieprawidłowy klucz szyfrowania serwera.");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
function appConfig(env: Env, origin: string) {
  if (!env.ALLEGRO_CLIENT_ID || !env.ALLEGRO_CLIENT_SECRET || !env.ALLEGRO_REDIRECT_URI) throw new ApiError(503, "Administrator musi skonfigurować aplikację Allegro na serwerze. Użytkownik nie wpisuje kluczy.");
  if (env.ALLEGRO_REDIRECT_URI !== `${origin}/api/allegro/auth/callback` || !origin.startsWith("https://")) throw new ApiError(503, "Nieprawidłowy adres powrotu Allegro w ustawieniach serwera.");
  return { clientId: env.ALLEGRO_CLIENT_ID, clientSecret: env.ALLEGRO_CLIENT_SECRET, redirectUri: env.ALLEGRO_REDIRECT_URI };
}
function callbackPage(origin: string, ok: boolean) {
  const nonce = crypto.randomUUID();
  const message = ok ? "Konto Allegro połączone. Możesz wrócić do Wystawiacza." : "Nie udało się połączyć konta Allegro lub zgoda została anulowana. Wróć do Wystawiacza i spróbuj ponownie.";
  return new Response(`<!doctype html><html lang="pl"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Połączenie Allegro</title><body><h1>${message}</h1><a href="/panel">Wróć do Wystawiacza</a><script nonce="${nonce}">if(window.opener){window.opener.postMessage({type:"wystawiacz-allegro-complete",ok:${ok}},${JSON.stringify(origin)});}window.close();</script></body></html>`, { status: ok ? 200 : 400, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "Set-Cookie": cookie("", 0), "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'` } });
}

async function completeOAuth(request: Request, env: Env) {
  const url = new URL(request.url);
  try {
    const config = appConfig(env, url.origin);
    if (!env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing database configuration");
    const encoded = request.headers.get("Cookie")?.split(";").map(part => part.trim()).find(part => part.startsWith(`${oauthCookieName}=`))?.slice(oauthCookieName.length + 1);
    if (!encoded) throw new Error("Missing OAuth cookie");
    const key = await encryptionKey(env);
    const pending = await openConnection<OAuthCookie>(decodeURIComponent(encoded), key, "allegro-oauth");
    if (!pending.owner || pending.expiresAt <= Date.now() || pending.state !== url.searchParams.get("state") || pending.clientId !== config.clientId || pending.redirectUri !== config.redirectUri || url.searchParams.has("error")) throw new Error("Invalid OAuth state");
    const code = url.searchParams.get("code");
    if (!code) throw new Error("Missing authorization code");
    // Allegro requires client_id + verifier, not Basic authentication, for PKCE.
    const response = await fetch(`${oauthBase}/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", client_id: config.clientId, code, redirect_uri: config.redirectUri, code_verifier: pending.verifier }) });
    if (!response.ok) throw new Error("Token exchange rejected");
    const tokens = await response.json() as RemotePayload;
    if (!tokens.access_token || !tokens.refresh_token || !Number.isFinite(tokens.expires_in)) throw new Error("Invalid token response");
    const sealed = await sealConnection({ clientId: config.clientId, clientSecret: "", accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt: Date.now() + (tokens.expires_in - 60) * 1000 }, key, pending.owner);
    const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL || "https://wgshalvkjfefavnbccil.supabase.co";
    const saved = await fetch(`${supabaseUrl}/rest/v1/allegro_connections?on_conflict=owner_id`, { method: "POST", headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ owner_id: pending.owner, sealed, updated_at: new Date().toISOString() }) });
    if (!saved.ok) throw new Error("Connection save failed");
    return callbackPage(url.origin, true);
  } catch {
    return callbackPage(url.origin, false);
  }
}

export async function sealConnection(value: unknown, key: CryptoKey, owner: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: utf8.encode(owner) }, key, utf8.encode(JSON.stringify(value)));
  return `${base64(iv)}.${base64(new Uint8Array(encrypted))}`;
}
export async function openConnection<T = Connection>(value: string, key: CryptoKey, owner: string): Promise<T> {
  const [iv, encrypted] = value.split(".");
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes(iv), additionalData: utf8.encode(owner) }, key, bytes(encrypted));
  return JSON.parse(new TextDecoder().decode(decrypted));
}

export async function handleAllegroApi(request: Request, env: Env): Promise<Response> {
  if (new URL(request.url).pathname === "/api/allegro/auth/callback" && request.method === "GET") return completeOAuth(request, env);
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
    const key = await encryptionKey(env);
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
      if (!env.ALLEGRO_CLIENT_SECRET || env.ALLEGRO_CLIENT_ID !== current.clientId) throw new ApiError(409, "Połącz konto ponownie z aplikacją Tymo Garage.");
      return fetch(oauthBase + path, { method: "POST", headers: { Authorization: `Basic ${base64(utf8.encode(`${current.clientId}:${env.ALLEGRO_CLIENT_SECRET}`))}`, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(values) });
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
      if (path === "/title-suggestions") return json(await searchTitleSuggestions(url.searchParams.get("number") || "", user.id, env, remote));
      if (path === "/health") return json({ ok: true, connected: Boolean(connection?.accessToken), build: "2026-06-02.35", mode: "web" });
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
      if (path === "/auth/start") {
        const config = appConfig(env, url.origin);
        const state = base64url(crypto.getRandomValues(new Uint8Array(32)));
        const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
        const challenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", utf8.encode(verifier))));
        const pending: OAuthCookie = { owner: user.id, state, verifier, expiresAt: Date.now() + 600000, clientId: config.clientId, redirectUri: config.redirectUri };
        const authorize = new URL(`${oauthBase}/authorize`);
        authorize.search = new URLSearchParams({ response_type: "code", client_id: config.clientId, redirect_uri: config.redirectUri, state, code_challenge: challenge, code_challenge_method: "S256", prompt: "confirm", scope: scopes }).toString();
        const response = json({ url: authorize.href });
        response.headers.set("Set-Cookie", cookie(await sealConnection(pending, key, "allegro-oauth"), 600));
        return response;
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
