import { accountContext } from "./account-api";
import { loadOvokoConnection, ovokoConnectionKey } from "./ovoko-connection";
import type { OvokoPublishEnv } from "./ovoko-publish";
import { OvokoError, parseOvokoRead } from "./ovoko-read";
import { ovokoWriteClient, ovokoWriteDigest } from "./ovoko-write-client";

type Context = Awaited<ReturnType<typeof accountContext>>;
class VehicleJournalError extends OvokoError {
  constructor(public adapterStatus?: number) {
    super(503, "Nie potwierdzono rejestru tworzenia aut. Administrator powinien sprawdzic dostep do bazy i schemat; jesli brakuje tabeli lub kolumn, wymagany jest SQL migracji 013 w Supabase. Nie ponawiaj niepewnego zapisu bez sprawdzenia Ovoko.");
  }
}
export async function createOvokoCar(request: Request, env: OvokoPublishEnv, context: Context, input: Record<string, unknown>, expectedFingerprint?: string) {
  if (env.OVOKO_PUBLISH_ENABLED !== "true") throw new OvokoError(503, "Tworzenie aut jest wylaczone flaga OVOKO_PUBLISH_ENABLED.");
  if (input.confirmCreate !== true || Object.keys(input).some(key => !["brandId", "modelId", "year", "confirmCreate"].includes(key))) throw new OvokoError(400, "Potwierdz utworzenie rekordu auta z wybranym modelem i rokiem.");
  const { brandId, modelId, year } = input;
  if (typeof brandId !== "string" || !/^[1-9]\d{0,11}$/.test(brandId) || typeof modelId !== "string" || !/^[1-9]\d{0,11}$/.test(modelId) || typeof year !== "string" || !/^\d{4}$/.test(year) || Number(year) < 1886 || Number(year) > new Date().getUTCFullYear() + 1) throw new OvokoError(400, "Wybierz marke, model i poprawny rok. Nie zgadujemy roku produkcji.");
  const credentials = await loadOvokoConnection(context, await ovokoConnectionKey(env));
  if (expectedFingerprint && await ovokoWriteDigest(JSON.stringify(credentials)) !== expectedFingerprint) throw new OvokoError(409, "Konto Ovoko zmienilo sie. Nie utworzono auta.");
  const remote = ovokoWriteClient(credentials), account = await ovokoWriteDigest(credentials.username.trim().toLowerCase());
  const selector = `ovoko_account=eq.${account}&model_id=eq.${modelId}&vehicle_year=eq.${year}`;
  const db = async (query: string, options?: RequestInit) => {
    try { return await context.db(`ovoko_vehicle_creations${query}`, options); }
    catch (error) {
      // accountContext normalizes HTTP failures to status 503; never call it the upstream HTTP status.
      const status = error && typeof error === "object" && "status" in error ? error.status : undefined;
      throw new VehicleJournalError(typeof status === "number" && Number.isInteger(status) && status >= 400 && status <= 599 ? status : undefined);
    }
  };
  const existing = await db(`?${selector}&owner_id=eq.${context.user.id}&select=state,car_id`);
  if (!Array.isArray(existing)) throw new OvokoError(503, "Nieprawidlowy rejestr tworzenia aut.");
  if (existing.length) {
    if (existing[0].state === "created" && /^[1-9]\d{0,11}$/.test(existing[0].car_id)) return { ok: true, carId: existing[0].car_id, modelId, year, reused: true };
    throw new OvokoError(409, "Ten model i rok maja juz rozpoczeta lub niepewna probe utworzenia auta. Sprawdz Ovoko; nie tworzymy kolejnego rekordu.");
  }
  try {
    const models = parseOvokoRead("models", await remote(`/get/car_models/${brandId}`), brandId).rows;
    const model = models.find(row => row.id === modelId);
    if (!model) throw new OvokoError(400, "Model nie nalezy do wybranej marki Ovoko.");
    const range = model.years?.match(/^(\d{4})? - (\d{4})?$/);
    if (range && ((range[1] && Number(year) < Number(range[1])) || (range[2] && Number(year) > Number(range[2])))) throw new OvokoError(400, "Podany rok nie pasuje do zakresu wybranego modelu Ovoko.");
    // Reuse by model; legacy exports need not contain external_id.
    const savedCars = parseOvokoRead("cars", await remote(`/v2/get/cars?model_ids=${modelId}&page=1&limit=20`), modelId).rows;
    const savedCar = savedCars.find(row => row.years === year) || savedCars[0];
    if (savedCar && /^[1-9]\d{0,11}$/.test(savedCar.id)) return { ok: true, carId: savedCar.id, modelId, year, reused: true };
    const externalId = `tymo:car:${modelId}:${year}`;
    const statuses = await remote("/get/car_status");
    if (!statuses.list || typeof statuses.list !== "object" || Array.isArray(statuses.list)) throw new Error("status shape");
    const added = Object.entries(statuses.list as Record<string, { pl?: string; en?: string }>).filter(([id, row]) => /^[1-9]\d{0,11}$/.test(id) && ["dodano", "added"].includes(String(row?.pl || row?.en || "").trim().toLowerCase()));
    if (added.length !== 1) throw new OvokoError(400, "Nie potwierdzono statusu Dodano w slowniku aut. Nie ustawiamy Kupiony ani Do demontazu.");
    const permission = await accountContext(request, env);
    if (!permission.isAdmin || permission.account.suspended || permission.user.id !== context.user.id) throw new OvokoError(403, "Uprawnienia zmienily sie przed utworzeniem auta.");
    const latestCredentials = await loadOvokoConnection(permission, await ovokoConnectionKey(env));
    if (latestCredentials.username !== credentials.username || latestCredentials.user_token !== credentials.user_token || latestCredentials.password !== credentials.password) throw new OvokoError(409, "Polaczenie Ovoko zmienilo sie podczas sprawdzania. Nie utworzono auta.");
    const reserved = await db("?on_conflict=ovoko_account,model_id,vehicle_year", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=representation" }, body: JSON.stringify({ ovoko_account: account, model_id: modelId, vehicle_year: year, owner_id: context.user.id, state: "sending" }) });
    if (!Array.isArray(reserved) || reserved.length !== 1 || reserved[0].owner_id !== context.user.id) throw new OvokoError(409, "Tworzenie tego auta jest juz zablokowane. Sprawdz Ovoko przed kolejna proba.");
    let writeStage = "importCar";
    let confirmationDiagnosis = "";
    try {
      // Minimal user-confirmed catalogue record. No fabricated VIN, engine, purchase or storage data.
      const result = await remote("/crm/importCar", new URLSearchParams({ car_model: modelId, car_years: year, status: added[0][0], external_id: externalId }));
      if (!/^[1-9]\d{0,11}$/.test(String(result.car_id))) throw new Error("missing id");
      const carId = String(result.car_id);
      writeStage = "sprawdzenie zwroconego car_id";
      // importCar returns an existing ID for the same external_id; verify it before accepting it.
      const verified = await remote(`/get/car/${carId}`);
      const car = Array.isArray(verified.list) && verified.list.length === 1 && Array.isArray(verified.list[0]) && verified.list[0].length === 1 ? verified.list[0][0] : null;
      if (!car || String(car.id) !== carId || String(car.car_model) !== modelId || String(car.car_years) !== year) throw new Error("unverified car");
      writeStage = "zapis potwierdzenia";
      const saved = await db(`?${selector}&owner_id=eq.${context.user.id}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ state: "created", car_id: carId, updated_at: new Date().toISOString() }) });
      if (saved === null || saved === undefined) confirmationDiagnosis = "Brak reprezentacji po PATCH rejestru (np. odpowiedz 204). Sprawdz obsluge Prefer: return=representation w bazie/proxy.";
      else if (Array.isArray(saved) && saved.length === 0) confirmationDiagnosis = "Pusta reprezentacja po PATCH rejestru: brak potwierdzonego wiersza. Sprawdz selektor konta/modelu/roku/wlasciciela i uprawnienia bazy.";
      else if (!Array.isArray(saved) || saved.length !== 1) confirmationDiagnosis = "Nieprawidlowa reprezentacja po PATCH rejestru: oczekiwano jednego wiersza. Sprawdz odpowiedz bazy/proxy.";
      else {
        const row = saved[0];
        if (!row || typeof row !== "object" || Array.isArray(row) || row.state !== "created" || row.car_id !== carId || row.ovoko_account !== account || row.model_id !== modelId || row.vehicle_year !== year || row.owner_id !== context.user.id) confirmationDiagnosis = "Niezgodny wiersz po PATCH rejestru: stan, car_id lub zakres konta/modelu/roku/wlasciciela nie odpowiada potwierdzeniu. Sprawdz rejestr w bazie.";
      }
      if (confirmationDiagnosis) throw new Error("log");
      return { ok: true, carId, modelId, year, reused: false };
    } catch (error) {
      if (writeStage === "zapis potwierdzenia" && error instanceof VehicleJournalError) confirmationDiagnosis = `Blad zapisu lub odczytu odpowiedzi PATCH rejestru (${error.adapterStatus === undefined ? "status adaptera bazy niedostepny" : `status adaptera bazy: ${error.adapterStatus}`}; rzeczywisty HTTP Supabase niedostepny). Sprawdz logi bazy/proxy, uprawnienia i schemat; jesli brakuje tabeli lub kolumn, wymagany jest SQL migracji 013.`;
      try { await db(`?${selector}&owner_id=eq.${context.user.id}&state=eq.sending`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ state: "uncertain", updated_at: new Date().toISOString() }) }); } catch { /* Sending remains a durable lock. */ }
      throw new OvokoError(409, `Niepewny wynik tworzenia auta (etap: ${writeStage}). ${confirmationDiagnosis ? `${confirmationDiagnosis} ` : ""}Moglo powstac w Ovoko. Nie ponawiaj; sprawdz Moje samochody. Blokada duplikatu pozostaje aktywna.`);
    }
  } catch (error) {
    if (error instanceof OvokoError) throw error;
    throw new OvokoError(502, "Nie udalo sie sprawdzic danych auta w Ovoko. Nie uruchomiono tworzenia nowego rekordu.");
  }
}
