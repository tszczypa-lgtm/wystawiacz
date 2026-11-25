import type { accountContext } from "./account-api";
import { handleAllegroApi } from "./allegro-api";
import { loadOvokoConnection, ovokoConnectionKey } from "./ovoko-connection";
import { publishOvokoPart, type OvokoPublishEnv } from "./ovoko-publish";
import { createOvokoCar } from "./ovoko-create-car";
import { workspaceVehicleOvoko } from "./workspace-vehicle-ovoko";
import { workspaceVehicleId } from "./workspace-vehicles";
import { initialOvokoDraft, ovokoPublicationBlockers, ovokoSourcePreview, validOvokoCode } from "./ovoko-preparation";
import { automaticOvokoBrand, automaticOvokoModel, ovokoAutomaticFields, ovokoModelHasConflict, suggestOvokoBrands, vehicleSuggestionText } from "./ovoko-suggestions";
import { ovokoCarYear } from "./ovoko-car-selection";
import { OvokoError, parseOvokoRead, type OvokoReadRow } from "./ovoko-read";
import { ovokoWriteClient, ovokoWriteDigest } from "./ovoko-write-client";
import { adjustedOvokoPrice, sameOvokoMoney, validateOvokoAdjustment } from "./ovoko-bulk-price";
import { matchOvokoFitment, type FitmentRow } from "./ovoko-fitment";
import { createdPublication, ovokoPublicationPresent } from "./ovoko-publication-presence";
import { publicationStockMode, readStockPublication, checkStockPublication, stockPublicationResult } from "./ovoko-stock-publication";
import { cachedOvokoYearEvidence, yearAllegroReader } from "./ovoko-year-suggestion";
import type { YearEvidence } from "./ovoko-year-evidence";
import { lookupWebFitment, selectWebVehicle, webVehicleMismatchMessage } from "./ovoko-web-fitment";

