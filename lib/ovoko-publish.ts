import { accountContext, type AccountEnv } from "./account-api";
import { handleAllegroApi } from "./allegro-api";
import { loadOvokoConnection, ovokoConnectionKey, type OvokoKeyEnv } from "./ovoko-connection";
import { ovokoSourcePreview, additionalOvokoCodes, validOvokoCode } from "./ovoko-preparation";
import { ovokoAutomaticFields } from "./ovoko-suggestions";
import { OvokoError, parseOvokoRead, ovokoPageData } from "./ovoko-read";
import { ovokoWriteClient, ovokoWriteDigest as digest, ovokoRemoteDiagnosis } from "./ovoko-write-client";
import { sameOvokoMoney } from "./ovoko-bulk-price";
import { requireOvokoAccess } from "./ovoko-access";
import { createdPublication, ovokoPublicationPresent, publicationCas, type CreatedPublication } from "./ovoko-publication-presence";
import { publicationStockMode, readStockPublication, checkStockPublication, stockPublicationResult, prepareStockPublication, publishStockUnit } from "./ovoko-stock-publication";
import {ovokoWheelFields,validateWheelInput} from "./ovoko-wheel-fields";

type Context = Awaited<ReturnType<typeof accountContext>>;
export type OvokoPublishEnv = AccountEnv & OvokoKeyEnv & Parameters<typeof handleAllegroApi>[1] & { OVOKO_PUBLISH_ENABLED?: string; OPENAI_API_KEY?: string; OVOKO_WEB_YEAR_ENABLED?: string; OVOKO_WEB_YEAR_MODEL?: string };
function text(input: Record<string, unknown>, key: string, pattern: RegExp, max = 255) {
  const value = input[key];
  if (typeof value !== "string" || !value || value.length > max || !pattern.test(value)) throw new OvokoError(400, `Sprawdz pole ${key}.`);
  return value;
}
export async function publishOvokoPart(request: Request, env: OvokoPublishEnv, context: Context, input: Record<string, unknown>, binding?: { sellerId: string; fingerprint: string }) {
  if (env.OVOKO_PUBLISH_ENABLED !== "true") throw new OvokoError(503, "Publikacja pojedyncza jest wylaczona. Wykonaj migracje 012 i ustaw OVOKO_PUBLISH_ENABLED=true w Cloudflare.");
  if (input.confirmSingle !== true) throw new OvokoError(400, "Uruchom pojedyncza wysylke przyciskiem Wystaw.");
  if (Object.keys(input).some(key => !["offerId", "brandId", "modelId", "donorId", "categoryId", "qualityId", "statusId", "manufacturerCode", "additionalCodes", "price", "currency", "notes", "confirmSingle", "shippingConfirmed", "donorConfirmed", "expectedSource", "stockMode", "binding", "wheel"].includes(key))) throw new OvokoError(400, "Nieobslugiwane pole publikacji.");
  validateWheelInput(input.wheel);
  const submittedBinding = input.binding as { sellerId: string; fingerprint: string } | undefined;
  if (submittedBinding !== undefined && (!submittedBinding || typeof submittedBinding !== "object" || Array.isArray(submittedBinding) || Object.keys(submittedBinding).some(key => !["sellerId", "fingerprint"].includes(key)) || !/^\d{1,30}$/.test(submittedBinding.sellerId) || !/^[a-f0-9]{64}$/.test(submittedBinding.fingerprint))) throw new OvokoError(400, "Nieprawidlowe powiazanie kont transferu.");
  if (binding && submittedBinding && (binding.sellerId !== submittedBinding.sellerId || binding.fingerprint !== submittedBinding.fingerprint)) throw new OvokoError(409, "Konto transferu zmienilo sie.", "account_changed");
  binding = binding || submittedBinding;
  const stockMode = publicationStockMode(input.stockMode);
  const offerId = text(input, "offerId", /^\d{1,30}$/), donorId = text(input, "donorId", /^[1-9]\d{0,11}$/);
  const brandId = text(input, "brandId", /^[1-9]\d{0,11}$/), modelId = text(input, "modelId", /^[1-9]\d{0,11}$/);
  const categoryId = text(input, "categoryId", /^[1-9]\d{0,11}$/), qualityId = text(input, "qualityId", /^\d{1,12}$/), statusId = text(input, "statusId", /^\d{1,12}$/);
  let code = input.manufacturerCode === undefined || input.manufacturerCode === "" ? "" : text(input, "manufacturerCode", /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/);
  if (code && !validOvokoCode(code)) throw new OvokoError(400, "Nieprawidlowy pelny numer czesci.");
  const price = text(input, "price", /^\d{1,10}(\.\d{1,2})?$/, 30), currency = text(input, "currency", /^(PLN|EUR)$/);
  if (input.additionalCodes !== undefined && typeof input.additionalCodes !== "string") throw new OvokoError(400, "Nieprawidlowe numery dodatkowe.");
  const optionalCodes = additionalOvokoCodes((input.additionalCodes as string | undefined) || "", code);
  if (!optionalCodes) throw new OvokoError(400, "Sprawdz numery dodatkowe: maksymalnie 20 pelnych oznaczen.");
  if (Number(price) <= 0 || typeof input.notes !== "string" || input.notes.length > 40000 || /\0/.test(input.notes)) throw new OvokoError(400, "Sprawdz cene i opis.");
  const sourceRequest = new Request(`${new URL(request.url).origin}/api/allegro/ovoko-source/${offerId}`, { headers: { Authorization: request.headers.get("Authorization")! } });
  const sourceResponse = await handleAllegroApi(sourceRequest, env);
  if (!sourceResponse.ok) throw new OvokoError(409, "Nie potwierdzono aktualnej oferty na polaczonym koncie Allegro. Odswiez podglad.");
  const owned = await sourceResponse.json() as { offer: unknown; sellerId: string };
  if (typeof owned.sellerId !== "string" || !/^\d{1,30}$/.test(owned.sellerId)) throw new OvokoError(502, "Niepotwierdzony sprzedawca Allegro.");
  if (binding && owned.sellerId !== binding.sellerId) throw new OvokoError(409, "Konto Allegro zmienilo sie. Nie wyslano czesci.", "account_changed");
  const source = ovokoSourcePreview(owned.offer, offerId, () => "");
  const recognized = ovokoAutomaticFields(source, {}).manufacturerCode;
  if (code && recognized && code.replace(/-/g, "") === recognized.replace(/-/g, "")) code = recognized;
  // Ovoko's primary-code normalization must not erase the only hyphenated variant.
  const writtenCode = code;
  code = code.replace(/-/g, "");
  if (writtenCode !== code && !optionalCodes.includes(writtenCode)) optionalCodes.unshift(writtenCode);
  if (optionalCodes.includes(code)) optionalCodes.splice(optionalCodes.indexOf(code), 1);
  if (optionalCodes.length > 20) throw new OvokoError(400, "Maksymalnie 20 numerow dodatkowych.");
  if (source.status !== "ACTIVE" || !Number.isInteger(source.stock) || source.stock! < 1 || source.stock! > 10000 || source.bundle) throw new OvokoError(409, "Wymagana aktywna oferta z 1-10000 sztuk, bez zestawu. Nie wyslano czesci.");
  const expected = input.expectedSource as Record<string, unknown> | null;
  if(expected?.stockUnit!==undefined&&expected.stockUnit!==source.stockUnit)throw new OvokoError(409,"Zmienila sie jednostka sprzedazy Allegro. Odswiez dane.");
  if (!expected || !sameOvokoMoney(expected.price, source.price) || ["title", "currency", "stock", "status", "condition"].some(key => expected[key] !== source[key as keyof typeof source]) || JSON.stringify(expected.images) !== JSON.stringify(source.images)) throw new OvokoError(409, "Oferta Allegro zmienila sie od otwarcia podgladu. Odswiez dane i sprawdz ponownie.");
  if (!source.images.length || source.rejectedImages) throw new OvokoError(400, "Zdjecia sa niepelne lub zawieraja nieobslugiwane adresy. Sprawdz oferte przed pierwsza proba.");
  const credentials = await loadOvokoConnection(context, await ovokoConnectionKey(env));
  const fingerprint = await digest(JSON.stringify(credentials));
  if (binding && fingerprint !== binding.fingerprint) throw new OvokoError(409, "Konto Ovoko zmienilo sie. Nie wyslano czesci.", "account_changed");
  const remote = ovokoWriteClient(credentials);
  const account = await digest(credentials.username.trim().toLowerCase()), seller = owned.sellerId;
  let stock = await readStockPublication(context, account, seller, offerId);
  if (stock) {
    checkStockPublication(stock, source.stock, stockMode);
    if (!stock.units.some(unit => unit.state === "pending")) return { ...stockPublicationResult(stock, undefined, true), binding: { sellerId: seller, fingerprint } };
  }
  const multi = !!stock || source.stock! >= 2;
  const selector = `ovoko_account=eq.${account}&allegro_seller_id=eq.${seller}&allegro_offer_id=eq.${offerId}`;
  const db = async (query: string, options?: RequestInit) => {
    try { return await context.db(`ovoko_single_publications${query}`, options); }
    catch { throw new OvokoError(503, "Nie potwierdzono rejestru publikacji. Sprawdz migracje 012; nie ponawiaj wysylki bez sprawdzenia Ovoko."); }
  };
  const existing = await db(`?${selector}&owner_id=eq.${context.user.id}&select=state,part_id,request_hash,updated_at,owner_id`);
  if (!Array.isArray(existing) || existing.length > 1) throw new OvokoError(503, "Nieprawidlowy rejestr publikacji.");
  const externalId = multi ? stock?.units.find(unit => unit.state === "pending")?.external_id || `tymo:${seller}:${offerId}:u:1` : `tymo:${seller}:${offerId}`;
  let retransfer: CreatedPublication | undefined;
  if (existing.length) {
    if (multi) throw new OvokoError(409, "Oferta ma juz pojedyncza publikacje. Nie mozna utworzyc grupy zapasu.", "stock_publication_locked");
    if (existing[0]?.state !== "created") throw new OvokoError(409, "Ta oferta ma juz rozpoczeta lub niepewna probe wysylki. Sprawdz Ovoko; blokujemy ponowienie, aby nie utworzyc duplikatu.");
    retransfer = createdPublication(existing[0], context.user.id);
    if (await ovokoPublicationPresent(remote, retransfer.part_id, externalId)) return { ok: true, partId: retransfer.part_id, alreadyCreated: true, visibilityConfirmed: false };
  }
  try {
    const categories = parseOvokoRead("categories", await remote("/get/categories")).rows;
    const category = categories.find(row => row.id === categoryId && row.level === "3");
    if (!category) throw new OvokoError(400, "Niepotwierdzona kategoria Ovoko poziomu 3.");
    const categoryNames = [category.name]; let parent = category.parentId;
    for (let i = 0; parent && parent !== "0" && i < 3; i++) { const row = categories.find(item => item.id === parent); if (!row) break; categoryNames.push(row.name); parent = row.parentId; }
    const wheel=await ovokoWheelFields(source,categories,categoryId,remote,input.wheel);
    const qualities = parseOvokoRead("qualities", await remote("/get/part_quality")).rows;
    if (!qualities.some(row => row.id === qualityId)) throw new OvokoError(400, "Niepotwierdzony stan czesci Ovoko.");
    const statuses = parseOvokoRead("statuses", await remote("/get/part_status")).rows;
    if (!statuses.some(row => row.id === statusId && ["na stanie", "in stock"].includes(row.name.trim().toLowerCase()))) throw new OvokoError(400, "Pierwsza proba wymaga statusu Na stanie z aktualnego slownika Ovoko.");
    const models = parseOvokoRead("models", await remote(`/get/car_models/${brandId}`), brandId).rows;
    if (!models.some(row => row.id === modelId)) throw new OvokoError(400, "Model nie nalezy do wybranej marki Ovoko.");
    const cars = await remote(`/v2/get/cars?car_ids=${donorId}&page=1&limit=1`);
    if (!Array.isArray(cars.data) || cars.data.length !== 1 || String(cars.data[0]?.id) !== donorId || String(cars.data[0]?.car_model) !== modelId) throw new OvokoError(400, "Nie potwierdzono rekordu auta na koncie Ovoko lub jego model sie nie zgadza. ID modelu nie jest car_id rekordu auta.");
    const duplicates = ovokoPageData(await remote(`/v2/get/parts?external_ids=${encodeURIComponent(externalId)}&page=1&limit=1`), { page: 1, limit: 1 }, "part-external");
    if (duplicates.data.length || duplicates.pagination.total !== 0) throw new OvokoError(409, "Ovoko ma juz czesc z tym powiazaniem albo nie potwierdzilo pustego wyniku. Niczego nie nadpisujemy.", multi ? "stock_publication_locked" : undefined);
    const form = new URLSearchParams({ category_id: categoryId, car_id: donorId, quality: qualityId, status: statusId, ...(code ? { manufacturer_code: code } : {}), price, original_currency: currency, notes: input.notes, external_id: externalId, photo: source.images[0] });
    for(const [field,value] of Object.entries(wheel))form.set(field,value);
    source.images.forEach((url, index) => form.append(`photos[${index}]`, url));
    optionalCodes.forEach((value, index) => form.append(`optional_codes[${index}]`, value));
    if (retransfer && await ovokoPublicationPresent(remote, retransfer.part_id, externalId)) throw new OvokoError(409, "Czesc ponownie pojawila sie w Ovoko. Nie ponowiono wysylki.");
    const latestResponse = await handleAllegroApi(new Request(sourceRequest.url, { headers: sourceRequest.headers }), env);
    if (!latestResponse.ok) throw new OvokoError(409, "Nie potwierdzono oferty Allegro bezposrednio przed wysylka.");
    const latest = await latestResponse.json() as typeof owned;
    const fresh = ovokoSourcePreview(latest.offer, offerId, () => "");
    if(fresh.stockUnit!==source.stockUnit)throw new OvokoError(409,"Zmienila sie jednostka sprzedazy przed wysylka. Nie wyslano czesci.");
    if (latest.sellerId !== seller || fresh.status !== "ACTIVE" || fresh.stock !== source.stock || fresh.bundle || JSON.stringify(fresh.images) !== JSON.stringify(source.images) || fresh.rejectedImages || !sameOvokoMoney(fresh.price, source.price) || ["title", "currency", "condition"].some(key => fresh[key as keyof typeof fresh] !== source[key as keyof typeof source])) throw new OvokoError(409, "Oferta lub konto Allegro zmienily sie podczas sprawdzania. Nie wyslano czesci.", multi ? "stock_changed" : undefined);
    const permission = await accountContext(request, env);
    requireOvokoAccess(permission, env);
    if (permission.user.id !== context.user.id) throw new OvokoError(403, "Konto zmienilo sie podczas sprawdzania. Nie wyslano czesci.");
    const latestCredentials = await loadOvokoConnection(permission, await ovokoConnectionKey(env));
    if (latestCredentials.username !== credentials.username || latestCredentials.user_token !== credentials.user_token || latestCredentials.password !== credentials.password) throw new OvokoError(409, "Polaczenie Ovoko zmienilo sie podczas sprawdzania. Nie wyslano czesci.");
    if (multi) {
      stock = stock || await prepareStockPublication(permission, account, seller, offerId, source.stock!, stockMode);
      return { ...await publishStockUnit(permission, remote, stock, form), binding: { sellerId: seller, fingerprint } };
    }
    // Fresh generation also fences late replies after an audited manual lock retirement (ABA).
    const requestHash = await digest(`${crypto.randomUUID()}:${form.toString()}`);
    const reserved = retransfer
      ? await db(`?${selector}&owner_id=eq.${context.user.id}${publicationCas(retransfer)}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ state: "sending", part_id: null, request_hash: requestHash, updated_at: new Date().toISOString() }) })
      : await db("?on_conflict=ovoko_account,allegro_seller_id,allegro_offer_id", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=representation" }, body: JSON.stringify({ ovoko_account: account, allegro_seller_id: seller, allegro_offer_id: offerId, owner_id: context.user.id, request_hash: requestHash, state: "sending" }) });
    if (!Array.isArray(reserved) || reserved.length !== 1 || reserved[0]?.owner_id !== context.user.id || reserved[0].request_hash !== requestHash || (retransfer && (reserved[0].state !== "sending" || reserved[0].part_id !== null || reserved[0].ovoko_account !== account || reserved[0].allegro_seller_id !== seller || reserved[0].allegro_offer_id !== offerId))) throw new OvokoError(409, "Wysylka jest juz zablokowana lub nie potwierdzono rezerwacji. Sprawdz Ovoko przed kolejna proba.");
    let stage = "importPart", acceptedPartId = "";
    try {
      // Exactly one mutation, only after the durable unique lock. Never retry a provider write.
      const result = await remote("/crm/importPart", form);
      stage = "odczyt part_id";
      if (!/^[1-9]\d{0,11}$/.test(String(result.part_id))) throw new Error("missing part id");
      const partId = String(result.part_id);
      acceptedPartId = partId; stage = "zapis potwierdzenia";
      const saved = await db(`?${selector}&owner_id=eq.${context.user.id}&state=eq.sending&request_hash=eq.${requestHash}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ state: "created", part_id: partId, updated_at: new Date().toISOString() }) });
      if (!Array.isArray(saved) || saved.length !== 1 || saved[0]?.state !== "created" || saved[0].part_id !== partId || saved[0].request_hash !== requestHash) throw new Error("unconfirmed log");
      return { ok: true, partId, alreadyCreated: false, visibilityConfirmed: false };
    } catch (error) {
      if (acceptedPartId) try {
        const checked = await db(`?${selector}&owner_id=eq.${context.user.id}&select=state,part_id,request_hash`);
        if (Array.isArray(checked) && checked.length === 1 && checked[0]?.state === "created" && checked[0].part_id === acceptedPartId && checked[0].request_hash === requestHash) return { ok: true, partId: acceptedPartId, alreadyCreated: false, visibilityConfirmed: false };
      } catch { /* Readback never retries the provider mutation. */ }
      try { await db(`?${selector}&owner_id=eq.${context.user.id}&state=eq.sending&request_hash=eq.${requestHash}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ state: "uncertain", ...(acceptedPartId ? { part_id: acceptedPartId } : {}), updated_at: new Date().toISOString() }) }); } catch { /* The sending lock still prevents another write. */ }
      const diagnosis = stage === "importPart" ? ovokoRemoteDiagnosis(error) : stage === "odczyt part_id" ? "Odpowiedz R200 nie zawiera poprawnego part_id." : `Ovoko potwierdzilo ID ${acceptedPartId}, ale nie potwierdzono zapisu w naszej bazie.`;
      throw new OvokoError(409, `Wynik wysylki jest niepewny (etap: ${stage}). ${diagnosis} Czesc mogla powstac w Ovoko. Nie ponawiaj: sprawdz konto Ovoko po ID aukcji Allegro ${offerId} lub ID zewnetrznym ${externalId}. Blokada duplikatu pozostaje aktywna.`);
    }
  } catch (error) {
    if (error instanceof OvokoError) throw error;
    throw new OvokoError(502, "Nie udalo sie zweryfikowac danych w Ovoko. Nie uruchomiono wysylki czesci.");
  }
}
