import { OvokoError, ovokoPageData } from "./ovoko-read";

type Remote = (path: string) => Promise<Record<string, unknown>>;
const failure = () => new OvokoError(502, "Nie potwierdzono obecnosci czesci w Ovoko. Rejestr pozostaje zablokowany; nie ponowiono wysylki.");
const id = (value: unknown) => (typeof value === "string" || typeof value === "number") && /^[1-9]\d{0,11}$/.test(String(value));

export type CreatedPublication = { state: "created"; part_id: string; request_hash: string; updated_at: string; owner_id: string };
export function createdPublication(value: unknown, owner: string): CreatedPublication {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw failure();
  const row = value as Record<string, unknown>;
  if (row.state !== "created" || typeof row.part_id !== "string" || !id(row.part_id) || row.owner_id !== owner || typeof row.request_hash !== "string" || !/^[a-f0-9]{64}$/.test(row.request_hash) || typeof row.updated_at !== "string" || !/^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/.test(row.updated_at) || !Number.isFinite(Date.parse(row.updated_at))) throw failure();
  return row as CreatedPublication;
}

export function publicationCas(row: CreatedPublication) {
  return `&state=eq.created&part_id=eq.${row.part_id}&request_hash=eq.${row.request_hash}&updated_at=eq.${encodeURIComponent(row.updated_at)}`;
}

export async function ovokoPublicationPresent(remote: Remote, partId: string, externalId: string): Promise<boolean> {
  try {
    if (!id(partId) || !/^tymo:\d{1,30}:\d{1,30}$/.test(externalId)) throw failure();
    const externalResult = await remote(`/v2/get/parts?external_ids=${encodeURIComponent(externalId)}&page=1&limit=1`);
    if (externalResult.status_code !== "R200") throw failure();
    const external = ovokoPageData(externalResult, { page: 1, limit: 1 }, "publication.external");
    for (const row of external.data) {
      if (!row || typeof row !== "object" || Array.isArray(row) || !id(row.id) || row.external_id !== externalId) throw failure();
    }
    if (external.pagination.total > 0) return true;

    // Verified 2026-11-23: api.rrr.lt/openapi/swagger.yaml does NOT document part_ids.
    // The documented sort[id]=asc permits exact-ID range lookup without an unsupported filter.
    // Validate whole fetched pages and cross-page ordering; never infer absence from an error.
    const seen = new Set<string>();
    const ranges: { page: number; first: bigint; last: bigint }[] = [];
    let total: number | undefined, page = 1, low = 2, high = 0;
    for (let probe = 0; probe < 16; probe++) {
      const result = await remote(`/v2/get/parts?page=${page}&limit=100&sort[id]=asc`);
      if (result.status_code !== "R200") throw failure();
      const inventory = ovokoPageData(result, { page, limit: 100 }, "publication.ids");
      if (total !== undefined && total !== inventory.pagination.total) throw failure();
      total = inventory.pagination.total;
      if (total === 0) return false;
      if (!inventory.data.length) throw failure();
      let previous = BigInt(0);
      let found = false;
      for (const row of inventory.data) {
        if (!row || typeof row !== "object" || Array.isArray(row) || !id(row.id) || (row.external_id != null && typeof row.external_id !== "string")) throw failure();
        const key = String(row.id);
        if (seen.has(key) || BigInt(key) <= previous) throw failure();
        seen.add(key); previous = BigInt(key);
        if (key === partId || row.external_id === externalId) found = true;
      }
      const first = BigInt(String(inventory.data[0].id)), last = previous;
      if (ranges.some(range => range.page < page ? range.last >= first : range.first <= last)) throw failure();
      ranges.push({ page, first, last });
      if (found) return true;
      const target = BigInt(partId);
      if (target < first && page === 1) return false;
      if (target >= first && target <= last) return false;
      if (page === 1) high = Math.ceil(total / 100);
      else if (target < first) high = page - 1;
      if (target > last) low = page + 1;
      if (low > high) return false;
      page = Math.floor((low + high) / 2);
    }
    throw failure();
  } catch { throw failure(); }
}
