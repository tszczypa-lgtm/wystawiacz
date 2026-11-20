export class OvokoError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export type OvokoReadOperation = "models" | "categories" | "statuses" | "qualities" | "parts";
export type OvokoReadRow = { id: string; name: string; brand?: string; years?: string; level?: string; parentId?: string; carId?: string; categoryId?: string; manufacturerCode?: string; externalId?: string; price?: string; status?: string; quality?: string };
export type OvokoReadResult = { ok: true; code: "R200"; readOnly: true; credentialsStored: false; checkedAt: string; operation: OvokoReadOperation; rows: OvokoReadRow[]; pagination?: { page: number; limit: number; total: number } };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const invalid = () => new OvokoError(502, "Nieprawidlowy lub niepelny format danych Ovoko. Nie potwierdzono odczytu; nie zmieniono ofert.");
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
    default: throw new OvokoError(400, "Nieznana operacja odczytu. Zapis ofert jest zablokowany.");
  }
}
export function parseOvokoRead(operation: OvokoReadOperation, result: Record<string, unknown>, brandId?: unknown): Pick<OvokoReadResult, "rows" | "pagination"> {
  let rows: OvokoReadRow[];
  if (operation === "statuses" || operation === "qualities") {
    if (!record(result.list) || Object.keys(result.list).length > 100) throw invalid();
    rows = Object.entries(result.list).map(([key, value]) => {
      if (!record(value)) throw invalid();
      return { id: id(key), name: text(value.pl || value.en, 300, true) };
    });
  } else {
    const list = operation === "parts" ? result.data : result.list;
    if (!Array.isArray(list) || list.length > (operation === "parts" ? 20 : 10000)) throw invalid();
    rows = list.map(value => {
      if (!record(value)) throw invalid();
      const base = { id: id(value.id), name: text(operation === "categories" ? value.pl || value.en : value.name, 500, operation !== "parts") };
      if (operation === "categories") {
        if (!["1", "2", "3"].includes(String(value.level))) throw invalid();
        return { ...base, level: String(value.level), parentId: id(value.parent_id) };
      }
      if (operation === "models") {
        if (id(value.brand) !== brandId) throw invalid();
        return { ...base, brand: id(value.brand), years: [text(value.year_start, 4), text(value.year_end, 4)].join(" - ") };
      }
      const price = text(value.price, 30);
      if (price && !/^\d{1,15}(\.\d{1,4})?$/.test(price)) throw invalid();
      return { ...base, carId: id(value.car_id), categoryId: id(value.category_id), status: id(value.status), quality: id(value.quality), price, manufacturerCode: text(value.manufacturer_code, 1000), externalId: text(value.external_id, 1000) };
    });
  }
  if (new Set(rows.map(row => row.id)).size !== rows.length || (operation !== "parts" && rows.length === 0)) throw invalid();
  if (operation !== "parts") return { rows };
  const pagination = result.pagination;
  if (!record(pagination)) throw invalid();
  const { page, limit, total_count: total } = pagination;
  if (page !== 1 || limit !== 20 || typeof total !== "number" || !Number.isSafeInteger(total) || total < rows.length || (total > 0 && rows.length === 0) || rows.length !== Math.min(total, 20)) throw invalid();
  return { rows, pagination: { page, limit, total } };
}
