import type { FitmentRow } from "./ovoko-fitment";
import { ovokoSourcePreview, type OvokoSourcePreview } from "./ovoko-preparation";
import type { OvokoReadRow } from "./ovoko-read";
import { automaticOvokoModel, ovokoModelHasConflict, suggestOvokoBrands, suggestPartNumbers, vehicleSuggestionText } from "./ovoko-suggestions";

export type YearEvidence = { year: string; reason: string; technical: true; source: "allegro-fitment" | "allegro-offer" | "ovoko-part" | "web-search"; sourceUrl?: string };
type Client = (path: string) => Promise<Record<string, unknown>>;
type Input = { source: OvokoSourcePreview; number: string; brand: OvokoReadRow; model: OvokoReadRow; models: OvokoReadRow[]; fitmentRows?: FitmentRow[]; allegro: Client; ovoko: Client };
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === "string" ? value : "";
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const fold = (value: string) => value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\u0142/g, "l").trim();
const code = (value: unknown) => typeof value === "string" && value.length <= 100 && /^[a-z0-9 .-]+$/i.test(value) ? value.toUpperCase().replace(/[ .-]/g, "") : "";
const id = (value: unknown) => (typeof value === "string" || typeof value === "number") && /^[1-9]\d{0,29}$/.test(String(value)) ? String(value) : "";
async function read(client: Client, path: string) { try { return object(await client(path)); } catch { return {}; } }
const lowest = (items: YearEvidence[]) => items.sort((a, b) => Number(a.year) - Number(b.year) || a.reason.localeCompare(b.reason) || (a.sourceUrl || "").localeCompare(b.sourceUrl || ""))[0] || null;

function yearBounds(model: OvokoReadRow): [number, number] | null {
  const min = 1886, max = new Date().getUTCFullYear() + 1;
  if (!model.years?.trim() || model.years.trim() === "-") return [min, max];
  const range = model.years.trim().match(/^(\d{4})?\s*[-\u2013\u2014]\s*(\d{4})?$/);
  const single = model.years.trim().match(/^\d{4}$/);
  if (!range && !single) return null;
  const start = Number(single?.[0] || range?.[1] || min), end = Number(single?.[0] || range?.[2] || max);
  return start >= min && end <= max && start <= end ? [start, end] : null;
}

// Date ranges are explicit evidence; an unlabelled four-digit engine/price/code is not.
function evidenceYears(value: string, bounds: [number, number], single = false): number[] {
  const years: number[] = [], spans: [number, number][] = [];
  const normalized = value.replace(/[\u2013\u2014]/g, "-");
  const date = "(?:\\d{4}(?:[/.](?:0?[1-9]|1[0-2]))?|(?:0?[1-9]|1[0-2])[/.]\\d{4})";
  const pattern = new RegExp(`(?<![A-Za-z0-9/.,-])(${date})\\s*-\\s*(${date})(?![A-Za-z0-9/.,-])`, "g");
  const endpoint = (raw: string) => {
    const parts = raw.split(/[/.]/).map(Number);
    return parts[0] > 31 ? [parts[0], parts[1] || 1] : [parts[1], parts[0]];
  };
  for (const match of normalized.matchAll(pattern)) {
    spans.push([match.index!, match.index! + match[0].length]);
    const [start, month] = endpoint(match[1]), [end, endMonth] = endpoint(match[2]);
    const after = normalized.slice(match.index! + match[0].length);
    const before = fold(normalized.slice(0, match.index!));
    if (/^\s*(?:(?:ccm?|cm\s*(?:3|\^3|\u00b3)|pln|eur|zl|usd)(?=$|[^a-z0-9])|[\u20ac$])/i.test(after) || /(?:cena|price|numer|oe|mpn|eur|pln|\u20ac|\$)\s*[:=]?\s*$/.test(before)) continue;
    if (start < 1886 || end > new Date().getUTCFullYear() + 1 || start > end || start === end && month > endMonth) continue;
    const year = Math.max(start, bounds[0]);
    if (year <= Math.min(end, bounds[1])) years.push(year);
  }
  if (single) for (const match of normalized.matchAll(/(?<![A-Za-z0-9/.,-])\d{4}(?![A-Za-z0-9/.,-])/g)) {
    if (spans.some(([start, end]) => match.index! >= start && match.index! < end)) continue;
    const before = fold(normalized.slice(0, match.index!)), after = normalized.slice(match.index! + 4);
    if (/^\s*(?:(?:ccm?|cm\s*(?:3|\^3|\u00b3)|pln|eur|zl|usd|kw|km)(?=$|[^a-z0-9])|[\u20ac$])/i.test(after) || /(?:cena|price|numer|oe|mpn|pojemnosc|eur|pln|\u20ac|\$)\s*[:=]?\s*$/.test(before)) continue;
    const year = Number(match[0]);
    if (year >= bounds[0] && year <= bounds[1]) years.push(year);
  }
  return [...new Set(years)];
}

