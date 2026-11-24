import { accountContext, type AccountEnv } from "./account-api";
import { OvokoError, ovokoReadPlan, parseOvokoRead, ovokoInventoryPlan, ovokoNoCars } from "./ovoko-read";
import { loadOvokoConnection, ovokoConnectionKey, ovokoConnectionStatus, removeOvokoConnection, saveOvokoConnection, validateOvokoCredentials, type OvokoKeyEnv } from "./ovoko-connection";
import { publishOvokoPart, type OvokoPublishEnv } from "./ovoko-publish";
import { createOvokoCar } from "./ovoko-create-car";
import { ovokoCarsResponse } from "./ovoko-cars";
import { ovokoWriteClient } from "./ovoko-write-client";
import { ovokoTransferInventory } from "./ovoko-transfer-inventory";
import { bulkOvokoPart } from "./ovoko-bulk";
import { reviewCoordination } from "./coordination-review";
import { recoverOvokoPublication } from "./ovoko-publication-recovery";
import { salesSyncControl } from "./sales-sync";
import { inventoryOperations } from "./inventory-operations";
import { reverseSyncControl } from "./reverse-sales-sync";
import { requireOvokoAccess } from "./ovoko-access";

type OvokoEnv = AccountEnv & OvokoKeyEnv & OvokoPublishEnv & { OVOKO_TEST_ENABLED?: string; SALES_SYNC_ENABLED?: string };
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
    requireOvokoAccess(context, env);
    if (env.OVOKO_TEST_ENABLED === "false") return reply({ message: "Obsluga Ovoko jest wylaczona." }, 403);
    const url = new URL(request.url);
    if (url.pathname === "/api/ovoko/status" && request.method === "GET") {
      let storageReady = false;
      try { await ovokoConnectionKey(env); storageReady = true; } catch { /* Ephemeral probes still work without storage configuration. */ }
      const status = storageReady ? await ovokoConnectionStatus(context) : { connected: false, verifiedAt: null };
      return reply({ allowed: true, readOnly: true, storageReady, credentialsStored: status.connected, ...status });
    }
    if (!["/api/ovoko/test", "/api/ovoko/read", "/api/ovoko/connect", "/api/ovoko/disconnect", "/api/ovoko/publish", "/api/ovoko/create-car", "/api/ovoko/transfer-inventory", "/api/ovoko/bulk", "/api/ovoko/coordination-review", "/api/ovoko/publication-recovery", "/api/ovoko/sales-sync", "/api/ovoko/reverse-sales-sync", "/api/ovoko/inventory-actions"].includes(url.pathname)) return reply({ message: "Nieznana operacja Ovoko." }, 404);
    if (request.method !== "POST") return reply({ message: "Nieprawidlowa metoda." }, 405);
    if (request.headers.get("Origin") !== url.origin || (env.APP_ORIGIN && env.APP_ORIGIN !== url.origin)) return reply({ message: "Nieprawidlowe zrodlo zadania." }, 403);
    if (request.headers.get("Content-Type")?.split(";")[0].trim() !== "application/json") return reply({ message: "Nieprawidlowy format formularza." }, 415);
    let input: unknown;
    try { input = JSON.parse(await boundedText(request, ["/api/ovoko/publish", "/api/ovoko/bulk"].includes(url.pathname) ? 200000 : 8192)); } catch (error) { if (error instanceof OvokoError) throw error; throw new OvokoError(400, "Nieprawidlowy formularz."); }
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new OvokoError(400, "Nieprawidlowy formularz.");
    const values = input as Record<string, unknown>;
    if (url.pathname === "/api/ovoko/inventory-actions") {
      const now = Date.now(), key = `${context.user.id}:inventory-actions`, recent = (attempts.get(key) || []).filter(time => now - time < 60000);
      if (recent.length >= 30) throw new OvokoError(429, "Maksymalnie 30 operacji magazynowych na minute.");
      if (attempts.size >= 1000 && !attempts.has(key)) attempts.delete(attempts.keys().next().value!);
      attempts.set(key, [...recent, now]);
      return reply(await inventoryOperations(context.user.id, env, values));
    }
    if (["/api/ovoko/sales-sync", "/api/ovoko/reverse-sales-sync"].includes(url.pathname)) {
      const now = Date.now(), key = `${context.user.id}:${url.pathname}`, recent = (attempts.get(key) || []).filter(time => now - time < 60000);
      if (recent.length >= 6) throw new OvokoError(429, "Maksymalnie 6 zmian lub odczytow automatu na minute.");
      if (attempts.size >= 1000 && !attempts.has(key)) attempts.delete(attempts.keys().next().value!);
      attempts.set(key, [...recent, now]);
      return reply(url.pathname === "/api/ovoko/sales-sync" ? await salesSyncControl(context.user.id, env, values) : await reverseSyncControl(context.user.id, env, values));
    }
    if (url.pathname === "/api/ovoko/publication-recovery") {
      const now = Date.now(), key = `${context.user.id}:publication-recovery`, recent = (attempts.get(key) || []).filter(time => now - time < 60000);
      if (recent.length >= 3) throw new OvokoError(429, "Maksymalnie 3 kontrole blokady na minute.");
      if (attempts.size >= 1000 && !attempts.has(key)) attempts.delete(attempts.keys().next().value!);
      attempts.set(key, [...recent, now]);
      return reply(await recoverOvokoPublication(request, env, context, values));
    }
    if (url.pathname === "/api/ovoko/coordination-review") {
      const now = Date.now(), key = `${context.user.id}:coordination-review`, recent = (attempts.get(key) || []).filter(time => now - time < 60000);
      if (recent.length >= 3) throw new OvokoError(429, "Maksymalnie 3 kontrole koordynacji na minute.");
      if (attempts.size >= 1000 && !attempts.has(key)) attempts.delete(attempts.keys().next().value!);
      attempts.set(key, [...recent, now]);
      return reply(await reviewCoordination(request, env, context, values));
    }
    if (url.pathname === "/api/ovoko/bulk") {
      const phase = ["start", "prepare", "item"].includes(String(values.operation)) ? String(values.operation) : "invalid";
      const now = Date.now(), key = `${context.user.id}:bulk:${phase}`, recent = (attempts.get(key) || []).filter(time => now - time < 60000);
      if (recent.length >= 10) throw new OvokoError(429, "Maksymalnie 10 pozycji partii na minute. Odczekaj przed kolejna partia.");
      if (attempts.size >= 1000 && !attempts.has(key)) attempts.delete(attempts.keys().next().value!);
      attempts.set(key, [...recent, now]);
      return reply(await bulkOvokoPart(request, env, context, values));
    }
    if (url.pathname === "/api/ovoko/transfer-inventory") {
      const now = Date.now(), key = `${context.user.id}:transfer-inventory`, recent = (attempts.get(key) || []).filter(time => now - time < 60000);
      if (recent.length >= 30) throw new OvokoError(429, "Maksymalnie 30 odczytow przeniesien na minute. Odczekaj chwile.");
      if (attempts.size >= 1000 && !attempts.has(key)) attempts.delete(attempts.keys().next().value!);
      attempts.set(key, [...recent, now]);
      return reply(await ovokoTransferInventory(request, env, context, values));
    }
    if (url.pathname === "/api/ovoko/publish" || url.pathname === "/api/ovoko/create-car") {
      const now = Date.now(), key = `${context.user.id}:${url.pathname}`, recent = (attempts.get(key) || []).filter(time => now - time < 60000);
      if (recent.length >= 3) throw new OvokoError(429, "Maksymalnie 3 pojedyncze proby na minute.");
      if (attempts.size >= 1000 && !attempts.has(key)) attempts.delete(attempts.keys().next().value!);
      attempts.set(key, [...recent, now]);
      return reply(url.pathname === "/api/ovoko/publish" ? await publishOvokoPart(request, env, context, values) : await createOvokoCar(request, env, context, values));
    }
    if (url.pathname === "/api/ovoko/disconnect") {
      await removeOvokoConnection(context);
      return reply({ ok: true, connected: false, credentialsStored: false, readOnly: true });
    }
    const connecting = url.pathname === "/api/ovoko/connect";
    const useSaved = !connecting && values.useSaved === true;
    const key = connecting || useSaved ? await ovokoConnectionKey(env) : null;
    if (useSaved && ["username", "password", "user_token"].some(name => name in values)) throw new OvokoError(400, "Nie lacz danych formularza z zapisanym polaczeniem.");
    const credentials = useSaved ? await loadOvokoConnection(context, key!) : validateOvokoCredentials(values);
    const plan = url.pathname === "/api/ovoko/read" ? ovokoReadPlan(values) : null;
    const form = new URLSearchParams(credentials);
    // Dictionary reads have a separate bounded budget for automatic form initialization.
    // The paged inventory view has its own budget; legacy probes retain their original limit.
    const inventory = plan?.operation === "inventory";
    const dictionary = plan && plan.operation !== "parts" && plan.operation !== "cars" && !inventory;
    const cars = plan?.operation === "cars";
    const attemptKey = `${context.user.id}:${dictionary ? "dictionary" : cars ? "cars" : inventory ? "inventory" : "probe"}`;
    const limit = dictionary ? 12 : cars ? 6 : inventory ? 30 : 3;
    const now = Date.now(), recent = (attempts.get(attemptKey) || []).filter(time => now - time < 60000);
    if (recent.length >= limit) return reply({ message: `Maksymalnie ${limit} odczytow na minute. Odczekaj chwile.` }, 429);
    if (attempts.size >= 1000 && !attempts.has(attemptKey)) attempts.delete(attempts.keys().next().value!);
    attempts.set(attemptKey, [...recent, now]);
    // Fixed read-only probe. Never accept caller-supplied URLs or forward redirects with credentials.
    const response = await fetch(`https://api.rrr.lt${plan?.path || "/get/car_brands"}`, { method: "POST", redirect: "manual", signal: AbortSignal.timeout(20000), headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: form.toString() });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new OvokoError(502, "Ovoko zwrocilo przekierowanie. Zablokowano je, aby nie przekazac hasla i tokena pod inny adres. Nie zmieniono ofert.");
    }
    if (!response.ok) return reply({ message: `Ovoko zwrocilo HTTP ${response.status}. Nie potwierdzono polaczenia; nie zmieniono ofert.` }, response.status === 429 ? 429 : 502);
    let result: Record<string, unknown>;
    try { result = JSON.parse(await boundedText(response, plan ? 2000000 : 512000)); } catch { throw new OvokoError(502, "Niepelna lub nieprawidlowa odpowiedz Ovoko. Nie potwierdzono polaczenia."); }
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new OvokoError(502, "Nieprawidlowa odpowiedz Ovoko.");
    if (plan?.operation === "cars") result = ovokoNoCars(result, plan.path);
    if (result.status_code !== "R200") {
      const code = typeof result.status_code === "string" && /^R\d{3}$/.test(result.status_code) ? result.status_code : "unknown";
      return reply({ message: `${errors[code] || "Ovoko nie potwierdzilo poprawnego odczytu."} Kod: ${code}. Nie zmieniono ofert.`, code }, code === "R008" ? 429 : 502);
    }
    if (plan?.operation === "cars") result = await ovokoCarsResponse(result, plan.path, () => ovokoWriteClient(credentials)("/get/cars"));
    const checkedAt = new Date().toISOString();
    if (plan) return reply({ ok: true, code: "R200", readOnly: true, credentialsStored: useSaved, checkedAt, operation: plan.operation, ...parseOvokoRead(plan.operation, result, plan.operation === "cars" ? values.modelId : values.brandId, inventory ? ovokoInventoryPlan(values) : undefined) });
    if (!Array.isArray(result.list) || !result.list.length || result.list.length > 5000 || result.list.some(item => !item || typeof item !== "object" || !/^\d{1,12}$/.test(String(item.id)) || typeof item.name !== "string" || !item.name.trim() || item.name.length > 200)) throw new OvokoError(502, "Niepelna lista marek z Ovoko. Nie potwierdzono poprawnego odczytu.");
    if (connecting) await saveOvokoConnection(context, key!, credentials, checkedAt);
    return reply({ ok: true, code: "R200", readOnly: true, credentialsStored: connecting || useSaved, connected: connecting || useSaved, checkedAt, brands: result.list.map(item => ({ id: String(item.id), name: item.name })) });
  } catch (error) {
    if (error instanceof OvokoError) return reply({ message: error.message, ...(error.code ? { code: error.code } : {}) }, error.status);
    if (error instanceof Error && "status" in error && error.status === 401) return reply({ message: "Zaloguj sie ponownie do Wystawiacza." }, 401);
    if (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)) return reply({ message: "Przekroczono czas odczytu Ovoko. Nie ponawiamy automatycznie; nie zmieniono ofert." }, 504);
    return reply({ message: "Nie udalo sie wykonac testu Ovoko. Sprawdz dostep konta i polaczenie sieciowe. Nie zmieniono ofert." }, 503);
  }
}
