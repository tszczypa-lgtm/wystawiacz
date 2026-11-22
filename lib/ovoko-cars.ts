import { OvokoError, ovokoPageData, ovokoInteger } from "./ovoko-read";

type Result = Record<string, any>;
const failure = (stage: string) => new OvokoError(502, `Nie potwierdzono listy aut Ovoko (${stage}). Nie tworzymy auta na podstawie bledu odczytu.`);
export async function ovokoCarsResponse(result: Result, path: string, legacy: () => Promise<Result>): Promise<Result> {
  const url = new URL(path, "https://api.rrr.lt");
  const page = Number(url.searchParams.get("page")), limit = Number(url.searchParams.get("limit"));
  if (url.pathname !== "/v2/get/cars" || !Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw failure("cars.query");
  if (result.status_code !== "R200") return result;
  try {
    ovokoPageData(result, { page, limit }, "cars");
    return result;
  } catch (error) {
    if (!(error instanceof OvokoError)) throw error;
  }
  // The unpaginated export is authoritative only when its complete bounded list is valid.
  let response: Result;
  try { response = await legacy(); } catch { throw failure("cars.legacy.request"); }
  if (response.status_code !== "R200" || !Array.isArray(response.list) || response.list.length > 10000) throw failure("cars.legacy.list");
  if (response.pagination !== undefined && (!response.pagination || ovokoInteger(response.pagination.total_count) !== response.list.length)) throw failure("cars.legacy.partial");
  const seen = new Set<string>();
  for (const row of response.list) {
    if (!row || typeof row !== "object" || Array.isArray(row) || !/^[1-9]\d{0,11}$/.test(String(row.id)) || !/^[1-9]\d{0,11}$/.test(String(row.car_model)) || seen.has(String(row.id))) throw failure("cars.legacy.row");
    seen.add(String(row.id));
  }
  const modelId = url.searchParams.get("model_ids"), carId = url.searchParams.get("car_ids"), externalId = url.searchParams.get("external_ids");
  if (externalId !== null && response.list.some(row => row.external_id !== null && typeof row.external_id !== "string")) throw failure("cars.legacy.external");
  const rows = response.list.filter(row => (modelId === null || String(row.car_model) === modelId) && (carId === null || String(row.id) === carId) && (externalId === null || row.external_id === externalId));
  return { status_code: "R200", data: rows.slice((page - 1) * limit, page * limit), pagination: { page, limit, total_count: rows.length } };
}
