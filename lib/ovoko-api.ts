import { accountContext, type AccountEnv } from "./account-api";

type OvokoEnv = AccountEnv & { OVOKO_TEST_ENABLED?: string };
class OvokoError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const attempts = new Map<string, number[]>();
async function boundedText(input: Pick<Request, "body" | "headers">, limit: number) {
  if (Number(input.headers.get("Content-Length")) > limit) throw new OvokoError(413, "Odpowiedz lub formularz przekracza limit rozmiaru.");
  const reader = input.body?.getReader();
  if (!reader) throw new OvokoError(400, "Brak danych.");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new OvokoError(413, "Odpowiedz lub formularz przekracza limit rozmiaru."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(bytes);
}
const errors: Record<string, string> = {
  R001: "Ovoko nie rozpoznaje loginu API.", R002: "Ovoko odrzucilo haslo API.", R003: "Dostep API w Ovoko jest nieaktywny.",
  R008: "Ovoko ograniczylo liczbe polaczen. Odczekaj przed kolejna proba.", R009: "Ovoko nie otrzymalo loginu API.",
  R010: "Ovoko nie otrzymalo hasla API.", R011: "Ovoko nie otrzymalo tokena API.", R012: "Ovoko odrzucilo token API.",
  R013: "Ovoko odrzucilo adres IP serwera. Potrzebne jest sprawdzenie ograniczen IP tego dostepu.",
  R400: "Ovoko odrzucilo format zapytania.", R404: "Ovoko nie odnalazlo danych.", R500: "Blad po stronie Ovoko. Sprobuj pozniej."
};
export async function handleOvokoApi(request: Request, env: OvokoEnv): Promise<Response> {
  const reply = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  try {
    const context = await accountContext(request, env);
    if (!context.isAdmin || context.account.suspended || env.OVOKO_TEST_ENABLED === "false") return reply({ message: "Test Ovoko jest dostepny tylko dla administratora i moze byc wylaczony." }, 403);
    const url = new URL(request.url);
    if (url.pathname === "/api/ovoko/status" && request.method === "GET") return reply({ allowed: true, readOnly: true, credentialsStored: false });
    if (url.pathname !== "/api/ovoko/test") return reply({ message: "Nieznana operacja Ovoko. Zapis ofert nie jest dostepny." }, 404);
    if (request.method !== "POST") return reply({ message: "Nieprawidlowa metoda." }, 405);
    if (request.headers.get("Origin") !== url.origin || (env.APP_ORIGIN && env.APP_ORIGIN !== url.origin)) return reply({ message: "Nieprawidlowe zrodlo zadania." }, 403);
    if (request.headers.get("Content-Type")?.split(";")[0].trim() !== "application/json") return reply({ message: "Nieprawidlowy format formularza." }, 415);
    let input: unknown;
    try { input = JSON.parse(await boundedText(request, 8192)); } catch (error) { if (error instanceof OvokoError) throw error; throw new OvokoError(400, "Nieprawidlowy formularz."); }
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new OvokoError(400, "Nieprawidlowy formularz.");
    const values = input as Record<string, unknown>;
    const form = new URLSearchParams();
    for (const [name, max] of [["username", 256], ["password", 1024], ["user_token", 2048]] as const) {
      const value = values[name];
      if (typeof value !== "string" || !value.trim() || value.length > max || /[\r\n\0]/.test(value)) throw new OvokoError(400, "Wypelnij login, haslo i token API. Nie podawaj linku z menedzera hasel.");
      form.set(name, name === "password" ? value : value.trim());
    }
    const now = Date.now(), recent = (attempts.get(context.user.id) || []).filter(time => now - time < 60000);
    if (recent.length >= 3) return reply({ message: "Maksymalnie 3 proby na minute. Odczekaj chwile." }, 429);
    if (attempts.size >= 1000 && !attempts.has(context.user.id)) attempts.delete(attempts.keys().next().value!);
    attempts.set(context.user.id, [...recent, now]);
    // Fixed read-only probe. Never accept caller-supplied URLs or forward redirects with credentials.
    const response = await fetch("https://api.rrr.lt/get/car_brands", { method: "POST", redirect: "error", signal: AbortSignal.timeout(20000), headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: form.toString() });
    if (!response.ok) return reply({ message: `Ovoko zwrocilo HTTP ${response.status}. Nie potwierdzono polaczenia; nie zmieniono ofert.` }, response.status === 429 ? 429 : 502);
    let result: { status_code?: unknown; list?: unknown };
    try { result = JSON.parse(await boundedText(response, 512000)); } catch { throw new OvokoError(502, "Niepelna lub nieprawidlowa odpowiedz Ovoko. Nie potwierdzono polaczenia."); }
    if (!result || typeof result !== "object") throw new OvokoError(502, "Nieprawidlowa odpowiedz Ovoko.");
    if (result.status_code !== "R200") {
      const code = typeof result.status_code === "string" && /^R\d{3}$/.test(result.status_code) ? result.status_code : "unknown";
      return reply({ message: `${errors[code] || "Ovoko nie potwierdzilo poprawnego odczytu."} Kod: ${code}. Nie zmieniono ofert.`, code }, code === "R008" ? 429 : 502);
    }
    if (!Array.isArray(result.list) || result.list.length > 5000 || result.list.some(item => !item || typeof item !== "object" || !/^\d{1,12}$/.test(String(item.id)) || typeof item.name !== "string" || !item.name.trim() || item.name.length > 200)) throw new OvokoError(502, "Niepelna lista marek z Ovoko. Nie potwierdzono poprawnego odczytu.");
    return reply({ ok: true, code: "R200", readOnly: true, credentialsStored: false, checkedAt: new Date().toISOString(), brands: result.list.map(item => ({ id: String(item.id), name: item.name })) });
  } catch (error) {
    if (error instanceof OvokoError) return reply({ message: error.message }, error.status);
    if (error instanceof Error && "status" in error && error.status === 401) return reply({ message: "Zaloguj sie ponownie do Wystawiacza." }, 401);
    if (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)) return reply({ message: "Przekroczono czas odczytu Ovoko. Nie ponawiamy automatycznie; nie zmieniono ofert." }, 504);
    return reply({ message: "Nie udalo sie wykonac testu Ovoko. Sprawdz dostep konta i polaczenie sieciowe. Nie zmieniono ofert." }, 503);
  }
}
