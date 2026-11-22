import type { accountContext } from "./account-api";
import { handleAllegroApi } from "./allegro-api";
import { loadOvokoConnection, ovokoConnectionKey } from "./ovoko-connection";
import { publishOvokoPart, type OvokoPublishEnv } from "./ovoko-publish";
import { createOvokoCar } from "./ovoko-create-car";
import { initialOvokoDraft, ovokoPublicationBlockers, ovokoSourcePreview } from "./ovoko-preparation";
import { automaticOvokoBrand, automaticOvokoModel, ovokoAutomaticFields, vehicleSuggestionText } from "./ovoko-suggestions";
import { ovokoCarYear } from "./ovoko-car-selection";
import { OvokoError, parseOvokoRead, type OvokoReadRow } from "./ovoko-read";
import { ovokoWriteClient, ovokoWriteDigest } from "./ovoko-write-client";
import { adjustedOvokoPrice, sameOvokoMoney, validateOvokoAdjustment } from "./ovoko-bulk-price";

type Context = Awaited<ReturnType<typeof accountContext>>;
export async function bulkOvokoPart(request: Request, env: OvokoPublishEnv, context: Context, input: Record<string, unknown>) {
  if (env.OVOKO_PUBLISH_ENABLED !== "true") throw new OvokoError(503, "Publikacja Ovoko jest wylaczona.");
  if (!["start", "prepare", "item"].includes(String(input.operation)) || Object.keys(input).some(key => !["operation", "offerId", "adjustment", "binding", "notes", "expectedSource", "prepared"].includes(key))) throw new OvokoError(400, "Nieprawidlowa operacja przenoszenia.");
  try { validateOvokoAdjustment(input.adjustment); } catch (error) { throw new OvokoError(400, (error as Error).message); }
  if (input.operation !== "start" && (typeof input.offerId !== "string" || !/^\d{1,30}$/.test(input.offerId) || typeof input.notes !== "string" || input.notes.length > 40000 || /\0/.test(input.notes))) throw new OvokoError(400, "Nieprawidlowe dane oferty.");
  const credentials = await loadOvokoConnection(context, await ovokoConnectionKey(env));
  const fingerprint = await ovokoWriteDigest(JSON.stringify(credentials));
  const account = await ovokoWriteDigest(credentials.username.trim().toLowerCase());
  const allegro = async (path: string) => {
    const result = await handleAllegroApi(new Request(`${new URL(request.url).origin}/api/allegro${path}`, { headers: { Authorization: request.headers.get("Authorization")! } }), env);
    const body = await result.json() as Record<string, any>;
    if (!result.ok) throw new OvokoError(result.status, body.message || "Nie odczytano oferty Allegro.");
    return body;
  };
  if (input.operation === "start") {
    const { sellerId } = await allegro("/seller-identity");
    if (typeof sellerId !== "string" || !/^\d{1,30}$/.test(sellerId)) throw new OvokoError(502, "Nie potwierdzono sprzedawcy.");
    return { ok: true, binding: { sellerId, fingerprint } };
  }
  const owned = await allegro(`/ovoko-source/${input.offerId}`);
  const binding = input.binding as Record<string, unknown> | null;
  if (!binding || binding.sellerId !== owned.sellerId || binding.fingerprint !== fingerprint) throw new OvokoError(409, "Polaczone konto zmienilo sie. Zatrzymano partie; rozpocznij ja ponownie po sprawdzeniu kont.");
  const source = ovokoSourcePreview(owned.offer, input.offerId as string, () => input.notes as string);
  const expected = input.expectedSource as Record<string, unknown> | null;
  if (!expected || !sameOvokoMoney(expected.price, source.price) || ["title", "currency", "stock", "status", "condition"].some(key => expected[key] !== source[key as keyof typeof source]) || JSON.stringify(expected.images) !== JSON.stringify(source.images)) throw new OvokoError(409, "Oferta Allegro zmienila sie. Sprawdz dane przed ponownym przeniesieniem.");
  // Look up the durable source-to-target key before creating even a vehicle record.
  let existing;
  try { existing = await context.db(`ovoko_single_publications?ovoko_account=eq.${account}&allegro_seller_id=eq.${owned.sellerId}&allegro_offer_id=eq.${source.id}&select=state,part_id&limit=1`); }
  catch { throw new OvokoError(503, "Nie potwierdzono rejestru przeniesien. Partie zatrzymano."); }
  if (!Array.isArray(existing) || existing.length > 1) throw new OvokoError(503, "Nieprawidlowy rejestr przeniesien.");
  if (existing.length) {
    if (existing[0].state === "created" && /^[1-9]\d{0,11}$/.test(String(existing[0].part_id))) return { ok: true, alreadyCreated: true, partId: String(existing[0].part_id) };
    throw new OvokoError(409, "Wysylka tej oferty jest rozpoczeta lub niepewna. Sprawdz Ovoko; nie ponawiamy.");
  }
  let price: string;
  try { price = adjustedOvokoPrice(source.price, source.currency, input.adjustment); } catch (error) { throw new OvokoError(400, (error as Error).message); }
  if (input.operation === "item") {
    const prepared = input.prepared as Record<string, unknown> | null;
    const keys = ["brandId", "modelId", "donorId", "categoryId", "qualityId", "statusId", "manufacturerCode", "additionalCodes"];
    if (!prepared || Array.isArray(prepared) || Object.keys(prepared).some(key => !keys.includes(key)) || keys.some(key => typeof prepared[key] !== "string")) throw new OvokoError(400, "Brak przygotowania pozycji. Nie wyslano czesci.");
    const result = await publishOvokoPart(request, env, context, { ...prepared, offerId: source.id, price, currency: source.currency, notes: source.description, confirmSingle: true, expectedSource: input.expectedSource }, { sellerId: owned.sellerId, fingerprint });
    return { ...result, price, currency: source.currency };
  }
  const remote = ovokoWriteClient(credentials), dictionaries: Record<string, OvokoReadRow[]> = {};
  for (const [operation, path] of [["categories", "/get/categories"], ["qualities", "/get/part_quality"], ["statuses", "/get/part_status"], ["brands", "/get/car_brands"]] as const) {
    const result = await remote(path);
    if (operation === "brands") {
      if (!Array.isArray(result.list) || result.list.some((row: any) => !/^[1-9]\d{0,11}$/.test(String(row?.id)) || typeof row?.name !== "string")) throw new OvokoError(502, "Nieprawidlowe marki Ovoko.");
      dictionaries.brands = result.list.map((row: any) => ({ id: String(row.id), name: row.name }));
    } else dictionaries[operation] = parseOvokoRead(operation, result).rows;
  }
  const brandId = automaticOvokoBrand(source.title, source.parameters, dictionaries.brands);
  if (!brandId) throw new OvokoError(400, "Nie rozpoznano marki. Przygotuj te oferte pojedynczo.");
  const models = parseOvokoRead("models", await remote(`/get/car_models/${brandId}`), brandId).rows;
  const modelId = automaticOvokoModel(vehicleSuggestionText(source.title, source.parameters), models);
  const model = models.find(row => row.id === modelId);
  const year = ovokoCarYear(source, model).year;
  const draft = { ...initialOvokoDraft(source), ...ovokoAutomaticFields(source, dictionaries), price, donorId: "1" };
  const blockers = ovokoPublicationBlockers(source, draft, brandId, modelId);
  if (!model || !year) blockers.push("Brak modelu lub roku auta do automatycznego przygotowania.");
  const category = dictionaries.categories.find(row => row.id === draft.categoryId);
  const categoryNames: string[] = []; let current = category;
  for (let i = 0; current && i < 4; i++) { categoryNames.push(current.name); current = dictionaries.categories.find(row => row.id === current!.parentId); }
  if (/opon|felg|tires|rims/i.test(categoryNames.join(" "))) blockers.push("Opony i felgi nie sa jeszcze obslugiwane.");
  if (blockers.length) throw new OvokoError(400, blockers.join(" "));
  const car = await createOvokoCar(request, env, context, { brandId, modelId, year, confirmCreate: true }, fingerprint);
  // Separate preparation (including car reuse/create) from part publication to bound Worker subrequests.
  return { ok: true, prepared: { brandId, modelId, donorId: car.carId, categoryId: draft.categoryId, qualityId: draft.qualityId, statusId: draft.statusId, manufacturerCode: draft.manufacturerCode, additionalCodes: draft.additionalCodes || "" }, price, currency: source.currency };
}
