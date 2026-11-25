import type { accountContext } from "./account-api";
import { handleAllegroApi } from "./allegro-api";
import { loadOvokoConnection, ovokoConnectionKey } from "./ovoko-connection";
import { ovokoCarYear } from "./ovoko-car-selection";
import { ovokoSourcePreview } from "./ovoko-preparation";
import type { OvokoPublishEnv } from "./ovoko-publish";
import { OvokoError, parseOvokoRead } from "./ovoko-read";
import { ovokoAutomaticFields } from "./ovoko-suggestions";
import { ovokoWriteClient, ovokoWriteDigest } from "./ovoko-write-client";
import { suggestOvokoYearEvidence, type YearEvidence } from "./ovoko-year-evidence";
import { lookupWebFitment, selectWebVehicle } from "./ovoko-web-fitment";

type Data = Record<string, unknown>;
const cache = new Map<string, { until: number; evidence: YearEvidence | null }>();
export async function cachedOvokoYearEvidence(key: string, input: Parameters<typeof suggestOvokoYearEvidence>[0]) {
  const saved = cache.get(key);
  if (saved && saved.until > Date.now()) return saved.evidence;
  const evidence = await suggestOvokoYearEvidence(input);
  if (cache.size >= 200 && !cache.has(key)) cache.delete(cache.keys().next().value!);
  cache.set(key, { evidence, until: Date.now() + (evidence ? 300000 : 45000) });
  return evidence;
}
export function yearAllegroReader(request: Request, env: OvokoPublishEnv) {
  return async (path: string): Promise<Data> => {
    let route: string;
    const url = new URL(path, "https://allegro.invalid");
    if (url.pathname === "/sale/offers" && url.searchParams.get("limit") === "5" && /^[A-Z0-9]{6,32}$/.test(url.searchParams.get("name") || "")) route = `/year-offers?number=${encodeURIComponent(url.searchParams.get("name")!)}`;
    else if (/^\/sale\/product-offers\/\d{1,30}$/.test(path)) route = `/own-offers/${path.split("/").pop()}`;
    else if (/^\/ovoko-fitment\/\d{1,30}\?expand=1&number=[A-Z0-9]{6,32}$/.test(path)) route = path;
    else throw new OvokoError(400, "Nieprawidlowa sciezka podpowiedzi roku.");
    const response = await handleAllegroApi(new Request(`${new URL(request.url).origin}/api/allegro${route}`, { headers: { Authorization: request.headers.get("Authorization")! } }), env);
    if (!response.ok) throw new OvokoError(response.status, "Nie potwierdzono odczytu ofert dla podpowiedzi roku.");
    return await response.json() as Data;
  };
}
export async function ovokoYearSuggestion(request: Request, env: OvokoPublishEnv, context: Awaited<ReturnType<typeof accountContext>>, input: Data) {
  if (Object.keys(input).some(k => !["offerId", "brandId", "modelId", "number"].includes(k)) || typeof input.offerId !== "string" || !/^\d{1,30}$/.test(input.offerId) || [input.brandId, input.modelId].some(v => typeof v !== "string" || !/^[1-9]\d{0,11}$/.test(v)) || input.number !== undefined && (typeof input.number !== "string" || input.number.length > 64)) throw new OvokoError(400, "Wybierz oferte, marke, model i pelny numer czesci.");
  const response = await handleAllegroApi(new Request(`${new URL(request.url).origin}/api/allegro/ovoko-source/${input.offerId}`, { headers: { Authorization: request.headers.get("Authorization")! } }), env);
  if (!response.ok) throw new OvokoError(response.status, "Nie potwierdzono wlasnosci oferty Allegro dla podpowiedzi roku.");
  const owned = await response.json() as { offer: unknown; sellerId: string };
  if (typeof owned.sellerId !== "string" || !/^\d{1,30}$/.test(owned.sellerId)) throw new OvokoError(502, "Nie potwierdzono sprzedawcy Allegro.");
  const source = ovokoSourcePreview(owned.offer, input.offerId, () => "");
  const number = String(input.number || ovokoAutomaticFields(source, {}).manufacturerCode || "").toUpperCase().replace(/[ .-]/g, "");
  if (number && (!/^[A-Z0-9]{6,32}$/.test(number) || !/\d/.test(number))) throw new OvokoError(400, "Podaj pelny numer czesci z koncowka literowa.");
  const credentials = await loadOvokoConnection(context, await ovokoConnectionKey(env));
  const remote = ovokoWriteClient(credentials);
  const models = parseOvokoRead("models", await remote(`/get/car_models/${input.brandId}`), String(input.brandId)).rows;
  const model = models.find(m => m.id === input.modelId);
  if (!model) throw new OvokoError(400, "Wybrany model nie nalezy do marki Ovoko.");
  const reply = { ok: true, readOnly: true, offerId: input.offerId, brandId: input.brandId, modelId: input.modelId, number, technical: true as const };
  const known = ovokoCarYear(source, model);
  if (known.year) return { ...reply, year: known.year, reason: known.reason };
  if (!number) return { ...reply, year: "", reason: "Brak pelnego numeru do odczytu istniejacych ofert." };
  const brands = await remote("/get/car_brands");
  if (!Array.isArray(brands.list) || brands.list.length > 5000) throw new OvokoError(502, "Nie potwierdzono slownika marek.");
  const brand = brands.list.find((b: Data) => String(b.id) === input.brandId);
  if (!brand || typeof brand.name !== "string" || brand.name.length > 200) throw new OvokoError(400, "Nie potwierdzono wybranej marki.");
  const fingerprint = await ovokoWriteDigest(JSON.stringify(credentials));
  const evidence = await cachedOvokoYearEvidence(`${context.user.id}:${owned.sellerId}:${fingerprint}:${source.id}:${source.categoryId}:${number}:${input.brandId}:${model.id}`, { source, number, brand: { id: String(brand.id), name: brand.name }, model, models, allegro: yearAllegroReader(request, env), ovoko: remote });
  if (evidence) return { ...reply, ...evidence };
  const web = await lookupWebFitment(env, context.user.id, number, brand.name);
  if (web.pending) return {...reply,year:"",reason:web.message,pending:true,retryAfter:web.retryAfter||5};
  const matched = await selectWebVehicle(web.matches, [{id:String(brand.id),name:brand.name}], [String(brand.id)], async()=>models, model.id);
  if (matched) return { ...reply, year: matched.year, reason: `Internet / OpenAI: pelny numer ${number}, ${matched.make} ${matched.model}, rok techniczny ${matched.year}. Publiczna oferta, nie potwierdza rocznika dawcy ani pelnej zgodnosci.`, source: "web-search", sourceUrl: matched.sourceUrl, ...(matched.modelId !== model.id ? { vehicleSuggestion: {brandId:matched.brandId,modelId:matched.modelId,year:matched.year} } : {}) };
  return { ...reply, year: "", reason: web.message || "Internet znalazl dane, ale modelu nie mozna jednoznacznie przypisac do slownika Ovoko. Podaj rok recznie." };
}
