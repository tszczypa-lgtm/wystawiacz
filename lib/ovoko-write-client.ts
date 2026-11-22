import type { OvokoCredentials } from "./ovoko-connection";
import { ovokoNoCars } from "./ovoko-read";
import { ovokoCarsResponse } from "./ovoko-cars";

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
    const response = await fetch(`https://api.rrr.lt${path}`, { method: "POST", redirect: "manual", signal: AbortSignal.timeout(20000), headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: form.toString() });
    if (!response.ok || (response.status >= 300 && response.status < 400)) { await response.body?.cancel(); throw new Error("provider"); }
    const result = ovokoNoCars(await boundedJson(response), path);
    if (result.status_code !== "R200") throw new Error("provider");
    return path.startsWith("/v2/get/cars?") ? ovokoCarsResponse(result, path, () => remote("/get/cars")) : result;
  };
  return remote;
}
