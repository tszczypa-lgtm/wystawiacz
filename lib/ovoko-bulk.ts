import type { accountContext } from "./account-api";
import { handleAllegroApi } from "./allegro-api";
import { loadOvokoConnection, ovokoConnectionKey } from "./ovoko-connection";
import { publishOvokoPart, type OvokoPublishEnv } from "./ovoko-publish";
import { createOvokoCar } from "./ovoko-create-car";
import { initialOvokoDraft, ovokoPublicationBlockers, ovokoSourcePreview } from "./ovoko-preparation";
import { automaticOvokoBrand, automaticOvokoModel, ovokoAutomaticFields, ovokoModelHasConflict, suggestOvokoBrands, vehicleSuggestionText } from "./ovoko-suggestions";
import { ovokoCarYear } from "./ovoko-car-selection";
import { OvokoError, parseOvokoRead, type OvokoReadRow } from "./ovoko-read";
import { ovokoWriteClient, ovokoWriteDigest } from "./ovoko-write-client";
import { adjustedOvokoPrice, sameOvokoMoney, validateOvokoAdjustment } from "./ovoko-bulk-price";
import { matchOvokoFitment, type FitmentRow } from "./ovoko-fitment";

type Context = Awaited<ReturnType<typeof accountContext>>;
export async function bulkOvokoPart(request: Request, env: OvokoPublishEnv, context: Context, input: Record<string, unknown>) {
  if (env.OVOKO_PUBLISH_ENABLED !== "true") throw new OvokoError(503, "Publikacja Ovoko jest wylaczona.");
  if (!["start", "prepare", "item"].includes(String(input.operation)) || Object.keys(input).some(key => !["operation", "offerId", "adjustment", "binding", "notes", "expectedSource", "prepared", "fallbackVehicle"].includes(key))) throw new OvokoError(400, "Nieprawidlowa operacja przenoszenia.");
  const fallback = input.fallbackVehicle as { brandId: string; modelId: string } | undefined;
  if (fallback !== undefined && (!fallback || typeof fallback !== "object" || Array.isArray(fallback) || Object.keys(fallback).some(key => !["brandId", "modelId"].includes(key)) || typeof fallback.brandId !== "string" || !/^[1-9]\d{0,11}$/.test(fallback.brandId) || typeof fallback.modelId !== "string" || !/^[1-9]\d{0,11}$/.test(fallback.modelId))) throw new OvokoError(400, "Nieprawidlowy model pomocniczy.");
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
  const draft = { ...initialOvokoDraft(source), ...ovokoAutomaticFields(source, dictionaries), price, donorId: "1" };
  let brandId = automaticOvokoBrand(source.title, source.parameters, dictionaries.brands);
  const modelCache = new Map<string, OvokoReadRow[]>();
  const loadModels = async (brand: string) => {
    if (modelCache.has(brand)) return modelCache.get(brand)!;
    if (modelCache.size >= 6) return [];
    const rows = parseOvokoRead("models", await remote(`/get/car_models/${brand}`), brand).rows;
    modelCache.set(brand, rows); return rows;
  };
  let models = brandId ? await loadModels(brandId) : [];
  const vehicleText = vehicleSuggestionText(source.title, source.parameters);
  let modelId = automaticOvokoModel(vehicleText, models), usedFallback = false;
  const explicit = source.parameters.filter(row => /^(marka pojazdu|marka samochodu|marka auta|producent pojazdu|producent samochodu)$/i.test(row.name.trim())).flatMap(row => row.values);
  const mentioned = explicit.length ? suggestOvokoBrands(explicit.join(" "), dictionaries.brands) : suggestOvokoBrands(source.title, dictionaries.brands);
  if (explicit.length && !mentioned.length) throw new OvokoError(400, "Jawna marka pojazdu nie pasuje do slownika Ovoko. Nie zastapiono jej przypuszczeniem.");
  const allowedBrands = mentioned.length ? mentioned : dictionaries.brands.filter(row => row.id === brandId);
  let generationConflict = !modelId && models.some(row => ovokoModelHasConflict(vehicleText, row));
  const alternatives = allowedBrands.filter(row => row.id !== brandId);
  if (!modelId && alternatives.length > 5) throw new OvokoError(400, "Zbyt wiele marek do automatycznego sprawdzenia. Przygotuj oferte pojedynczo.");
  while (!modelId && alternatives.length) {
    const nextId = automaticOvokoBrand(source.title, source.parameters, alternatives) || alternatives[0].id;
    alternatives.splice(alternatives.findIndex(row => row.id === nextId), 1);
    const nextModels = await loadModels(nextId);
    const nextModel = automaticOvokoModel(vehicleText, nextModels);
    if (nextModel) { brandId = nextId; models = nextModels; modelId = nextModel; }
    else if (nextModels.some(row => ovokoModelHasConflict(vehicleText, row))) generationConflict = true;
  }
  let fitmentOrigin = "";
  if (!modelId || !draft.categoryId) {
    const fitment = await allegro(`/ovoko-fitment/${source.id}?expand=1${draft.manufacturerCode ? `&number=${encodeURIComponent(draft.manufacturerCode)}` : ""}`);
    if (fitment.offerId !== source.id || fitment.number !== draft.manufacturerCode || !Array.isArray(fitment.rows) || fitment.rows.length > 200 || fitment.rows.some((row: any) => typeof row?.text !== "string" || row.text.length > 2000 || !["offer", "suggestion", "catalog", "catalog-suggestion"].includes(row.origin)) || !Array.isArray(fitment.names) || fitment.names.some((name: unknown) => typeof name !== "string" || name.length > 500)) throw new OvokoError(502, "Niepotwierdzone dane automatycznego dopasowania.");
    if (!modelId) {
      const candidates = [...fitment.rows as FitmentRow[], ...fitment.names.map((text: string) => ({ text, origin: "catalog" }))];
      const matched = await matchOvokoFitment(candidates, dictionaries.brands, allowedBrands.map(row => row.id), vehicleText, loadModels);
      if (matched) { brandId = matched.brandId; modelId = matched.modelId; models = await loadModels(brandId); fitmentOrigin = matched.origin; }
    }
    if (!draft.categoryId && fitment.names.length) draft.categoryId = ovokoAutomaticFields({ ...source, title: `${source.title} ${fitment.names.join(" ")}` }, dictionaries).categoryId || "";
  }
  if (!modelId && fallback) {
    if (!allowedBrands.some(row => row.id === fallback.brandId)) throw new OvokoError(400, "Model pomocniczy nie pasuje do marek tej oferty. Wybierz model pojedynczo.");
    // Do not use a fallback to bypass an explicitly conflicting model generation.
    if (generationConflict) throw new OvokoError(400, "Model z tytulu ma sprzeczna generacje. Sprawdz oferte pojedynczo.");
    if (fallback.brandId !== brandId) models = await loadModels(fallback.brandId);
    const fallbackModel = models.find(row => row.id === fallback.modelId);
    if (!fallbackModel) throw new OvokoError(400, "Model pomocniczy nie nalezy do wybranej marki Ovoko.");
    if (ovokoModelHasConflict(vehicleText, fallbackModel)) throw new OvokoError(400, "Model pomocniczy ma sprzeczna generacje z tytulem. Nie utworzono auta.");
    brandId = fallback.brandId; modelId = fallback.modelId; usedFallback = true;
  }
  const model = models.find(row => row.id === modelId);
  const year = ovokoCarYear(source, model).year;
  const blockers = ovokoPublicationBlockers(source, draft, brandId, modelId);
  if (!model || !year) blockers.push(draft.manufacturerCode ? `Automat nie znalazl modelu Ovoko w danych oferty ani w Pasuje do/katalogu dla pelnego numeru ${draft.manufacturerCode}. Nie wybrano przypadkowego auta.` : "Ta czesc moze byc wystawiona bez numeru, ale brakuje dopasowanego modelu auta w danych oferty i Pasuje do. Nie utworzono przypadkowego auta.");
  const category = dictionaries.categories.find(row => row.id === draft.categoryId);
  const categoryNames: string[] = []; let current = category;
  for (let i = 0; current && i < 4; i++) { categoryNames.push(current.name); current = dictionaries.categories.find(row => row.id === current!.parentId); }
  if (/opon|felg|tires|rims/i.test(categoryNames.join(" "))) blockers.push("Opony i felgi nie sa jeszcze obslugiwane.");
  if (blockers.length) throw new OvokoError(400, blockers.join(" "));
  const car = await createOvokoCar(request, env, context, { brandId, modelId, year, confirmCreate: true }, fingerprint);
  // Separate preparation (including car reuse/create) from part publication to bound Worker subrequests.
  return { ok: true, vehicle: { brand: dictionaries.brands.find(row => row.id === brandId)?.name || brandId, model: model!.name, usedFallback, evidence: fitmentOrigin ? fitmentOrigin.startsWith("catalog") ? "Katalog Allegro - pelny MPN" : "Pasuje do Allegro" : "Dane oferty" }, prepared: { brandId, modelId, donorId: car.carId, categoryId: draft.categoryId, qualityId: draft.qualityId, statusId: draft.statusId, manufacturerCode: draft.manufacturerCode, additionalCodes: draft.additionalCodes || "" }, price, currency: source.currency };
}
