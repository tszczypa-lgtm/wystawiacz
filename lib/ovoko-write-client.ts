import type { OvokoCredentials } from "./ovoko-connection";
import { ovokoNoCars } from "./ovoko-read";
import { ovokoCarsResponse } from "./ovoko-cars";

export class OvokoRemoteError extends Error {
  constructor(public reason: "timeout" | "transport" | "http" | "redirect" | "json" | "provider", public httpStatus?: number, public providerCode?: string) { super("Niepotwierdzona odpowiedz Ovoko."); }
}
export function ovokoRemoteDiagnosis(error: unknown): string {
  if (!(error instanceof OvokoRemoteError)) return "Nie potwierdzono odpowiedzi dostawcy.";
  const reasons = { timeout: "Timeout odpowiedzi Ovoko (20 s).", transport: "Blad polaczenia z Ovoko.", http: "Ovoko zwrocilo blad HTTP.", redirect: "Ovoko zwrocilo zablokowane przekierowanie.", json: "Ovoko zwrocilo nieprawidlowy lub niepelny JSON.", provider: "Ovoko nie potwierdzilo operacji kodem R200." };
  return [reasons[error.reason], Number.isInteger(error.httpStatus) && error.httpStatus! >= 100 && error.httpStatus! <= 599 ? `HTTP ${error.httpStatus}.` : "", /^R\d{3}$/.test(error.providerCode || "") ? `Kod ${error.providerCode}.` : ""].filter(Boolean).join(" ");
}

export const ovokoWriteDigest = async (value: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, "0")).join("");
async function boundedJson(response: Response) {
  const reader = response.body?.getReader(); if (!reader) throw new Error("empty");
  let total = 0; const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      total += value.length; if (total > 2000000) { await reader.cancel(); throw new Error("large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const result = JSON.parse(new TextDecoder().decode(bytes));
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("shape");
  return result as Record<string, any>;
}
export function ovokoWriteClient(credentials: OvokoCredentials) {
  const remote = async (path: string, extra?: URLSearchParams): Promise<Record<string, any>> => {
    // Paths are constructed by the two server-side handlers, never supplied by the browser.
    if (!path.startsWith("/") || path.startsWith("//") || /[\r\n\\#]/.test(path)) throw new Error("path");
    const form = new URLSearchParams(credentials); extra?.forEach((value, key) => form.append(key, value));
    let response: Response;
    try { response = await fetch(`https://api.rrr.lt${path}`, { method: "POST", redirect: "manual", signal: AbortSignal.timeout(20000), headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: form.toString() }); }
    catch (error) { throw new OvokoRemoteError(error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name) ? "timeout" : "transport"); }
    if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); throw new OvokoRemoteError("redirect", response.status); }
    let raw: Record<string, unknown>;
    try { raw = await boundedJson(response); } catch (error) { throw new OvokoRemoteError(error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name) ? "timeout" : response.ok ? "json" : "http", response.status); }
    const code = typeof raw.status_code === "string" && /^R\d{3}$/.test(raw.status_code) ? raw.status_code : undefined;
    if (!response.ok) throw new OvokoRemoteError("http", response.status, code);
    const result = ovokoNoCars(raw, path);
    if (result.status_code !== "R200") throw new OvokoRemoteError("provider", response.status, code);
    return path.startsWith("/v2/get/cars?") ? ovokoCarsResponse(result, path, () => remote("/get/cars")) : result;
  };
  return remote;
}
