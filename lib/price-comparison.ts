type Site = "Allegro" | "Ovoko" | "Otomoto" | "OLX";
type Offer = { title: string; url: string; amount: number; currency: "PLN" };
type Result = { source: Site; status: "ok" | "blocked" | "empty" | "unavailable"; checkedAt: string; count: number; lowest?: Offer; message: string };
const cache = new Map<string, { until: number; result: Result[] }>();
const limits = new Map<string, number[]>();
const hosts: Record<Site, string> = { Allegro: "allegro.pl", Ovoko: "ovoko.pl", Otomoto: "otomoto.pl", OLX: "olx.pl" };
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function priceSearchUrl(source: Site, number: string) {
  if (source === "Allegro") return `https://allegro.pl/listing?string=${encodeURIComponent(number)}&order=p`;
  if (source === "Ovoko") return `https://ovoko.pl/szukaj?q=${encodeURIComponent(number)}&exact=1`;
  if (source === "Otomoto") return `https://www.otomoto.pl/czesci/q-${encodeURIComponent(number)}?search%5Border%5D=filter_float_price%3Aasc`;
  return `https://www.olx.pl/motoryzacja/czesci-samochodowe/q-${encodeURIComponent(number)}/?search%5Border%5D=filter_float_price%3Aasc`;
}

export function extractPriceOffers(source: Site, documents: unknown[], number: string): Offer[] {
  const exact = new RegExp(`(?<![A-Z0-9])${number.replace(/[^a-z0-9]/gi, "").split("").join("[ .\\/-]*")}(?![A-Z0-9])`, "i");
  const offers = new Map<string, Offer>();
  const pending: { value: unknown; depth: number }[] = documents.map(value => ({ value, depth: 0 }));
  function add(title: unknown, link: unknown, amount: unknown, currency: unknown, availability?: unknown) {
    if (typeof title !== "string" || !exact.test(title) || typeof link !== "string" || currency !== "PLN") return;
    const condition = title.replace(/nieuszkodz\p{L}*|bez uszkodz\p{L}*/giu, "");
    if (/uszkodz|niesprawn|na cz[eę][sś]ci|do naprawy|damaged|defect/i.test(condition) || /outofstock|soldout|discontinued/i.test(String(availability || ""))) return;
    let url: URL; try { url = new URL(link); } catch { return; }
    if (url.protocol !== "https:" || url.username || url.password || !(url.hostname === hosts[source] || url.hostname.endsWith(`.${hosts[source]}`))) return;
    const price = typeof amount === "number" ? amount : typeof amount === "string" && /^\d+(?:[.,]\d{1,2})?$/.test(amount) ? Number(amount.replace(",", ".")) : NaN;
    if (!Number.isFinite(price) || price <= 0 || price > 10000000) return;
    offers.set(url.href, { title: title.slice(0, 500), url: url.href, amount: Math.round(price * 100) / 100, currency: "PLN" });
  }
  for (let visited = 0; pending.length && visited < 50000; visited++) {
    const { value, depth } = pending.pop()!;
    if (depth > 22 || value == null) continue;
    if (typeof value === "string" && value.startsWith("{") && value.length < 2500000) {
      try { pending.push({ value: JSON.parse(value), depth: depth + 1 }); } catch { /* Ignore non-JSON text. */ }
      continue;
    }
    if (typeof value !== "object") continue;
    const item = value as Record<string, unknown>, price = record(item.price), amount = record(price.amount);
    if (source === "Otomoto" && item.__typename === "Advert" && price.isGross === true) {
      add(item.title, item.url, amount.value, amount.currencyCode);
    }
    if (item["@type"] === "Product") {
      for (const raw of Array.isArray(item.offers) ? item.offers : [item.offers]) {
        const offer = record(raw);
        if (offer["@type"] === "Offer") add(item.name, offer.url || item.url, offer.price, offer.priceCurrency, offer.availability);
      }
    }
    for (const child of Object.values(item)) if (child && (typeof child === "object" || typeof child === "string" && child.startsWith("{"))) pending.push({ value: child, depth: depth + 1 });
  }
  return [...offers.values()].sort((a, b) => a.amount - b.amount);
}

export async function readPriceDocuments(response: Response): Promise<unknown[]> {
  if (Number(response.headers.get("Content-Length")) > 3000000) { await response.body?.cancel(); throw Error("Document too large"); }
  const reader = response.body?.getReader(); if (!reader) return [];
  const decoder = new TextDecoder(); let html = "", bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 3000000) { await reader.cancel(); throw Error("Document too large"); }
      html += decoder.decode(chunk.value, { stream: true });
    }
    html += decoder.decode();
  } finally { reader.releaseLock(); }
  if (response.headers.get("Content-Type")?.includes("application/json")) return [JSON.parse(html)];
  const documents: unknown[] = []; let raw = "";
  // Cloudflare's HTML parser extracts data only; never execute a portal's scripts.
  await new HTMLRewriter().on('script[type="application/ld+json"],script[type="application/json"],script#__NEXT_DATA__', {
    element(element) {
      raw = "";
      element.onEndTag(() => { if (documents.length < 40) { try { documents.push(JSON.parse(raw)); } catch { /* Not usable structured data. */ } } });
    },
    text(chunk) { raw += chunk.text; },
  }).transform(new Response(html)).arrayBuffer();
  return documents;
}

export async function searchPriceComparison(owner: string, number: string, readDocuments = readPriceDocuments) {
  const compact = number.replace(/[ .\/-]/g, "").toUpperCase();
  if (!/^[A-Z0-9]{5,32}$/.test(compact) || !/\d/.test(compact)) return { error: "Wpisz pełny numer części (minimum 5 znaków).", status: 400 };
  const now = Date.now(), key = `${owner}:${compact}`, cached = cache.get(key);
  if (cached && cached.until > now) return { number: compact, results: cached.result };
  const recent = (limits.get(owner) || []).filter(time => now - time < 60000);
  if (recent.length >= 8) return { error: "Za dużo porównań. Poczekaj minutę.", status: 429 };
  if (limits.size >= 1000) limits.delete(limits.keys().next().value!);
  limits.set(owner, [...recent, now]);
  const result = await Promise.all((Object.keys(hosts) as Site[]).map(async (source: Site): Promise<Result> => {
    const base = { source, checkedAt: new Date().toISOString(), count: 0 };
    try {
      const response = await fetch(priceSearchUrl(source, compact), { headers: { Accept: "text/html,application/json" }, redirect: "manual", signal: AbortSignal.timeout(12000) });
      if ([401, 403, 429].includes(response.status)) { await response.body?.cancel(); return { ...base, status: "blocked", message: "Serwis blokuje automatyczny odczyt. Otwórz wyniki przyciskiem obok." }; }
      if (!response.ok) { await response.body?.cancel(); return { ...base, status: "unavailable", message: "Nie udało się pobrać ofert z serwisu." }; }
      const offers = extractPriceOffers(source, await readDocuments(response), compact);
      return offers.length ? { ...base, count: offers.length, status: "ok", lowest: offers[0], message: "Najniższa cena w pobranych ofertach z dokładnym numerem; bez dostawy. Stan sprawdź w ogłoszeniu." } : { ...base, status: "empty", message: "Brak odczytanych cen ofert z dokładnie tym numerem. Sprawdź wyniki obok." };
    } catch { return { ...base, status: "unavailable", message: "Odczyt cen jest teraz niedostępny. Sprawdź wyniki obok." }; }
  }));
  if (cache.size >= 200) cache.delete(cache.keys().next().value!);
  cache.set(key, { until: now + 120000, result });
  return { number: compact, results: result };
}