function compatible(value: string, input: Input) {
  if (!suggestOvokoBrands(value, [input.brand]).length || ovokoModelHasConflict(value, input.model)) return false;
  if (automaticOvokoModel(value, input.models) !== input.model.id) return false;
  const family = input.model.name.split("(")[0].replace(/\b(?:[BDEFGWLX]\d{1,4}|[IVX]+|(?:MK|GEN)\s*\d+)\b/gi, "").trim();
  if (family && automaticOvokoModel(value, [{ ...input.model, name: family }]) !== input.model.id) return false;
  // A generic family name must not select a generation merely by dictionary ordering.
  const generations = input.model.name.match(/\b(?:[BDEFGWLX]\d{1,4}|[IVX]+|(?:MK|GEN)\s*\d+)\b/gi) || [];
  const tokens = (s: string) => fold(s).replace(/\b(?:mk|gen)\s*/g, "").replace(/[^a-z0-9]+/g, " ").split(" ");
  const roman: Record<string, string> = { i: "1", ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7", viii: "8", ix: "9", x: "10" };
  const canonical = (s: string) => tokens(s).map(token => roman[token] || token);
  return !generations.length || generations.some(generation => canonical(generation).every(token => canonical(value).includes(token)));
}

function evidence(year: number, source: YearEvidence["source"], provenance: string, sourceUrl?: string): YearEvidence {
  const ascii = provenance.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\u0142/g, "l").replace(/\u0141/g, "L").replace(/[\u2013\u2014]/g, "-").replace(/[^\x20-\x7e]/g, " ");
  return { year: String(year), technical: true, source, reason: `Rok techniczny ${year}: ${ascii}. Najnizszy zgodny rok; nie potwierdza rocznika dawcy.`, ...(sourceUrl ? { sourceUrl } : {}) };
}

