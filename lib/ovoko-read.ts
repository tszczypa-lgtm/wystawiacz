export class OvokoError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); }
}
export type OvokoReadOperation = "models" | "categories" | "statuses" | "qualities" | "parts" | "cars" | "inventory";
export type OvokoReadRow = { id: string; name: string; image?: string; brand?: string; years?: string; modelId?: string; engineCode?: string; level?: string; parentId?: string; carId?: string; categoryId?: string; manufacturerCode?: string; externalId?: string; price?: string; status?: string; quality?: string };
export type OvokoReadResult = { ok: true; code: "R200"; readOnly: true; credentialsStored: boolean; checkedAt: string; operation: OvokoReadOperation; rows: OvokoReadRow[]; pagination?: { page: number; limit: number; total: number } };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const invalid = (stage = "schema") => new OvokoError(502, `Nieprawidlowy lub niepelny format danych Ovoko (${stage}). Nie potwierdzono odczytu; nie zmieniono ofert.`);
export function ovokoInteger(value: unknown): number {
  if (typeof value !== "number" && (typeof value !== "string" || !/^\d{1,16}$/.test(value))) throw invalid("integer");
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw invalid("integer");
  return number;
}
export function ovokoPage(result: Record<string, unknown>, expected: { page: number; limit: number }, stage = "pagination") {
  if (!record(result.pagination)) throw invalid(stage);
  const page = ovokoInteger(result.pagination.page), limit = ovokoInteger(result.pagination.limit), total = ovokoInteger(result.pagination.total_count);
  if (page !== expected.page || limit !== expected.limit) throw invalid(stage);
  return { page, limit, total };
}
export function ovokoPageData(result: Record<string, unknown>, expected: { page: number; limit: number }, stage = "page") {
  const pagination = ovokoPage(result, expected, `${stage}.pagination`);
  const raw = result.data;
  const empty = raw === null || (record(raw) && Object.keys(raw).length === 0);
  const data = empty && pagination.total === 0 ? [] : raw;
  if (!Array.isArray(data) || data.length !== Math.max(0, Math.min(pagination.total - (pagination.page - 1) * pagination.limit, pagination.limit))) throw invalid(`${stage}.data`);
  return { data, pagination };
}
export function ovokoNoCars(result: Record<string, unknown>, path: string): Record<string, unknown> {
  if (result.status_code !== "R004") return result;
  const url = new URL(path, "https://api.rrr.lt");
  if (!["/v2/get/cars", "/get/cars"].includes(url.pathname)) return result;
  if (result.data != null && (!Array.isArray(result.data) || result.data.length)) throw invalid("cars.empty");
  if (result.list != null && (!Array.isArray(result.list) || result.list.length)) throw invalid("cars.empty");
  if (result.pagination !== undefined && (!record(result.pagination) || ovokoInteger(result.pagination.total_count) !== 0)) throw invalid("cars.empty");
  if (url.pathname === "/get/cars") return { status_code: "R200", list: [] };
  const page = ovokoInteger(url.searchParams.get("page")), limit = ovokoInteger(url.searchParams.get("limit"));
  if (!page || limit < 1 || limit > 100) throw invalid("cars.empty");
  return { status_code: "R200", data: [], pagination: { page, limit, total_count: 0 } };
}
export function ovokoInventoryPlan(input: Record<string, unknown>) {
  const page = input.page ?? 1, limit = input.limit ?? 50, search = input.search ?? "", sort = input.sort ?? "newest";
  if (!Number.isSafeInteger(page) || Number(page) < 1 || Number(page) > 1000000 || ![20, 50, 100].includes(Number(limit)) || typeof limit !== "number" || typeof search !== "string" || search.length > 100 || /[\x00-\x1f]/.test(search) || !["newest", "oldest"].includes(String(sort))) throw new OvokoError(400, "Nieprawidlowe filtry lub numer strony Ovoko.");
  const query = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (search.trim()) query.set("search", search.trim());
  if (input.externalId !== undefined && (typeof input.externalId !== "string" || input.externalId.length > 255 || /[,\x00-\x1f]/.test(input.externalId))) throw new OvokoError(400, "Nieprawidlowe ID zewnetrzne.");
  if (input.externalId) query.set("external_ids", String(input.externalId));
  query.set("sort[id]", sort === "oldest" ? "asc" : "desc");
  return { page: Number(page), limit: Number(limit), path: `/v2/get/parts?${query}` };
}
export function ovokoPartImage(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && ["ovoko.com", "rrr.lt", "cdnrrr.com"].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`)) ? url.href : "";
  } catch { return ""; }
}
function id(value: unknown) {
  if ((typeof value !== "string" && typeof value !== "number") || !/^\d{1,12}$/.test(String(value))) throw invalid();
  return String(value);
}
function text(value: unknown, max = 300, required = false) {
  if (value === undefined || value === null) { if (required) throw invalid(); return ""; }
  if (typeof value !== "string" || value.length > max || (required && !value.trim())) throw invalid();
  return value;
}
export function ovokoReadPlan(input: Record<string, unknown>): { operation: OvokoReadOperation; path: string } {
  // An exhaustive read-only allowlist, never an upstream URL or method supplied by the browser.
  switch (input.operation) {
    case "models":
      if (typeof input.brandId !== "string" || !/^[1-9]\d{0,11}$/.test(input.brandId)) throw new OvokoError(400, "Wybierz marke z wyniku odczytu marek.");
      return { operation: "models", path: `/get/car_models/${input.brandId}` };
    case "categories": return { operation: "categories", path: "/get/categories" };
    case "statuses": return { operation: "statuses", path: "/get/part_status" };
    case "qualities": return { operation: "qualities", path: "/get/part_quality" };
    case "parts": return { operation: "parts", path: "/v2/get/parts?page=1&limit=20" };
    case "inventory": return { operation: "inventory", path: ovokoInventoryPlan(input).path };
    case "cars":
      if (typeof input.modelId !== "string" || !/^[1-9]\d{0,11}$/.test(input.modelId)) throw new OvokoError(400, "Wybierz model samochodu Ovoko.");
      return { operation: "cars", path: `/v2/get/cars?model_ids=${input.modelId}&page=1&limit=20` };
    default: throw new OvokoError(400, "Nieznana operacja odczytu. Zapis ofert jest zablokowany.");
  }
}
export function parseOvokoRead(operation: OvokoReadOperation, result: Record<string, unknown>, selectedId?: unknown, requested = { page: 1, limit: 20 }): Pick<OvokoReadResult, "rows" | "pagination"> {
  let rows: OvokoReadRow[];
  if (operation === "statuses" || operation === "qualities") {
    if (!record(result.list) || Object.keys(result.list).length > 100) throw invalid();
    rows = Object.entries(result.list).map(([key, value]) => {
      if (!record(value)) throw invalid();
      return { id: id(key), name: text(value.pl || value.en, 300, true) };
    });
  } else {
    const inventory = operation === "parts" || operation === "cars" || operation === "inventory";
    const list = inventory ? ovokoPageData(result, operation === "inventory" ? requested : { page: 1, limit: 20 }, operation).data : result.list;
    if (!Array.isArray(list) || list.length > (inventory ? operation === "inventory" ? requested.limit : 20 : 10000)) throw invalid();
    rows = list.map(value => {
      if (!record(value)) throw invalid();
      if (operation === "cars") {
        const carId = id(value.id);
        if (id(value.car_model) !== selectedId) throw invalid("cars.model");
        const year = value.car_years;
        if (year !== undefined && year !== null && year !== "" && !/^(0|\d{4})$/.test(String(year))) throw invalid("cars.year");
        return { id: carId, name: `Auto ID ${carId}`, modelId: id(value.car_model), years: year === undefined || year === null ? "" : String(year), engineCode: value.car_engine_code === 0 ? "" : text(value.car_engine_code, 100) };
      }
      const base = { id: id(value.id), name: text(operation === "categories" ? value.pl || value.en : value.name, 500, !inventory) };
      if (operation === "categories") {
        if (!["1", "2", "3"].includes(String(value.level))) throw invalid();
        return { ...base, level: String(value.level), parentId: id(value.parent_id) };
      }
      if (operation === "models") {
        if (id(value.brand) !== selectedId) throw invalid();
        return { ...base, brand: id(value.brand), years: [text(value.year_start, 4), text(value.year_end, 4)].join(" - ") };
      }
      const price = text(value.price, 30);
      if (price && !/^\d{1,15}(\.\d{1,4})?$/.test(price)) throw invalid();
      return { ...base, carId: id(value.car_id), categoryId: id(value.category_id), status: id(value.status), quality: id(value.quality), price, manufacturerCode: text(value.manufacturer_code, 1000), externalId: text(value.external_id, 1000), ...(operation === "inventory" ? { image: ovokoPartImage(value.photo) || (Array.isArray(value.part_photo_gallery) ? value.part_photo_gallery.slice(0, 50).map(ovokoPartImage).find(Boolean) || "" : "") } : {}) };
    });
  }
  const inventory = operation === "parts" || operation === "cars" || operation === "inventory";
  if (new Set(rows.map(row => row.id)).size !== rows.length || (!inventory && rows.length === 0)) throw invalid();
  if (!inventory) return { rows };
  const expected = operation === "inventory" ? requested : { page: 1, limit: 20 };
  return { rows, pagination: ovokoPage(result, expected, `${operation}.pagination`) };
}
