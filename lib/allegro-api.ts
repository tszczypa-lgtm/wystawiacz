type Env = {
  SUPABASE_SERVICE_ROLE_KEY?: string;
  ALLEGRO_ENCRYPTION_KEY?: string;
  ALLEGRO_CLIENT_ID?: string;
  ALLEGRO_CLIENT_SECRET?: string;
  ALLEGRO_REDIRECT_URI?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
  ALLEGRO_PAIRING_ENFORCED?: string;
  PUBLICATION_DEDUP_ENABLED?: string;
  OVOKO_ENCRYPTION_KEY?: string;
  INVENTORY_WITHDRAW_ENABLED?: string;
  BILLING_ENFORCED?: string;
  TRIAL_ENABLED?: string;
};
type Connection = {
  clientId: string;
  clientSecret: string;
  deviceCode?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  authorizedAsAdmin?: boolean;
  sellerId?: string;
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
  constructor(public status: number, message: string, public code?: string) { super(message); }
}
type Title = { title: string; url: string };
type TitleGroup = { source: string; titles: Title[]; message?: string; errorCode?: string };
const titleCache = new Map<string, { until: number; result: { groups: TitleGroup[] } }>();
const titleLimits = new Map<string, number[]>();
export function inventoryQuery(params: URLSearchParams) {
  const allowed = new Set(["query", "searchBy", "status", "shippingRate", "sort", "limit", "offset", "priceFrom", "priceTo"]);
  for (const name of params.keys()) if (!allowed.has(name) || params.getAll(name).length !== 1) throw new ApiError(400, "Nieprawidlowy filtr listy ofert.");
  const query = (params.get("query") || "").trim();
  const searchBy = params.get("searchBy") || "name";
  const status = params.get("status") ?? "ACTIVE";
  const shipping = params.get("shippingRate") || "";
  const sort = params.get("sort") || "";
  const limitText = params.get("limit") ?? "50";
  const offsetText = params.get("offset") ?? "0";
  const priceBound = (name: string) => {
    const text = (params.get(name) || "").trim();
    if (!text) return null;
    if (!/^\d{1,30}(?:[.,]\d{1,2})?$/.test(text)) throw new ApiError(400, "Nieprawidlowa cena filtra.");
    const [whole, fraction = ""] = text.replace(",", ".").split(".");
    const cents = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
    return { cents, amount: `${cents / BigInt(100)}.${String(cents % BigInt(100)).padStart(2, "0")}` };
  };
  const priceFrom = priceBound("priceFrom"), priceTo = priceBound("priceTo");
  if ((priceTo && priceTo.cents < BigInt(100)) || (priceFrom && priceTo && priceFrom.cents > priceTo.cents)) throw new ApiError(400, "Nieprawidlowy zakres cen.");
  if (query.length > 100 || /[\u0000-\u001f]/.test(query) || !["name", "offerId", "externalId"].includes(searchBy)
    || !["", "ACTIVE", "ENDED", "INACTIVE", "ACTIVATING"].includes(status)
    || (shipping && shipping !== "none" && !/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(shipping))
    || !["", "sellingMode.price.amount", "-sellingMode.price.amount", "stock.available", "-stock.available"].includes(sort)
    || !["20", "50", "100", "200"].includes(limitText) || !/^\d{1,7}$/.test(offsetText)) throw new ApiError(400, "Nieprawidlowe filtry lub numer strony.");
  const limit = Number(limitText), offset = Number(offsetText);
  if (offset + limit > 10000000 || (query && searchBy === "offerId" && !/^\d{1,30}$/.test(query))) throw new ApiError(400, "Nieprawidlowy numer oferty lub strony.");
  const remote = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (query) remote.set(searchBy === "offerId" ? "offer.id" : searchBy === "externalId" ? "external.id" : "name", query);
  if (status) remote.set("publication.status", status);
  if (shipping === "none") remote.set("delivery.shippingRates.id.empty", "true");
  else if (shipping) remote.set("delivery.shippingRates.id", shipping);
  if (sort) remote.set("sort", sort);
  if (priceFrom) remote.set("sellingMode.price.amount.gte", priceFrom.amount);
  if (priceTo) remote.set("sellingMode.price.amount.lte", priceTo.amount);
  return { remote, limit, offset };
}
export async function searchTitleSuggestions(number: string, owner: string, _env: Env, remote: (path: string, options?: RequestInit) => Promise<RemotePayload>) {
  if (!/^[A-Z0-9]{6,32}$/.test(number) || !/\d/.test(number)) throw new ApiError(400, "Wpisz poprawny, pelny numer czesci.");
  const now = Date.now();
  const cacheKey = `${owner}:${number}`;
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
  let group: TitleGroup;
  try {
    const data = await remote(`/sale/products?phrase=${encodeURIComponent(number)}&mode=MPN&language=pl-PL`, { signal: AbortSignal.timeout(10000) });
    const products = Array.isArray(data.products) ? data.products as { name?: string }[] : [];
    const seen = new Set<string>();
    const titles: Title[] = [];
    for (const product of products) {
      if (typeof product.name !== "string") continue;
      const title = finishTitle(product.name);
      const key = title.toLowerCase();
      if (!title || seen.has(key)) continue;
      seen.add(key);
      titles.push({ title, url: `https://allegro.pl/listing?string=${encodeURIComponent(number)}` });
      if (titles.length === 4) break;
    }
    group = { source: "allegro", titles, ...(!titles.length ? { message: "Brak produktu z tym numerem w katalogu Allegro." } : titles.length < 4 ? { message: `Katalog Allegro zwrocil ${titles.length} rozne propozycje. Nie dopisujemy brakujacych wynikow.` } : {}) };
  } catch {
    group = { source: "allegro", titles: [], errorCode: "allegro", message: "Nie udalo sie pobrac katalogu Allegro. Sprawdz polaczenie konta." };
  }
  const result = { groups: [group] };
  if (titleCache.size >= 200) titleCache.delete(titleCache.keys().next().value!);
  if (!group.errorCode) titleCache.set(cacheKey, { until: now + 300000, result });
  return result;
}
const apiBase = "https://api.allegro.pl";
export async function readOvokoFitment(offer: Record<string, any>, number: string, remote: (path: string) => Promise<Record<string, any>>, expand = false) {
  const rows: { text: string; origin: string }[] = [], names: string[] = [];
  const seen = new Set<string>();
  function append(value: unknown, origin: string) {
    if (value == null) return;
    if (typeof value !== "object" || Array.isArray(value)) throw new ApiError(502, "Nieprawidlowa lista Pasuje do.");
    const items = (value as Record<string, unknown>).items;
    if (!Array.isArray(items) || items.length > 2000) throw new ApiError(502, "Niepelna lista Pasuje do.");
    for (const item of items) {
      if (!item || typeof item !== "object") throw new ApiError(502, "Nieprawidlowy wpis Pasuje do.");
      if (item.text === undefined && item.type === "ID") continue;
      if (typeof item.text !== "string" || item.text.length > 2000) throw new ApiError(502, "Nieprawidlowy opis modelu Pasuje do.");
      const text = item.text.trim();
      if (text && !seen.has(text) && rows.length < 200) { seen.add(text); rows.push({ text, origin }); }
      else if (text && origin.startsWith("catalog")) {
        const existing = rows.find(row => row.text === text);
        if (existing && !existing.origin.startsWith("catalog")) existing.origin = origin;
      }
    }
  }
  append(offer.compatibilityList, "offer");
  if (!rows.length) append(await remote(`/sale/compatibility-list-suggestions?offer.id=${encodeURIComponent(offer.id)}&language=pl-PL`), "suggestion");
  // Read only exact, complete manufacturer codes; never accept a shortened index or a title in MPN.
  const compact = (value: string) => value.toUpperCase().replace(/[ .-]/g, "");
  if (number && (expand || !rows.length)) {
    const visited = new Set<string>();
    let accepted = 0;
    for (const mode of ["&mode=MPN", ""]) {
      if (visited.size >= 6 || (mode === "" && accepted)) break;
      const search = await remote(`/sale/products?phrase=${encodeURIComponent(number)}${mode}&language=pl-PL`);
      if (!Array.isArray(search.products) || search.products.length > 30) throw new ApiError(502, "Nieprawidlowy wynik katalogu MPN.");
      const products = search.products.filter((row: any) => typeof row?.id === "string" && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(row.id) && !visited.has(row.id)).slice(0, 6 - visited.size);
      for (const entry of products) {
        if (visited.has(entry.id)) continue;
        visited.add(entry.id);
        const product = await remote(`/sale/products/${entry.id}?language=pl-PL`);
        if (product.id !== entry.id || !Array.isArray(product.parameters) || product.parameters.length > 500) throw new ApiError(502, "Niepelne dane produktu MPN.");
        const exact = product.parameters.some((row: any) => typeof row?.name === "string" && /^(numer katalogowy cz[eę][sś]ci|kod producenta|manufacturer code|numer oe)$/i.test(row.name.trim()) && Array.isArray(row.values) && row.values.some((value: unknown) => typeof value === "string" && compact(value) === number));
        const sameCategory = offer.category?.id && (product.category?.id === offer.category.id || (Array.isArray(product.category?.similar) && product.category.similar.some((row: any) => row?.id === offer.category.id)));
        if (!exact || !sameCategory) continue;
        accepted++;
        if (typeof product.name === "string" && product.name.length <= 500) names.push(product.name);
        // A catalogue product can identify the car in parameters even without a compatibility list.
        const vehicleValues = (pattern: RegExp): string[] => product.parameters.filter((row: any) => typeof row?.name === "string" && pattern.test(row.name.trim()) && Array.isArray(row.values)).flatMap((row: any) => row.values.filter((value: unknown) => typeof value === "string" && value.trim() && value.length <= 100)).slice(0, 5);
        const makes = vehicleValues(/^(marka pojazdu|marka samochodu|marka auta|producent pojazdu)$/i);
        const models = vehicleValues(/^(model pojazdu|model samochodu|model auta)$/i);
        for (const make of makes) for (const model of models) if (names.length < 40) names.push(`${make} ${model}`);
        const before = rows.length;
        append(product.compatibilityList, "catalog");
        if (rows.length === before) append(await remote(`/sale/compatibility-list-suggestions?product.id=${entry.id}&language=pl-PL`), "catalog-suggestion");
        if (!expand && rows.length) break;
      }
      if (!expand && rows.length) break;
    }
  }
  return { rows, names };
}
const oauthBase = "https://allegro.pl/auth/oauth";
const accept = "application/vnd.allegro.public.v1+json";
const scopes = "allegro:api:profile:read allegro:api:sale:offers:read allegro:api:sale:offers:write allegro:api:sale:settings:read allegro:api:sale:settings:write allegro:api:orders:read";
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
async function activeAllegroAdmin(owner: string, env: Env) {
  const base = env.NEXT_PUBLIC_SUPABASE_URL || "https://wgshalvkjfefavnbccil.supabase.co";
  const headers = { apikey: env.SUPABASE_SERVICE_ROLE_KEY!, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };
  async function read(table: string, select: string) {
    const query = new URLSearchParams({ owner_id: `eq.${owner}`, select, limit: "1" });
    const response = await fetch(`${base}/rest/v1/${table}?${query}`, { headers, signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new ApiError(503, "Nie udalo sie sprawdzic uprawnien administratora Allegro.");
    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length > 1) throw new ApiError(503, "Nieprawidlowa odpowiedz uprawnien administratora.");
    return rows;
  }
  const roles = await read("account_admins", "owner_id");
  if (!roles.length) return false;
  if (roles[0]?.owner_id !== owner) throw new ApiError(503, "Nieprawidlowa odpowiedz uprawnien administratora.");
  const profiles = await read("customer_accounts", "owner_id,suspended");
  return profiles.length === 1 && profiles[0]?.owner_id === owner && profiles[0]?.suspended === false;
}
function callbackPage(origin: string, ok: boolean, code = "") {
  const nonce = crypto.randomUUID();
  const message = ok ? "Konto Allegro połączone. Możesz wrócić do Wystawiacza." : code === "seller_not_allowed" ? "To konto Allegro nie jest dozwolone dla tej firmy. Administrator musi zatwierdzic drugie konto lub zmiane. Dotychczasowe polaczenie pozostalo bez zmian." : `Nie potwierdzono polaczenia konta Allegro. Kod diagnostyczny: ${code}. Odswiez status polaczenia. Nie zmieniono ofert.`;
  return new Response(`<!doctype html><html lang="pl"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Połączenie Allegro</title><body><h1>${message}</h1><a href="/panel/allegro">Wróć do połączenia Allegro</a><script nonce="${nonce}">history.replaceState(null,"","/api/allegro/auth/callback");if(window.opener){window.opener.postMessage({type:"wystawiacz-allegro-complete",ok:${ok},code:${JSON.stringify(code)}},${JSON.stringify(origin)});}${ok ? "window.close();" : ""}</script></body></html>`, { status: ok ? 200 : 400, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "Set-Cookie": cookie("", 0), "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'` } });
}

async function completeOAuth(request: Request, env: Env) {
  const url = new URL(request.url);
  let failureCode = "oauth_configuration";
  try {
    const config = appConfig(env, url.origin);
    failureCode = "oauth_database_config";
    if (!env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing database configuration");
    failureCode = "oauth_cookie_missing";
    const encoded = request.headers.get("Cookie")?.split(";").map(part => part.trim()).find(part => part.startsWith(`${oauthCookieName}=`))?.slice(oauthCookieName.length + 1);
    if (!encoded) throw new Error("Missing OAuth cookie");
    failureCode = "oauth_encryption";
    const key = await encryptionKey(env);
    failureCode = "oauth_cookie_invalid";
    const pending = await openConnection<OAuthCookie>(decodeURIComponent(encoded), key, "allegro-oauth");
    failureCode = "oauth_session_invalid";
    if (!pending.owner || pending.expiresAt <= Date.now() || pending.state !== url.searchParams.get("state") || pending.clientId !== config.clientId || pending.redirectUri !== config.redirectUri) throw new Error("Invalid OAuth state");
    if (url.searchParams.has("error")) {
      const authorizationErrors: Record<string, string> = { access_denied: "oauth_access_denied", invalid_scope: "oauth_invalid_scope", invalid_request: "oauth_authorize_invalid_request", unauthorized_client: "oauth_authorize_unauthorized_client", unsupported_response_type: "oauth_unsupported_response_type", server_error: "oauth_authorize_server_error", temporarily_unavailable: "oauth_authorize_unavailable" };
      failureCode = authorizationErrors[url.searchParams.get("error") || ""] || "oauth_denied";
      throw new Error("Authorization not granted");
    }
    failureCode = "oauth_code_missing";
    const code = url.searchParams.get("code");
    if (!code) throw new Error("Missing authorization code");
    failureCode = "oauth_token_unavailable";
    // Allegro requires client_id + verifier, not Basic authentication, for PKCE.
    const response = await fetch(`${oauthBase}/token`, { method: "POST", redirect: "manual", signal: AbortSignal.timeout(15000), headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", client_id: config.clientId, code, redirect_uri: config.redirectUri, code_verifier: pending.verifier }) });
    if (!response.ok) {
      failureCode = "oauth_token_rejected";
      const rejection = await response.json().catch(() => null) as { error?: unknown } | null;
      if (rejection?.error === "invalid_grant") failureCode = "oauth_invalid_grant";
      if (rejection?.error === "invalid_client" || rejection?.error === "unauthorized_client") failureCode = "oauth_invalid_client";
      if (rejection?.error === "invalid_request") failureCode = "oauth_invalid_request";
      throw new Error("Token exchange rejected");
    }
    failureCode = "oauth_token_response";
    const tokens = await response.json() as RemotePayload;
    if (!tokens.access_token || !tokens.refresh_token || !Number.isFinite(tokens.expires_in)) throw new Error("Invalid token response");
    const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL || "https://wgshalvkjfefavnbccil.supabase.co";
    let authorizedAsAdmin = false, sellerId: string | undefined;
    if (env.ALLEGRO_PAIRING_ENFORCED === "true") {
      failureCode = "oauth_seller_read";
      const sellerResponse = await fetch(`${apiBase}/me`, { headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: accept } });
      if (!sellerResponse.ok) throw new Error("Seller verification failed");
      const seller = await sellerResponse.json() as { id: string };
      if (!/^\d+$/.test(seller.id)) throw new Error("Invalid seller");
      failureCode = "oauth_admin_check";
      authorizedAsAdmin = await activeAllegroAdmin(pending.owner, env);
      if (authorizedAsAdmin) {
        sellerId = seller.id;
        failureCode = "oauth_admin_audit";
        // Records an authorized attempt before saving; never transfers an existing seller binding.
        const audit = await fetch(`${supabaseUrl}/rest/v1/account_audit`, { method: "POST", headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify({ actor_id: pending.owner, target_id: pending.owner, action: "allegro_admin_oauth", reason: `Zatwierdzono administracyjna autoryzacje Allegro ${seller.id} przed zapisem polaczenia. Bez przenoszenia przypisan uzytkownikow.` }) });
        if (!audit.ok) throw new Error("Admin authorization audit failed");
      } else {
        failureCode = "oauth_seller_binding";
        const claim = await fetch(`${supabaseUrl}/rest/v1/rpc/claim_allegro_seller`, { method: "POST", headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ p_owner: pending.owner, p_seller: seller.id }) });
        if (!claim.ok) throw new Error("Binding database unavailable");
        if (await claim.json() !== true) { failureCode = "seller_not_allowed"; throw new Error("Seller not permitted"); }
      }
    }
    failureCode = "oauth_encryption";
    const sealed = await sealConnection({ clientId: config.clientId, clientSecret: "", accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt: Date.now() + (tokens.expires_in - 60) * 1000, ...(authorizedAsAdmin ? { authorizedAsAdmin: true, sellerId } : {}) }, key, pending.owner);
    failureCode = "oauth_connection_save";
    const saved = await fetch(`${supabaseUrl}/rest/v1/allegro_connections?on_conflict=owner_id`, { method: "POST", headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ owner_id: pending.owner, sealed, updated_at: new Date().toISOString() }) });
    if (!saved.ok) throw new Error("Connection save failed");
    return callbackPage(url.origin, true);
  } catch {
    return callbackPage(url.origin, false, failureCode);
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
  const coordination = new URL(request.url).pathname === "/api/allegro/coordination-snapshot";
  let coordinationStage = "session";
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
    coordinationStage = "connection";
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
    let adminValidation: Promise<void> | null = null;
    async function validateAdminConnection() {
      if (connection?.authorizedAsAdmin !== true) return;
      if (!adminValidation) adminValidation = (async () => {
        if (!/^\d+$/.test(connection?.sellerId || "") || !await activeAllegroAdmin(user.id, env)) throw new ApiError(403, "To polaczenie Allegro wymaga aktywnych uprawnien administratora. Polacz konto ponownie zgodnie z uprawnieniami. Nie zmieniono ofert.");
      })();
      await adminValidation;
    }
    async function save(value: Connection) {
      await db("?on_conflict=owner_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ owner_id: user.id, sealed: await sealConnection(value, key, user.id), updated_at: new Date().toISOString() }) });
      connection = value;
    }
    async function readRemote(response: Response) {
      const payload = await response.json().catch(() => ({})) as RemotePayload;
      if (!response.ok) {
        const message = payload.errors?.map((error: { userMessage?: string; message?: string }) => error.userMessage || error.message).join("; ") || payload.error_description || payload.error || "Allegro odrzuciło żądanie.";
        if (response.status === 429) {
          const wait = response.headers.get("Retry-After");
          throw new ApiError(429, `${message} Limit Allegro (HTTP 429).${wait && /^\d+$/.test(wait) ? ` Sprobuj po ${wait} sekundach.` : " Poczekaj przed kolejna proba."}`);
        }
        throw new ApiError(response.status >= 500 ? 502 : 400, message);
      }
      return payload;
    }
    async function oauth(path: string, values: Record<string, string>, current: Connection) {
      if (!env.ALLEGRO_CLIENT_SECRET || env.ALLEGRO_CLIENT_ID !== current.clientId) throw new ApiError(409, "Połącz konto ponownie z aplikacją Tymo Garage.");
      return fetch(oauthBase + path, { method: "POST", headers: { Authorization: `Basic ${base64(utf8.encode(`${current.clientId}:${env.ALLEGRO_CLIENT_SECRET}`))}`, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(values) });
    }
    async function accessToken() {
      await validateAdminConnection();
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
    async function workspaceDb(path: string, options: RequestInit = {}) {
      const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, { ...options, headers: { ...dbHeaders, ...options.headers } });
      if (!response.ok) throw new ApiError(503, "Nie udalo sie odczytac rejestru publikacji. Sprawdz migracje 004.");
      return response.status === 204 ? null : response.json();
    }
    async function body() {
      if (Number(request.headers.get("Content-Length")) > 20 * 1024 * 1024) throw new ApiError(413, "Plik jest zbyt duży (maksimum 20 MB).");
      const text = await request.text();
      if (utf8.encode(text).length > 20 * 1024 * 1024) throw new ApiError(413, "Plik jest zbyt duży (maksimum 20 MB).");
      try { return JSON.parse(text); } catch { throw new ApiError(400, "Nieprawidłowe dane żądania."); }
    }
    const url = new URL(request.url);
    const path = url.pathname.slice("/api/allegro".length);
    if (path === "/inventory" && request.method !== "GET") return json({ message: "Lista ofert jest tylko do odczytu." }, 405);
    if (path === "/year-offers" && request.method !== "GET") return json({ message: "Podpowiedzi roku sa tylko do odczytu." }, 405);
    if (path.startsWith("/ovoko-fitment/") && request.method !== "GET") return json({ message: "Dopasowanie jest tylko do odczytu." }, 405);
    if (request.method === "GET") {
      if (path === "/year-offers") {
        const number = url.searchParams.get("number") || "";
        if (!/^[A-Z0-9]{6,32}$/.test(number) || !/\d/.test(number) || [...url.searchParams.keys()].some(k => k !== "number") || url.searchParams.getAll("number").length !== 1) throw new ApiError(400, "Podaj pelny numer czesci.");
        return json(await remote(`/sale/offers?name=${encodeURIComponent(number)}&limit=5`, { signal: AbortSignal.timeout(10000) }));
      }
      if (path === "/coordination-snapshot") {
        const ids = (url.searchParams.get("offerIds") || "").split(",");
        if (ids.length > 5 || new Set(ids).size !== ids.length || ids.some(id => !/^\d{1,30}$/.test(id)) || [...url.searchParams.keys()].some(key => key !== "offerIds") || url.searchParams.getAll("offerIds").length !== 1) throw new ApiError(400, "Wybierz od 1 do 5 ofert do kontroli koordynacji.");
        coordinationStage = "token";
        const token = await accessToken();
        async function coordinationRead(route: string, stage: string) {
          coordinationStage = stage;
          const response = await fetch(apiBase + route, { headers: { Authorization: `Bearer ${token}`, Accept: accept, "Accept-Language": "pl-PL" }, signal: AbortSignal.timeout(15000) });
          if (!response.ok) {
            await response.body?.cancel();
            const hint = response.status === 403 ? " Allegro odmowilo dostepu. Sprawdz uprawnienia aplikacji do tego odczytu." : response.status === 401 ? " Allegro odrzucilo token. Odnow autoryzacje." : response.status === 429 ? " Limit Allegro; odczekaj przed ponowieniem kontroli." : " Ponow kontrole pozniej.";
            throw new ApiError(response.status >= 500 ? 502 : response.status, `Kontrola Allegro: ${stage === "seller" ? "konto sprzedawcy" : stage === "offers" ? "lista ofert" : "zdarzenia zamowien"}, HTTP ${response.status}.${hint} Niczego nie wycofano.`, `coordination_${stage}_http_${response.status}`);
          }
          try {
            const payload = await response.json();
            if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error();
            return payload as Record<string, unknown>;
          } catch { throw new ApiError(502, "Nieprawidlowy format odpowiedzi Allegro. Niczego nie wycofano.", `coordination_${stage}_json`); }
        }
        const seller = await coordinationRead("/me", "seller");
        if (typeof seller.id !== "string" || !/^\d{1,30}$/.test(seller.id)) throw new ApiError(502, "Nie potwierdzono sprzedawcy Allegro.");
        const offers: { id: string; name: string; status: string; stock: number | null }[] = [];
        for (const id of ids) {
          const owned = await coordinationRead(`/sale/offers?offer.id=${id}&limit=1`, "offers");
          if (!Array.isArray(owned.offers)) throw new ApiError(502, "Nieprawidlowy format listy ofert Allegro. Niczego nie wycofano.", "coordination_offers_format");
          if (owned.offers.length !== 1 || owned.offers[0]?.id !== id) throw new ApiError(409, `Oferta ${id} nie zostala odnaleziona na aktualnie polaczonym koncie Allegro. Odswiez liste i sprawdz konto sprzedawcy. Niczego nie wycofano.`, "coordination_offer_ownership");
          const row = owned.offers[0];
          offers.push({ id, name: typeof row.name === "string" ? row.name : "", status: typeof row.publication?.status === "string" ? row.publication.status : "UNKNOWN", stock: Number.isSafeInteger(row.stock?.available) && row.stock.available >= 0 ? row.stock.available : null });
        }
        const events = await coordinationRead("/order/events?limit=1000", "events");
        coordinationStage = "parser";
        const { allegroSaleEvidence } = await import("./allegro-sale-evidence");
        if (typeof allegroSaleEvidence !== "function") throw new ApiError(503, "Parser zdarzen Allegro nie jest dostepny w pakiecie serwera. To blad aplikacji, nie uprawnien konta. Niczego nie wycofano.", "coordination_parser_unavailable");
        coordinationStage = "events_format";
        let evidence;
        try { evidence = allegroSaleEvidence(events, seller.id); } catch { throw new ApiError(502, "Odczyt zdarzen Allegro powiodl sie, ale ich format lub konto sprzedawcy nie przeszly weryfikacji. Ponowne logowanie nie naprawia bledu formatu. Niczego nie wycofano.", "coordination_events_format"); }
        return json({ sellerId: seller.id, offers, evidence: evidence.filter(item => ids.includes(item.listingId)), eventsRead: Array.isArray(events.events) ? events.events.length : 0, partial: Array.isArray(events.events) && events.events.length === 1000 });
      }
      if (path.startsWith("/ovoko-fitment/")) {
        const id = path.slice("/ovoko-fitment/".length), number = url.searchParams.get("number") || "";
        if (!/^\d{1,30}$/.test(id) || (url.searchParams.has("number") && (!/^[A-Z0-9]{6,32}$/.test(number) || !/\d/.test(number))) || [...url.searchParams.keys()].some(key => !["number", "expand"].includes(key)) || url.searchParams.getAll("number").length > 1 || url.searchParams.getAll("expand").length > 1 || (url.searchParams.has("expand") && url.searchParams.get("expand") !== "1")) throw new ApiError(400, "Nieprawidlowy numer oferty lub pelny numer czesci.");
        const owned = await remote(`/sale/offers?offer.id=${id}&limit=1`, { signal: AbortSignal.timeout(10000) });
        if (!Array.isArray(owned.offers) || !owned.offers.some((row: any) => row.id === id)) throw new ApiError(404, "Oferta nie nalezy do polaczonego konta.");
        const offer = await remote(`/sale/product-offers/${id}`, { signal: AbortSignal.timeout(10000) });
        if (offer.id !== id) throw new ApiError(502, "Niepotwierdzona oferta dopasowania.");
        const optional = async (route: string) => {
          const response = await fetch(apiBase + route, { headers: { Authorization: `Bearer ${await accessToken()}`, Accept: accept, "Accept-Language": "pl-PL" }, signal: AbortSignal.timeout(10000) });
          if (response.status === 404 || response.status === 422) { await response.body?.cancel(); return route.includes("/sale/products?") ? { products: [] } : { items: [] }; }
          return readRemote(response);
        };
        return json({ offerId: id, number, ...await readOvokoFitment(offer, number, optional, url.searchParams.get("expand") === "1") });
      }
      if (path === "/seller-identity") {
        const seller = await remote("/me", { signal: AbortSignal.timeout(15000) });
        if (typeof seller.id !== "string" || !/^\d{1,30}$/.test(seller.id)) throw new ApiError(502, "Niepotwierdzony sprzedawca Allegro.");
        return json({ sellerId: seller.id });
      }
      if (path === "/inventory") {
        const { remote: query, limit, offset } = inventoryQuery(url.searchParams);
        // Seller identity comes exclusively from this user's encrypted connection, never query parameters.
        const data = await remote(`/sale/offers?${query}`, { signal: AbortSignal.timeout(15000) });
        if (!Array.isArray(data.offers) || data.offers.length > limit || !Number.isSafeInteger(data.totalCount) || Number(data.totalCount) < 0) throw new ApiError(502, "Allegro zwrocilo niepelna liste. Sprobuj ponownie; nie zmieniono zadnej oferty.");
        type Item = { id?: string; name?: string; primaryImage?: { url?: string }; external?: { id?: string }; publication?: { status?: string }; stock?: { available?: number; sold?: number }; delivery?: { shippingRates?: { id?: string } }; sellingMode?: { price?: { amount?: string; currency?: string } } };
        const offers = (data.offers as Item[]).map(item => {
          if (!item || typeof item.id !== "string" || !/^\d{1,30}$/.test(item.id)) throw new ApiError(502, "Allegro zwrocilo nieprawidlowe dane oferty.");
          let image = "";
          try { const url = new URL(item.primaryImage?.url || ""); if (url.protocol === "https:" && url.hostname.endsWith(".allegroimg.com")) image = url.href; } catch {}
          const price = item.sellingMode?.price;
          return { id: item.id, name: typeof item.name === "string" ? item.name : "", image,
            externalId: typeof item.external?.id === "string" ? item.external.id : "",
            status: item.publication?.status || "UNKNOWN", stock: Number.isSafeInteger(item.stock?.available) && Number(item.stock?.available) >= 0 ? item.stock!.available : null,
            sold: Number.isSafeInteger(item.stock?.sold) && Number(item.stock?.sold) >= 0 ? item.stock!.sold : null,
            shippingRateId: typeof item.delivery?.shippingRates?.id === "string" ? item.delivery.shippingRates.id : null,
            price: price && typeof price.amount === "string" && /^\d+(?:\.\d+)?$/.test(price.amount) && /^[A-Z]{3}$/.test(price.currency || "") ? { amount: price.amount, currency: price.currency } : null };
        });
        return json({ offers, totalCount: data.totalCount, count: offers.length, limit, offset, fetchedAt: new Date().toISOString() });
      }
      if (path === "/own-offers") {
        const number = url.searchParams.get("number") || "";
        if (!/^[A-Z0-9 .\/-]{3,40}$/i.test(number) || !/\d/.test(number)) throw new ApiError(400, "Wpisz numer czesci.");
        return json(await remote(`/sale/offers?name=${encodeURIComponent(number)}&publication.status=ACTIVE&limit=100`));
      }
      if (path.startsWith("/own-offers/") || path.startsWith("/ovoko-source/")) {
        const forOvoko = path.startsWith("/ovoko-source/");
        const id = path.slice((forOvoko ? "/ovoko-source/" : "/own-offers/").length);
        if (!/^\d+$/.test(id)) throw new ApiError(400, "Nieprawidlowa oferta.");
        // /sale/offers is restricted to the authenticated seller's assortment.
        const owned = await remote(`/sale/offers?offer.id=${id}&limit=1`);
        if (!Array.isArray(owned.offers) || !owned.offers.some((item: { id: string }) => item.id === id)) throw new ApiError(404, "Oferta nie nalezy do polaczonego konta.");
        const offer = await remote(`/sale/product-offers/${id}`);
        if (forOvoko) {
          const seller = await remote("/me");
          if (!/^\d{1,30}$/.test(seller.id)) throw new ApiError(502, "Niepotwierdzony sprzedawca Allegro.");
          return json({ offer, sellerId: seller.id });
        }
        return json(offer);
      }
      if (path === "/catalog-products") {
        const number = url.searchParams.get("number") || "";
        if (!/^[A-Z0-9 .\/-]{6,40}$/i.test(number) || !/\d/.test(number)) throw new ApiError(400, "Wpisz pelny numer czesci.");
        return json(await remote(`/sale/products?phrase=${encodeURIComponent(number)}&mode=MPN&language=pl-PL`));
      }
      if (path.startsWith("/catalog-products/")) {
        const id = path.slice("/catalog-products/".length);
        if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id)) throw new ApiError(400, "Nieprawidlowy produkt katalogowy.");
        return json(await remote(`/sale/products/${id}?language=pl-PL`));
      }
      if (path === "/title-suggestions") return json(await searchTitleSuggestions(url.searchParams.get("number") || "", user.id, env, remote));
      if (path === "/shipping-rates") {
        const seller = await remote("/me");
        return json(await remote(`/sale/shipping-rates?seller.id=${encodeURIComponent(seller.id)}`));
      }
      if (path === "/health") { await validateAdminConnection(); return json({ ok: true, connected: Boolean(connection?.accessToken), adminMode: connection?.authorizedAsAdmin === true, build: "2026-06-02.35", mode: "web" }); }
      const routes: Record<string, string> = { "/me": "/me", "/responsible-producers": "/sale/responsible-producers", "/responsible-persons": "/sale/responsible-persons" };
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
      if (path === "/inventory-withdrawal") {
        if (request.headers.get("Origin") !== url.origin || request.headers.get("Content-Type")?.split(";")[0].trim() !== "application/json") throw new ApiError(403, "Nieprawidlowe zrodlo lub format wycofania.");
        const { inventoryWithdrawalAccess } = await import("./inventory-withdrawal-access");
        if (!await inventoryWithdrawalAccess(request, env, user.id)) throw new ApiError(403, "Brak aktywnego dostepu do wycofywania.");
        if (Number(request.headers.get("Content-Length")) > 8192) throw new ApiError(413, "Zbyt duzy formularz.");
        const raw = await request.text(); if (utf8.encode(raw).length > 8192) throw new ApiError(413, "Zbyt duzy formularz.");
        let input: unknown; try { input = JSON.parse(raw); } catch { throw new ApiError(400, "Nieprawidlowy formularz wycofania."); }
        if (!input || typeof input !== "object" || Array.isArray(input)) throw new ApiError(400, "Nieprawidlowy formularz wycofania.");
        const { manageWithdrawal, WithdrawalError } = await import("./inventory-withdrawal");
        try { return json(await manageWithdrawal(input as Record<string, unknown>, user.id, env, workspaceDb, remote)); }
        catch (error) { if (error instanceof WithdrawalError) throw new ApiError(error.status, error.message); throw new ApiError(503, "Nie potwierdzono wycofania. Sprawdz portale; nie ponawiaj niepewnej operacji."); }
      }
      if (path === "/auth/logout") {
        await db(`?owner_id=eq.${encodeURIComponent(user.id)}`, { method: "DELETE" });
        return json({ connected: false });
      }
      if (path === "/auth/start") {
        const config = appConfig(env, url.origin);
        if (env.ALLEGRO_PAIRING_ENFORCED === "true" && connection?.accessToken && connection.authorizedAsAdmin !== true) {
          if (!await activeAllegroAdmin(user.id, env)) {
            const currentSeller = await remote("/me");
            const allowed = await workspaceDb("rpc/claim_allegro_seller", { method: "POST", body: JSON.stringify({ p_owner: user.id, p_seller: currentSeller.id }) });
            if (allowed !== true) throw new ApiError(409, "Obecne konto Allegro wymaga zatwierdzenia przez administratora.");
          }
        }
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
        let contentType = request.headers.get("Content-Type")?.split(";")[0].trim() || "";
        let image: Uint8Array | ArrayBuffer;
        if (["image/jpeg", "image/png", "image/webp"].includes(contentType)) {
          // Native binary transfer avoids parsing and decoding megabytes of base64 on the Worker.
          if (Number(request.headers.get("Content-Length")) > 20 * 1024 * 1024) throw new ApiError(413, "Zdjecie jest zbyt duze (maksimum 20 MB).");
          image = await request.arrayBuffer();
        } else {
          // Support older tabs during deployment; new clients send the image itself.
          const input = await body();
          contentType = input.image?.contentType || "image/jpeg";
          if (!input.image?.base64 || !["image/jpeg", "image/png", "image/webp"].includes(contentType)) throw new ApiError(400, "Nieprawidłowe zdjęcie.");
          image = bytes(input.image.base64).buffer as ArrayBuffer;
        }
        if (!image.byteLength || image.byteLength > 20 * 1024 * 1024) throw new ApiError(413, "Nieprawidlowy rozmiar zdjecia (maksimum 20 MB).");
        return json(await readRemote(await fetch("https://upload.allegro.pl/sale/images", { method: "POST", headers: { Authorization: `Bearer ${await accessToken()}`, Accept: accept, "Content-Type": contentType }, body: image })));
      }
      if (path === "/product-offers") {
        const input = await body();
        const offer = input.offerBase64 ? JSON.parse(new TextDecoder().decode(bytes(input.offerBase64))) : input.offer;
        if (!offer || typeof offer !== "object" || Array.isArray(offer)) throw new ApiError(400, "Brakuje danych oferty.");
        if (env.PUBLICATION_DEDUP_ENABLED !== "true") return json(await remote("/sale/product-offers", { method: "POST", headers: { "Content-Type": accept }, body: JSON.stringify(offer) }));
        if (!/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(input.productId || "")) throw new ApiError(400, "Brakuje identyfikatora publikacji. Odswiez strone.");
        const seller = await remote("/me");
        const ledgerPath = `listing_publications?owner_id=eq.${user.id}&product_id=eq.${input.productId}`;
        const claim = await workspaceDb("rpc/claim_listing_publication", { method: "POST", body: JSON.stringify({ p_owner: user.id, p_product: input.productId, p_seller: seller.id }) }) as { claimed: boolean; id?: string; seller?: string };
        const publicationReference = `wystawiacz-${input.productId}`;
        if (!claim.claimed) {
          if (claim.id) return json({ id: claim.id, alreadyPublished: true });
          if (claim.seller === seller.id) {
            const found = await remote(`/sale/offers?external.id=${publicationReference}&limit=2`);
            if (Array.isArray(found.offers) && found.offers.length === 1 && /^\d+$/.test(found.offers[0].id)) {
              await workspaceDb(ledgerPath, { method: "PATCH", body: JSON.stringify({ status: "done", offer_id: found.offers[0].id }) });
              return json({ id: found.offers[0].id, alreadyPublished: true });
            }
          }
          throw new ApiError(409, "Publikacja trwa lub jej wynik jest niepewny. Sprawdz asortyment Allegro; nie ponawiamy tworzenia oferty.");
        }
        offer.external = { id: publicationReference };
        try {
          const result = await remote("/sale/product-offers", { method: "POST", headers: { "Content-Type": accept }, body: JSON.stringify(offer) });
          if (!result.id) throw new Error("Missing offer id");
          await workspaceDb(ledgerPath, { method: "PATCH", body: JSON.stringify({ status: "done", offer_id: result.id }) });
          return json(result);
        } catch (error) {
          // Only a definite client-side rejection permits another attempt. Network/5xx
          // failures retain the claim because Allegro might have accepted the offer.
          if (error instanceof ApiError && [400, 429].includes(error.status)) await workspaceDb(ledgerPath, { method: "DELETE" });
          throw error;
        }
      }
    }
    return json({ message: "Nieznana trasa API." }, 404);
  } catch (error) {
    if (coordination) {
      const status = error instanceof ApiError ? error.status : 503;
      const code = error instanceof ApiError && error.code ? error.code : `coordination_${coordinationStage}_${status}`;
      const labels: Record<string, string> = { session: "sesja Wystawiacza", connection: "odczyt polaczenia Allegro", token: "odnowienie tokenu Allegro", seller: "konto sprzedawcy", offers: "lista ofert", events: "zdarzenia zamowien", parser: "zaladowanie parsera aplikacji", events_format: "weryfikacja zdarzen zamowien" };
      const message = error instanceof ApiError && error.code ? error.message : `Nie zakonczono kontroli Allegro: ${labels[coordinationStage] || "odczyt danych"} (HTTP ${status}). ${coordinationStage === "session" && status === 401 ? "Zaloguj sie do Wystawiacza." : coordinationStage === "token" && [400, 401, 409].includes(status) ? "Sprawdz polaczenie Allegro i odnow autoryzacje." : "Ponow sam odczyt; nie rozlaczaj konta ani ofert."} Niczego nie wycofano.`;
      return json({ message, code }, status);
    }
    return json({ message: error instanceof ApiError ? error.message : "Błąd obsługi Allegro. Sprawdź konfigurację serwera i spróbuj ponownie." }, error instanceof ApiError ? error.status : 500);
  }
}