type Context = Awaited<ReturnType<typeof accountContext>>;
export async function bulkOvokoPart(request: Request, env: OvokoPublishEnv, context: Context, input: Record<string, unknown>) {
  if (env.OVOKO_PUBLISH_ENABLED !== "true") throw new OvokoError(503, "Publikacja Ovoko jest wylaczona.");
  if (!["start", "prepare", "item"].includes(String(input.operation)) || Object.keys(input).some(key => !["operation", "offerId", "adjustment", "binding", "notes", "expectedSource", "prepared", "fallbackVehicle", "overrides", "allowTechnicalModel", "manualVehicle", "stockMode", "workspaceVehicleId"].includes(key))) throw new OvokoError(400, "Nieprawidlowa operacja przenoszenia.");
  if (input.workspaceVehicleId !== undefined && !workspaceVehicleId(input.workspaceVehicleId)) throw new OvokoError(400, "Nieprawidlowy samochod z biblioteki.");
  const stockMode = publicationStockMode(input.stockMode);
  if (input.manualVehicle !== undefined && typeof input.manualVehicle !== "boolean") throw new OvokoError(400, "Nieprawidlowy wybor reczny.");
  if (input.allowTechnicalModel !== undefined && typeof input.allowTechnicalModel !== "boolean") throw new OvokoError(400, "Nieprawidlowy tryb modelu roboczego.");
  const overrides = input.overrides as Record<string, unknown> | undefined;
  if (overrides !== undefined && (!overrides || typeof overrides !== "object" || Array.isArray(overrides) || Object.keys(overrides).some(key => !["categoryId", "manufacturerCode"].includes(key)) || Object.values(overrides).some(value => typeof value !== "string") || (overrides.categoryId !== undefined && !/^[1-9]\d{0,11}$/.test(String(overrides.categoryId))) || (overrides.manufacturerCode !== undefined && overrides.manufacturerCode !== "" && !validOvokoCode(String(overrides.manufacturerCode))))) throw new OvokoError(400, "Sprawdz reczne uzupelnienie kategorii lub numeru.");
  const fallback = input.fallbackVehicle as { brandId: string; modelId: string; year?: string } | undefined;
  if (fallback !== undefined && (!fallback || typeof fallback !== "object" || Array.isArray(fallback) || Object.keys(fallback).some(key => !["brandId", "modelId", "year"].includes(key)) || typeof fallback.brandId !== "string" || !/^[1-9]\d{0,11}$/.test(fallback.brandId) || typeof fallback.modelId !== "string" || !/^[1-9]\d{0,11}$/.test(fallback.modelId) || fallback.year !== undefined && (typeof fallback.year !== "string" || !/^\d{4}$/.test(fallback.year) || Number(fallback.year)<1886 || Number(fallback.year)>new Date().getUTCFullYear()+1))) throw new OvokoError(400, "Nieprawidlowy model lub rok auta.");
  if (input.manualVehicle === true && !fallback) throw new OvokoError(400, "Wybierz model auta.");
  try { validateOvokoAdjustment(input.adjustment); } catch (error) { throw new OvokoError(400, (error as Error).message); }
  if (input.operation !== "start" && (typeof input.offerId !== "string" || !/^\d{1,30}$/.test(input.offerId) || typeof input.notes !== "string" || input.notes.length > 40000 || /\0/.test(input.notes))) throw new OvokoError(400, "Nieprawidlowe dane oferty.");
  const credentials = await loadOvokoConnection(context, await ovokoConnectionKey(env));
  const fingerprint = await ovokoWriteDigest(JSON.stringify(credentials));
  const account = await ovokoWriteDigest(credentials.username.trim().toLowerCase());
  const allegro = async (path: string) => {
    const result = await handleAllegroApi(new Request(`${new URL(request.url).origin}/api/allegro${path}`, { headers: { Authorization: request.headers.get("Authorization")! } }), env);
    const body = await result.json() as Record<string, unknown>;
    if (!result.ok) throw new OvokoError(result.status, typeof body.message === "string" ? body.message : "Nie odczytano oferty Allegro.");
    return body;
  };
  if (input.operation === "start") {
    const { sellerId } = await allegro("/seller-identity");
    if (typeof sellerId !== "string" || !/^\d{1,30}$/.test(sellerId)) throw new OvokoError(502, "Nie potwierdzono sprzedawcy.");
    return { ok: true, binding: { sellerId, fingerprint } };
  }
  const owned = await allegro(`/ovoko-source/${input.offerId}`);
  if (typeof owned.sellerId !== "string" || !/^\d{1,30}$/.test(owned.sellerId)) throw new OvokoError(502, "Nie potwierdzono sprzedawcy oferty.");
  const binding = input.binding as Record<string, unknown> | null;
  if (!binding || binding.sellerId !== owned.sellerId || binding.fingerprint !== fingerprint) throw new OvokoError(409, "Polaczone konto zmienilo sie. Zatrzymano partie; rozpocznij ja ponownie po sprawdzeniu kont.", "account_changed");
  const source = ovokoSourcePreview(owned.offer, input.offerId as string, () => input.notes as string);
  const expected = input.expectedSource as Record<string, unknown> | null;
  if (!expected || !sameOvokoMoney(expected.price, source.price) || ["title", "currency", "stock", "status", "condition"].some(key => expected[key] !== source[key as keyof typeof source]) || JSON.stringify(expected.images) !== JSON.stringify(source.images)) throw new OvokoError(409, "Oferta Allegro zmienila sie. Sprawdz dane przed ponownym przeniesieniem.");
  let price: string;
  try { price = adjustedOvokoPrice(source.price, source.currency, input.adjustment); } catch (error) { throw new OvokoError(400, (error as Error).message); }
  const workspaceCar = input.workspaceVehicleId ? await workspaceVehicleOvoko(request, env, context, input.workspaceVehicleId) : null;
  if (input.operation === "item") {
    const prepared = input.prepared as Record<string, unknown> | null;
    const keys = ["brandId", "modelId", "donorId", "categoryId", "qualityId", "statusId", "manufacturerCode", "additionalCodes"];
    if (!prepared || Array.isArray(prepared) || Object.keys(prepared).some(key => !keys.includes(key)) || keys.some(key => typeof prepared[key] !== "string")) throw new OvokoError(400, "Brak przygotowania pozycji. Nie wyslano czesci.");
    if (workspaceCar) {
      if (prepared.donorId !== workspaceCar.carId || prepared.brandId !== workspaceCar.brandId || prepared.modelId !== workspaceCar.modelId) throw new OvokoError(409, "Czesc nie jest przypisana do wybranego samochodu.");
    }
    // Publication owns the item precheck; do not page a large group twice in one Worker request.
    const result = await publishOvokoPart(request, env, context, { ...prepared, offerId: source.id, price, currency: source.currency, notes: source.description, confirmSingle: true, expectedSource: input.expectedSource, stockMode }, { sellerId: owned.sellerId, fingerprint });
    return { ...result, price, currency: source.currency };
  }
  // Look up the durable source-to-target key before creating even a vehicle record.
  const stock = await readStockPublication(context, account, owned.sellerId, source.id);
  if (stock) {
    checkStockPublication(stock, source.stock, stockMode);
    if (!stock.units.some(unit => unit.state === "pending")) return stockPublicationResult(stock, undefined, true);
  }
  let existing;
  try { existing = await context.db(`ovoko_single_publications?ovoko_account=eq.${account}&allegro_seller_id=eq.${owned.sellerId}&allegro_offer_id=eq.${source.id}&owner_id=eq.${context.user.id}&select=state,part_id,request_hash,updated_at,owner_id`); }
  catch { throw new OvokoError(503, "Nie potwierdzono rejestru przeniesien. Partie zatrzymano."); }
  if (!Array.isArray(existing) || existing.length > 1) throw new OvokoError(503, "Nieprawidlowy rejestr przeniesien.");
  if (existing.length) {
    if (stock || source.stock! >= 2) throw new OvokoError(409, "Oferta ma juz pojedyncza publikacje. Nie mozna utworzyc grupy zapasu.", "stock_publication_locked");
    if (["sending", "uncertain"].includes(existing[0]?.state)) throw new OvokoError(409, "Do sprawdzenia w Ovoko: poprzednia wysylka tej oferty jest rozpoczeta lub niepewna. Nie ponawiamy tej czesci; pozostale pozycje moga isc dalej.", "publication_locked");
    if (existing[0]?.state !== "created") throw new OvokoError(503, "Nieprawidlowy stan rejestru publikacji. Nie wyslano czesci.");
    const row = createdPublication(existing[0], context.user.id);
    if (await ovokoPublicationPresent(ovokoWriteClient(credentials), row.part_id, `tymo:${owned.sellerId}:${source.id}`)) return { ok: true, alreadyCreated: true, partId: row.part_id };
    // Preparation never releases a journal entry. publishOvokoPart rechecks and atomically reserves it.
  }
  const remote = ovokoWriteClient(credentials), dictionaries: Record<string, OvokoReadRow[]> = {};
  for (const [operation, path] of [["categories", "/get/categories"], ["qualities", "/get/part_quality"], ["statuses", "/get/part_status"], ["brands", "/get/car_brands"]] as const) {
    const result = await remote(path);
    if (operation === "brands") {
      if (!Array.isArray(result.list) || result.list.some((row: Record<string, unknown>) => !/^[1-9]\d{0,11}$/.test(String(row?.id)) || typeof row?.name !== "string")) throw new OvokoError(502, "Nieprawidlowe marki Ovoko.");
      dictionaries.brands = result.list.map((row: Record<string, unknown>) => ({ id: String(row.id), name: String(row.name) }));
    } else dictionaries[operation] = parseOvokoRead(operation, result).rows;
  }
  const draft = { ...initialOvokoDraft(source), ...ovokoAutomaticFields(source, dictionaries), price, donorId: "1" };
  if (overrides?.categoryId !== undefined) {
    if (!dictionaries.categories.some(row => row.id === overrides.categoryId && row.level === "3")) throw new OvokoError(400, "Wybierz kategorie koncowa Ovoko z listy.");
    draft.categoryId = overrides.categoryId as string;
  }
  if (overrides?.manufacturerCode !== undefined) draft.manufacturerCode = overrides.manufacturerCode as string;
  if (workspaceCar) {
    const car = workspaceCar;
    draft.donorId = car.carId;
    const blockers = ovokoPublicationBlockers(source, draft, car.brandId, car.modelId);
    const category = dictionaries.categories.find(row => row.id === draft.categoryId && row.level === "3");
    if (!category) blockers.push("Wybierz kategorie Ovoko dla tej czesci.");
    if (blockers.length) throw new OvokoError(400, blockers.join(" "), "preparation_incomplete");
    return { ok: true, prepared: { brandId: car.brandId, modelId: car.modelId, donorId: car.carId, categoryId: draft.categoryId, qualityId: draft.qualityId, statusId: draft.statusId, manufacturerCode: draft.manufacturerCode, additionalCodes: draft.additionalCodes || "" }, price, currency: source.currency };
  }
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
  if (input.manualVehicle === true && fallback) {
    if (allowedBrands.length && !allowedBrands.some(row => row.id === fallback.brandId)) throw new OvokoError(400, "Wybrana marka nie pasuje do oferty.");
    models = await loadModels(fallback.brandId);
    if (!models.some(row => row.id === fallback.modelId)) throw new OvokoError(400, "Wybrany model nie nalezy do marki.");
    brandId = fallback.brandId; modelId = fallback.modelId; usedFallback = true;
  }
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
  let fitmentOrigin = input.manualVehicle === true ? "manual" : "";
  let fitmentRows: FitmentRow[] | undefined;
  let exactVehicleText = "";
  if (input.manualVehicle !== true && (draft.manufacturerCode || !modelId || !draft.categoryId)) {
    const lookupCode = draft.manufacturerCode.replace(/-/g, "");
    let fitment: Record<string, unknown> | undefined;
    try { fitment = await allegro(`/ovoko-fitment/${source.id}?expand=1${lookupCode ? `&number=${encodeURIComponent(lookupCode)}` : ""}`); }
    catch (error) { if (!modelId || !draft.categoryId) throw error; }
    if (fitment) {
      if (fitment.offerId !== source.id || fitment.number !== lookupCode || !Array.isArray(fitment.rows) || fitment.rows.length > 200 || fitment.rows.some((row: Record<string, unknown>) => typeof row?.text !== "string" || row.text.length > 2000 || !["offer", "suggestion", "catalog", "catalog-suggestion"].includes(String(row.origin))) || !Array.isArray(fitment.names) || fitment.names.some((name: unknown) => typeof name !== "string" || name.length > 500)) throw new OvokoError(502, "Niepotwierdzone dane automatycznego dopasowania.");
      fitmentRows = fitment.rows as FitmentRow[];
      // Only accepted full-MPN catalogue records may overrule the seller's title.
      const exactRows = lookupCode ? [...fitmentRows.filter(row => row.origin === "catalog" || row.origin === "catalog-suggestion"), ...fitment.names.map((text: string) => ({ text, origin: "catalog" }))] : [];
      const exactMatch = await matchOvokoFitment(exactRows, dictionaries.brands, allowedBrands.map(row => row.id), "", loadModels, true);
      if (exactMatch) {
        brandId = exactMatch.brandId; modelId = exactMatch.modelId; models = await loadModels(brandId);
        fitmentOrigin = exactMatch.origin; exactVehicleText = exactMatch.text; usedFallback = false;
        fitmentRows = exactRows;
      } else if (!modelId) {
        const candidates = [...fitment.rows as FitmentRow[], ...fitment.names.map((text: string) => ({ text, origin: "catalog" }))];
        const matched = await matchOvokoFitment(candidates, dictionaries.brands, allowedBrands.map(row => row.id), vehicleText, loadModels);
        if (matched) { brandId = matched.brandId; modelId = matched.modelId; models = await loadModels(brandId); fitmentOrigin = matched.origin; }
      }
      if (!draft.categoryId && fitment.names.length) draft.categoryId = ovokoAutomaticFields({ ...source, title: `${source.title} ${fitment.names.join(" ")}` }, dictionaries).categoryId || "";
    }
  }
  if (!modelId && fallback) {
    if (allowedBrands.length && !allowedBrands.some(row => row.id === fallback.brandId)) throw new OvokoError(400, "Model pomocniczy nie pasuje do marek tej oferty. Wybierz model pojedynczo.");
    // Do not use a fallback to bypass an explicitly conflicting model generation.
    if (generationConflict) throw new OvokoError(400, "Model z tytulu ma sprzeczna generacje. Sprawdz oferte pojedynczo.");
    if (fallback.brandId !== brandId) models = await loadModels(fallback.brandId);
    const fallbackModel = models.find(row => row.id === fallback.modelId);
    if (!fallbackModel) throw new OvokoError(400, "Model pomocniczy nie nalezy do wybranej marki Ovoko.");
    if (ovokoModelHasConflict(vehicleText, fallbackModel)) throw new OvokoError(400, "Model pomocniczy ma sprzeczna generacje z tytulem. Nie utworzono auta.");
    brandId = fallback.brandId; modelId = fallback.modelId; usedFallback = true;
  }
  if (!modelId && input.allowTechnicalModel === true && !generationConflict && brandId && allowedBrands.some(row => row.id === brandId)) {
    // Explicit batch preference: a real dictionary model, not verified fitment or a physical donor.
    models = await loadModels(brandId);
    const technical = [...models].sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true })).find(row => !ovokoModelHasConflict(vehicleText, row) && ovokoCarYear(source, row).year);
    if (technical) { modelId = technical.id; fitmentOrigin = "technical"; }
  }
  let model = models.find(row => row.id === modelId);
  const yearSource = exactVehicleText ? { ...source, title: exactVehicleText, description: "", parameters: [] } : source;
  let year = input.manualVehicle === true && fallback?.year ? fallback.year : ovokoCarYear(yearSource, model).year;
  let savedCar: OvokoReadRow | undefined;
  if (model && !year) savedCar = parseOvokoRead("cars", await remote(`/v2/get/cars?model_ids=${modelId}&page=1&limit=20`), modelId).rows[0];
  let yearEvidence: YearEvidence | null = null;
  const lookupNumber = draft.manufacturerCode.replace(/-/g, "");
  let brand = dictionaries.brands.find(row => row.id === brandId);
  if (model && brand && !year && !savedCar && lookupNumber) {
    try {
      yearEvidence = await cachedOvokoYearEvidence(`${context.user.id}:${owned.sellerId}:${fingerprint}:${source.id}:${source.categoryId}:${lookupNumber}:${brandId}:${modelId}`, { source: yearSource, number: lookupNumber, brand, model, models, fitmentRows, allegro: yearAllegroReader(request, env), ovoko: remote });
      year = yearEvidence?.year || "";
    } catch { /* Missing optional evidence never invents a year or stops unrelated batch rows. */ }
  }
  let webMessage = "";
  const readyForVehicleLookup = ovokoPublicationBlockers(source, draft, brandId || "1", modelId || "1").length === 0;
  if (input.manualVehicle !== true && lookupNumber && readyForVehicleLookup && (!model || !year && !savedCar || fitmentOrigin === "technical")) {
    const web = await lookupWebFitment(env, context.user.id, lookupNumber, brand?.name);
    if (web.pending) return {ok:true,webPending:true,retryAfter:web.retryAfter||5,message:web.message};
    const matched = await selectWebVehicle(web.matches, dictionaries.brands, allowedBrands.map(row => row.id), loadModels, modelId);
    if (matched) {
      brandId = matched.brandId; modelId = matched.modelId; models = await loadModels(brandId);
      model = models.find(row => row.id === modelId); brand = dictionaries.brands.find(row => row.id === brandId);
      year = matched.year; savedCar = undefined; usedFallback = false; fitmentOrigin = "web";
      exactVehicleText = "";
      yearEvidence = { year, technical: true, source: "web-search", sourceUrl: matched.sourceUrl, reason: `Internet / OpenAI: pelny numer ${lookupNumber}, ${matched.make} ${matched.model}, rok techniczny ${year}. Publiczna oferta, nie potwierdza rocznika dawcy ani pelnej zgodnosci.` };
    } else webMessage = web.message || webVehicleMismatchMessage(web.matches);
  }
  const blockers = ovokoPublicationBlockers(source, draft, brandId, modelId);
  if (!model || !year && !savedCar) blockers.push((model ? "Wybrano model, ale nie znaleziono roku dla pelnego numeru czesci. Podaj rok w uzupelnieniu tej pozycji." : "Nie rozpoznano modelu. Wybierz model ponizej; kategoria i cena zostaja bez zmian.") + (webMessage ? ` ${webMessage}` : ""));
  const category = dictionaries.categories.find(row => row.id === draft.categoryId);
  const categoryNames: string[] = []; let current = category;
  for (let i = 0; current && i < 4; i++) { categoryNames.push(current.name); current = dictionaries.categories.find(row => row.id === current!.parentId); }
  if (/opon|felg|tires|rims/i.test(categoryNames.join(" "))) blockers.push("Opony i felgi nie sa jeszcze obslugiwane.");
  if (blockers.length) throw new OvokoError(400, blockers.join(" "), "preparation_incomplete", { needsVehicle: !model || !year && !savedCar, needsYear: !!model && !year && !savedCar, needsCategory: !category || category.level !== "3", brandId, categoryId: category?.level === "3" ? category.id : "", ...(model ? { vehicle: { brandId, modelId, year } } : {}) });
  let car: { carId: string };
  try { car = savedCar ? { carId: savedCar.id } : await createOvokoCar(request, env, context, { brandId, modelId, year, confirmCreate: true }, fingerprint); }
  catch (e) { if (e instanceof OvokoError && e.code === "vehicle_creation_locked") e.repair = { needsVehicle: false, needsCategory: false, brandId, categoryId: draft.categoryId, vehicle: { brandId, modelId, year } }; throw e; }
  // Separate preparation (including car reuse/create) from part publication to bound Worker subrequests.
  const modelEvidence = exactVehicleText ? `Katalog Allegro - pelny MPN ${lookupNumber}; dopasowanie: ${exactVehicleText}` : fitmentOrigin === "web" ? "Wyszukiwanie internetowe pelnego numeru" : fitmentOrigin === "manual" ? "Wybor reczny" : fitmentOrigin === "technical" ? "Model roboczy marki - zgodnosc niepotwierdzona" : fitmentOrigin ? fitmentOrigin.startsWith("catalog") ? "Katalog Allegro - pelny MPN" : "Pasuje do Allegro" : "Dane oferty";
  return { ok: true, category: { id: draft.categoryId, name: categoryNames.slice().reverse().join(" / ") }, vehicle: { brand: brand?.name || brandId, model: model!.name, usedFallback, evidence: `${modelEvidence}${yearEvidence ? `. ${yearEvidence.reason}` : ""}`, ...(yearEvidence ? { year, yearSource: yearEvidence.source, sourceUrl: yearEvidence.sourceUrl } : {}) }, prepared: { brandId, modelId, donorId: car.carId, categoryId: draft.categoryId, qualityId: draft.qualityId, statusId: draft.statusId, manufacturerCode: draft.manufacturerCode, additionalCodes: draft.additionalCodes || "" }, price, currency: source.currency };
}