/** Clients must be authenticated, account-scoped read adapters, including the offer ownership guard. */
export async function suggestOvokoYearEvidence(input: Input): Promise<YearEvidence | null> {
  const number = code(input.number), bounds = yearBounds(input.model);
  if (!/^[A-Z0-9]{6,32}$/.test(number) || !/\d/.test(number) || !bounds || !input.models.some(row => row.id === input.model.id) || input.model.brand && input.model.brand !== input.brand.id || ovokoModelHasConflict(vehicleSuggestionText(input.source.title, input.source.parameters), input.model)) return null;
  const candidates: YearEvidence[] = [];
  let rows: unknown[] = input.fitmentRows ?? [];
  if (input.fitmentRows === undefined && id(input.source.id)) {
    const result = await read(input.allegro, `/ovoko-fitment/${input.source.id}?expand=1&number=${encodeURIComponent(number)}`);
    rows = list(result.rows);
  }
  for (const raw of rows.slice(0, 500)) {
    const row = object(raw), value = text(row.text);
    if (!compatible(value, input)) continue;
    for (const year of evidenceYears(value, bounds)) candidates.push(evidence(year, "allegro-fitment", `dopasowanie Allegro (${text(row.origin) || "fitment"}): ${value}`, `https://allegro.pl/oferta/${input.source.id}`));
  }
  if (candidates.length) return lowest(candidates);

  if (input.source.categoryId) {
    const result = await read(input.allegro, `/sale/offers?name=${encodeURIComponent(number)}&limit=5`);
    const ids = [...new Set(list(result.offers).slice(0, 5).map(raw => id(object(raw).id)).filter(value => value && value !== input.source.id))].slice(0, 3);
    for (const offerId of ids) {
      const raw = await read(input.allegro, `/sale/product-offers/${offerId}`);
      try {
        const offer = ovokoSourcePreview(raw, offerId, () => "");
        if (offer.categoryId !== input.source.categoryId || !compatible(vehicleSuggestionText(offer.title, offer.parameters), input)) continue;
        const exact = suggestPartNumbers(offer.title, offer.parameters).some(row => row.number === number);
        const strict = offer.parameters.some(row => /^(numer katalogowy czesci|kod producenta|manufacturer code|numer oe)$/.test(fold(row.name)) && row.values.some(value => code(value) === number));
        if (suggestPartNumbers(offer.title).some(row => row.number !== number && row.number.startsWith(number))) continue;
        if (!exact && !strict) continue;
        const years = evidenceYears(offer.title, bounds, true);
        for (const parameter of offer.parameters) if (/^(rok produkcji|rocznik|production year|year of manufacture)$/.test(fold(parameter.name))) {
          for (const value of parameter.values) if (/^[\d\s/.\-\u2013\u2014]+$/.test(value.trim())) years.push(...evidenceYears(value.trim(), bounds, true));
        }
        for (const year of years) candidates.push(evidence(year, "allegro-offer", `wlasna oferta Allegro ${offerId}, pelny numer ${number}, zgodny model`, `https://allegro.pl/oferta/${offerId}`));
      } catch { /* Malformed or inaccessible owned offers do not stop the next provider. */ }
    }
    if (candidates.length) return lowest(candidates);
  }

  const result = await read(input.ovoko, `/v2/get/parts?search=${encodeURIComponent(number)}&page=1&limit=5`);
  if (result.status_code !== undefined && result.status_code !== "R200") return null;
  const cars = new Map<string, string>();
  for (const raw of list(result.data).slice(0, 5)) {
    const part = object(raw);
    const codes = [part.manufacturer_code, part.visible_code, part.other_code, part.optional_codes].flatMap(value => Array.isArray(value) ? value.slice(0, 30) : [value]);
    if (!codes.some(value => code(value) === number)) continue;
    const carId = id(part.car_id) || id(object(part.car).id);
    if (carId && !cars.has(carId)) cars.set(carId, id(part.id));
  }
  for (const [carId, partId] of [...cars].slice(0, 2)) {
    const response = await read(input.ovoko, `/get/car/${carId}`);
    if (response.status_code !== undefined && response.status_code !== "R200") continue;
    // Swagger's single-car response is list: [[car]]; also accept a flat list.
    const carRows = list(response.list).flatMap(row => Array.isArray(row) ? row : [row]);
    if (carRows.length !== 1) continue;
    const car = object(carRows[0]), year = String(car.car_years ?? "");
    if (id(car.id) !== carId || id(car.car_model) !== input.model.id || !/^\d{4}$/.test(year) || Number(year) < bounds[0] || Number(year) > bounds[1]) continue;
    candidates.push(evidence(Number(year), "ovoko-part", `wlasna czesc Ovoko ${partId || "(bez ID)"}, auto ${carId}, pelny numer ${number}, zgodny model`));
  }
  return lowest(candidates);
}
