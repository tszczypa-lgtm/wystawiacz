import { accountContext, type AccountEnv } from "./account-api";
import { handleAllegroApi } from "./allegro-api";
import { loadOvokoConnection, ovokoConnectionKey, type OvokoKeyEnv } from "./ovoko-connection";
import { ovokoSourcePreview, additionalOvokoCodes } from "./ovoko-preparation";
import { OvokoError, parseOvokoRead, ovokoPageData } from "./ovoko-read";
import { ovokoWriteClient, ovokoWriteDigest as digest } from "./ovoko-write-client";
import { sameOvokoMoney } from "./ovoko-bulk-price";

type Context = Awaited<ReturnType<typeof accountContext>>;
export type OvokoPublishEnv = AccountEnv & OvokoKeyEnv & Parameters<typeof handleAllegroApi>[1] & { OVOKO_PUBLISH_ENABLED?: string };
function text(input: Record<string, unknown>, key: string, pattern: RegExp, max = 255) {
  const value = input[key];
  if (typeof value !== "string" || !value || value.length > max || !pattern.test(value)) throw new OvokoError(400, `Sprawdz pole ${key}.`);
  return value;
}
export async function publishOvokoPart(request: Request, env: OvokoPublishEnv, context: Context, input: Record<string, unknown>, binding?: { sellerId: string; fingerprint: string }) {
  if (env.OVOKO_PUBLISH_ENABLED !== "true") throw new OvokoError(503, "Publikacja pojedyncza jest wylaczona. Wykonaj migracje 012 i ustaw OVOKO_PUBLISH_ENABLED=true w Cloudflare.");
  if (input.confirmSingle !== true) throw new OvokoError(400, "Uruchom pojedyncza wysylke przyciskiem Wystaw.");
  if (Object.keys(input).some(key => !["offerId", "brandId", "modelId", "donorId", "categoryId", "qualityId", "statusId", "manufacturerCode", "additionalCodes", "price", "currency", "notes", "confirmSingle", "shippingConfirmed", "donorConfirmed", "expectedSource"].includes(key))) throw new OvokoError(400, "Nieobslugiwane pole publikacji.");
  const offerId = text(input, "offerId", /^\d{1,30}$/), donorId = text(input, "donorId", /^[1-9]\d{0,11}$/);
  const brandId = text(input, "brandId", /^[1-9]\d{0,11}$/), modelId = text(input, "modelId", /^[1-9]\d{0,11}$/);
  const categoryId = text(input, "categoryId", /^[1-9]\d{0,11}$/), qualityId = text(input, "qualityId", /^\d{1,12}$/), statusId = text(input, "statusId", /^\d{1,12}$/);
  const code = text(input, "manufacturerCode", /^[A-Z0-9]{6,32}$/), price = text(input, "price", /^\d{1,10}(\.\d{1,2})?$/, 30), currency = text(input, "currency", /^(PLN|EUR)$/);
  if (input.additionalCodes !== undefined && typeof input.additionalCodes !== "string") throw new OvokoError(400, "Nieprawidlowe numery dodatkowe.");
  const optionalCodes = additionalOvokoCodes((input.additionalCodes as string | undefined) || "", code);
  if (!optionalCodes) throw new OvokoError(400, "Sprawdz numery dodatkowe: maksymalnie 20 pelnych oznaczen.");
  if (Number(price) <= 0 || typeof input.notes !== "string" || input.notes.length > 40000 || /\0/.test(input.notes)) throw new OvokoError(400, "Sprawdz cene i opis.");
  const sourceRequest = new Request(`${new URL(request.url).origin}/api/allegro/ovoko-source/${offerId}`, { headers: { Authorization: request.headers.get("Authorization")! } });
  const sourceResponse = await handleAllegroApi(sourceRequest, env);
  if (!sourceResponse.ok) throw new OvokoError(409, "Nie potwierdzono aktualnej oferty na polaczonym koncie Allegro. Odswiez podglad.");
  const owned = await sourceResponse.json() as { offer: unknown; sellerId: string };
  if (typeof owned.sellerId !== "string" || !/^\d{1,30}$/.test(owned.sellerId)) throw new OvokoError(502, "Niepotwierdzony sprzedawca Allegro.");
  if (binding && owned.sellerId !== binding.sellerId) throw new OvokoError(409, "Konto Allegro zmienilo sie. Nie wyslano czesci.");
  const source = ovokoSourcePreview(owned.offer, offerId, () => "");
  if (source.status !== "ACTIVE" || source.stock !== 1 || source.bundle) throw new OvokoError(409, "Pierwsza proba wymaga aktywnej oferty z dokladnie jedna sztuka, bez zestawu. Nie wyslano czesci.");
  const expected = input.expectedSource as Record<string, unknown> | null;
  if (!expected || !sameOvokoMoney(expected.price, source.price) || ["title", "currency", "stock", "status", "condition"].some(key => expected[key] !== source[key as keyof typeof source]) || JSON.stringify(expected.images) !== JSON.stringify(source.images)) throw new OvokoError(409, "Oferta Allegro zmienila sie od otwarcia podgladu. Odswiez dane i sprawdz ponownie.");
  if (!source.images.length || source.rejectedImages) throw new OvokoError(400, "Zdjecia sa niepelne lub zawieraja nieobslugiwane adresy. Sprawdz oferte przed pierwsza proba.");
  const credentials = await loadOvokoConnection(context, await ovokoConnectionKey(env));
  if (binding && await digest(JSON.stringify(credentials)) !== binding.fingerprint) throw new OvokoError(409, "Konto Ovoko zmienilo sie. Nie wyslano czesci.");
  const remote = ovokoWriteClient(credentials);
  const account = await digest(credentials.username.trim().toLowerCase()), seller = owned.sellerId;
  const selector = `ovoko_account=eq.${account}&allegro_seller_id=eq.${seller}&allegro_offer_id=eq.${offerId}`;
  const db = async (query: string, options?: RequestInit) => {
    try { return await context.db(`ovoko_single_publications${query}`, options); }
    catch { throw new OvokoError(503, "Nie potwierdzono rejestru publikacji. Sprawdz migracje 012; nie ponawiaj wysylki bez sprawdzenia Ovoko."); }
  };
  const existing = await db(`?${selector}&owner_id=eq.${context.user.id}&select=state,part_id`);
  if (!Array.isArray(existing)) throw new OvokoError(503, "Nieprawidlowy rejestr publikacji.");
  if (existing.length) {
    if (existing[0].state === "created" && /^\d{1,12}$/.test(existing[0].part_id)) return { ok: true, partId: existing[0].part_id, alreadyCreated: true, visibilityConfirmed: false };
    throw new OvokoError(409, "Ta oferta ma juz rozpoczeta lub niepewna probe wysylki. Sprawdz Ovoko; blokujemy ponowienie, aby nie utworzyc duplikatu.");
  }
  try {
    const categories = parseOvokoRead("categories", await remote("/get/categories")).rows;
    const category = categories.find(row => row.id === categoryId && row.level === "3");
    if (!category) throw new OvokoError(400, "Niepotwierdzona kategoria Ovoko poziomu 3.");
    const categoryNames = [category.name]; let parent = category.parentId;
    for (let i = 0; parent && parent !== "0" && i < 3; i++) { const row = categories.find(item => item.id === parent); if (!row) break; categoryNames.push(row.name); parent = row.parentId; }
    if (/opon|felg|tires|rims/i.test(categoryNames.join(" "))) throw new OvokoError(400, "Opony i felgi wymagaja dodatkowych parametrow. Nie sa obslugiwane w pierwszej probie.");
    const qualities = parseOvokoRead("qualities", await remote("/get/part_quality")).rows;
    if (!qualities.some(row => row.id === qualityId)) throw new OvokoError(400, "Niepotwierdzony stan czesci Ovoko.");
    const statuses = parseOvokoRead("statuses", await remote("/get/part_status")).rows;
    if (!statuses.some(row => row.id === statusId && ["na stanie", "in stock"].includes(row.name.trim().toLowerCase()))) throw new OvokoError(400, "Pierwsza proba wymaga statusu Na stanie z aktualnego slownika Ovoko.");
    const models = parseOvokoRead("models", await remote(`/get/car_models/${brandId}`), brandId).rows;
    if (!models.some(row => row.id === modelId)) throw new OvokoError(400, "Model nie nalezy do wybranej marki Ovoko.");
    const cars = await remote(`/v2/get/cars?car_ids=${donorId}&page=1&limit=1`);
    if (!Array.isArray(cars.data) || cars.data.length !== 1 || String(cars.data[0]?.id) !== donorId || String(cars.data[0]?.car_model) !== modelId) throw new OvokoError(400, "Nie potwierdzono rekordu auta na koncie Ovoko lub jego model sie nie zgadza. ID modelu nie jest car_id rekordu auta.");
    const externalId = `tymo:${seller}:${offerId}`;
    const duplicates = ovokoPageData(await remote(`/v2/get/parts?external_ids=${encodeURIComponent(externalId)}&page=1&limit=1`), { page: 1, limit: 1 }, "part-external");
    if (duplicates.data.length || duplicates.pagination.total !== 0) throw new OvokoError(409, "Ovoko ma juz czesc z tym powiazaniem albo nie potwierdzilo pustego wyniku. Niczego nie nadpisujemy.");
    const form = new URLSearchParams({ category_id: categoryId, car_id: donorId, quality: qualityId, status: statusId, manufacturer_code: code, price, original_currency: currency, notes: input.notes, external_id: externalId, photo: source.images[0] });
    source.images.forEach((url, index) => form.append(`photos[${index}]`, url));
    optionalCodes.forEach((value, index) => form.append(`optional_codes[${index}]`, value));
    const latestResponse = await handleAllegroApi(new Request(sourceRequest.url, { headers: sourceRequest.headers }), env);
    if (!latestResponse.ok) throw new OvokoError(409, "Nie potwierdzono oferty Allegro bezposrednio przed wysylka.");
    const latest = await latestResponse.json() as typeof owned;
    const fresh = ovokoSourcePreview(latest.offer, offerId, () => "");
    if (latest.sellerId !== seller || fresh.status !== "ACTIVE" || fresh.stock !== 1 || fresh.bundle || JSON.stringify(fresh.images) !== JSON.stringify(source.images) || fresh.rejectedImages || !sameOvokoMoney(fresh.price, source.price) || ["title", "currency", "condition"].some(key => fresh[key as keyof typeof fresh] !== source[key as keyof typeof source])) throw new OvokoError(409, "Oferta lub konto Allegro zmienily sie podczas sprawdzania. Nie wyslano czesci.");
    const permission = await accountContext(request, env);
    if (permission.user.id !== context.user.id || !permission.isAdmin || permission.account.suspended) throw new OvokoError(403, "Uprawnienia administratora zmienily sie podczas sprawdzania. Nie wyslano czesci.");
    const latestCredentials = await loadOvokoConnection(permission, await ovokoConnectionKey(env));
    if (latestCredentials.username !== credentials.username || latestCredentials.user_token !== credentials.user_token || latestCredentials.password !== credentials.password) throw new OvokoError(409, "Polaczenie Ovoko zmienilo sie podczas sprawdzania. Nie wyslano czesci.");
    const requestHash = await digest(form.toString());
    const reserved = await db("?on_conflict=ovoko_account,allegro_seller_id,allegro_offer_id", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=representation" }, body: JSON.stringify({ ovoko_account: account, allegro_seller_id: seller, allegro_offer_id: offerId, owner_id: context.user.id, request_hash: requestHash, state: "sending" }) });
    if (!Array.isArray(reserved) || reserved.length !== 1 || reserved[0].owner_id !== context.user.id || reserved[0].request_hash !== requestHash) throw new OvokoError(409, "Wysylka jest juz zablokowana lub nie potwierdzono rezerwacji. Sprawdz Ovoko przed kolejna proba.");
    try {
      // Exactly one mutation, only after the durable unique lock. Never retry a provider write.
      const result = await remote("/crm/importPart", form);
      if (!/^[1-9]\d{0,11}$/.test(String(result.part_id))) throw new Error("missing part id");
      const partId = String(result.part_id);
      const saved = await db(`?${selector}&owner_id=eq.${context.user.id}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ state: "created", part_id: partId, updated_at: new Date().toISOString() }) });
      if (!Array.isArray(saved) || saved.length !== 1 || saved[0].part_id !== partId) throw new Error("unconfirmed log");
      return { ok: true, partId, alreadyCreated: false, visibilityConfirmed: false };
    } catch {
      try { await db(`?${selector}&owner_id=eq.${context.user.id}&state=eq.sending`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ state: "uncertain", updated_at: new Date().toISOString() }) }); } catch { /* The sending lock still prevents another write. */ }
      throw new OvokoError(409, "Wynik wysylki jest niepewny. Czesc mogla powstac w Ovoko. Nie ponawiaj: sprawdz konto Ovoko po numerze czesci. Blokada duplikatu pozostaje aktywna.");
    }
  } catch (error) {
    if (error instanceof OvokoError) throw error;
    throw new OvokoError(502, "Nie udalo sie zweryfikowac danych w Ovoko. Nie uruchomiono wysylki czesci.");
  }
}
