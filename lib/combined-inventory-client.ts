import { accountRequest, type AccountInfo } from "./account-client";
import { allegroRequest } from "./allegro-client";
import { ovokoTransferRequest, type OvokoTransfer } from "./ovoko-transfer-client";
import { createSupabaseBrowserClient } from "./supabase";
import { emptyCombinedSnapshot, type CombinedSnapshot, type AllegroInventoryRow } from "./combined-inventory";
import type { OvokoReadResult } from "./ovoko-read";

async function ovoko<T>(path: string, signal: AbortSignal, body?: unknown): Promise<T> {
  const { data } = await createSupabaseBrowserClient().auth.getSession();
  if (!data.session) throw new Error("Zaloguj sie ponownie.");
  const response = await fetch(`/api/ovoko/${path}`, { method: body ? "POST" : "GET", cache: "no-store", signal, headers: { Authorization: `Bearer ${data.session.access_token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json() as T & { message?: string };
  if (!response.ok) throw new Error(result.message || "Nie odczytano Ovoko.");
  return result;
}
const inventoryReads: number[] = [];
async function budget(signal: AbortSignal) {
  signal.throwIfAborted();
  while (inventoryReads.length && inventoryReads[0] < Date.now() - 61000) inventoryReads.shift();
  if (inventoryReads.length >= 25) await new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, Math.max(1, 61000 - (Date.now() - inventoryReads[0])));
    signal.addEventListener("abort", abort, { once: true });
  });
  signal.throwIfAborted(); inventoryReads.push(Date.now());
}
export async function loadCombinedInventory(previous: CombinedSnapshot | undefined, signal: AbortSignal, progress: (message: string) => void) {
  const snapshot = previous ? { ...previous, allegro: [...previous.allegro], ovoko: [...previous.ovoko], transfers: { ...previous.transfers }, errors: [] as string[] } : emptyCombinedSnapshot();
  const info = await accountRequest<AccountInfo>("/me"); signal.throwIfAborted(); snapshot.admin = info.isAdmin;
  if (snapshot.accountEmail && snapshot.accountEmail !== info.account.email) throw new Error("Konto Wystawiacza zmienilo sie. Odswiez cala liste.");
  snapshot.accountEmail = info.account.email;
  if (!info.isAdmin) { snapshot.ovoko = []; snapshot.statuses = {}; snapshot.transfers = {}; snapshot.ovokoComplete = false; }
  try {
    const { sellerId } = await allegroRequest<{ sellerId: string }>("/seller-identity", { signal });
    if (!/^\d{1,30}$/.test(sellerId) || snapshot.sellerId && snapshot.sellerId !== sellerId) { snapshot.allegro = []; snapshot.transfers = {}; snapshot.allegroComplete = false; snapshot.sellerId = ""; throw new Error("Konto Allegro zmienilo sie. Odswiez cala liste."); }
    snapshot.sellerId = sellerId;
    const seen = new Set(snapshot.allegro.map(row => row.id));
    for (let chunk = 0; chunk < 10 && !snapshot.allegroComplete; chunk++) {
      progress(`Odczyt Allegro: ${snapshot.allegro.length} czesci...`);
      const page = await allegroRequest<{ offers: AllegroInventoryRow[]; totalCount: number }>(`/inventory?status=&limit=200&offset=${snapshot.allegro.length}`, { signal });
      if (!Array.isArray(page.offers) || page.offers.length > 200 || !Number.isSafeInteger(page.totalCount) || page.totalCount < 0 || page.offers.some(row => !row || !/^\d{1,30}$/.test(row.id) || seen.has(row.id)) || new Set(page.offers.map(row => row.id)).size !== page.offers.length || snapshot.allegro.length && snapshot.allegroTotal !== page.totalCount) throw new Error("Lista Allegro zmienila sie lub jest niepelna. Odswiez od poczatku.");
      if (page.offers.length !== Math.min(200, Math.max(0, page.totalCount - snapshot.allegro.length))) throw new Error("Niepelna strona Allegro.");
      page.offers.forEach(row => seen.add(row.id)); snapshot.allegro.push(...page.offers); snapshot.allegroTotal = page.totalCount;
      if (info.isAdmin && page.offers.length) try {
        const states = await ovokoTransferRequest<{ ok: boolean; statuses: Record<string, OvokoTransfer> }>({ operation: "statuses", offerIds: page.offers.map(row => row.id) }, signal);
        if (!states.ok || !states.statuses) throw new Error("Niepelny rejestr powiazan.");
        Object.assign(snapshot.transfers, states.statuses);
      } catch (error) { signal.throwIfAborted(); snapshot.errors.push(`Powiazania: ${(error as Error).message}`); }
      if (snapshot.allegro.length >= page.totalCount) { snapshot.allegroComplete = true; break; }
    }
    const last = await allegroRequest<{ sellerId: string }>("/seller-identity", { signal });
    if (last.sellerId !== sellerId) { snapshot.allegro = []; snapshot.transfers = {}; snapshot.allegroComplete = false; throw new Error("Konto Allegro zmienilo sie. Odswiez liste."); }
  } catch (error) { signal.throwIfAborted(); snapshot.allegro = []; snapshot.transfers = {}; snapshot.allegroComplete = false; snapshot.errors.push(`Allegro: ${(error as Error).message}`); }
  if (info.isAdmin) try {
    const connection = await ovoko<{ connected: boolean; verifiedAt?: string }>("status", signal);
    if (!connection.connected || snapshot.ovokoVerifiedAt && snapshot.ovokoVerifiedAt !== connection.verifiedAt) { snapshot.ovoko = []; snapshot.ovokoComplete = false; throw new Error("Polacz konto Ovoko lub odswiez liste po zmianie polaczenia."); }
    snapshot.ovokoVerifiedAt = connection.verifiedAt;
    const dictionary = await ovoko<OvokoReadResult>("read", signal, { useSaved: true, operation: "statuses" });
    if (!dictionary.ok || !dictionary.readOnly || !Array.isArray(dictionary.rows)) throw new Error("Niepotwierdzone statusy Ovoko.");
    snapshot.statuses = Object.fromEntries(dictionary.rows.map(row => [row.id, row.name]));
    const seen = new Set(snapshot.ovoko.map(row => row.id));
    for (let chunk = 0; chunk < 20 && !snapshot.ovokoComplete; chunk++) {
      progress(`Odczyt Ovoko: ${snapshot.ovoko.length} czesci...`); await budget(signal);
      const page = await ovoko<OvokoReadResult>("read", signal, { useSaved: true, operation: "inventory", page: Math.floor(snapshot.ovoko.length / 100) + 1, limit: 100, sort: "oldest" });
      if (!page.ok || !page.readOnly || !Array.isArray(page.rows) || !page.pagination || page.pagination.limit !== 100 || page.pagination.page !== Math.floor(snapshot.ovoko.length / 100) + 1 || !Number.isSafeInteger(page.pagination.total) || page.pagination.total < 0 || page.rows.some(row => !row || !/^[1-9]\d{0,11}$/.test(row.id) || seen.has(row.id)) || new Set(page.rows.map(row => row.id)).size !== page.rows.length || snapshot.ovoko.length && snapshot.ovokoTotal !== page.pagination.total || page.rows.length !== Math.min(100, Math.max(0, page.pagination.total - snapshot.ovoko.length))) throw new Error("Lista Ovoko zmienila sie lub jest niepelna. Odswiez od poczatku.");
      page.rows.forEach(row => seen.add(row.id)); snapshot.ovoko.push(...page.rows); snapshot.ovokoTotal = page.pagination.total;
      if (snapshot.ovoko.length >= page.pagination.total) { snapshot.ovokoComplete = true; break; }
    }
    const last = await ovoko<{ connected: boolean; verifiedAt?: string }>("status", signal);
    if (!last.connected || last.verifiedAt !== connection.verifiedAt) { snapshot.ovoko = []; snapshot.ovokoComplete = false; throw new Error("Polaczenie Ovoko zmienilo sie. Odswiez liste."); }
  } catch (error) { signal.throwIfAborted(); snapshot.ovoko = []; snapshot.ovokoComplete = false; snapshot.errors.push(`Ovoko: ${(error as Error).message}`); }
  const finalAccount = await accountRequest<AccountInfo>("/me"); signal.throwIfAborted();
  if (finalAccount.account.email !== info.account.email || finalAccount.isAdmin !== info.isAdmin) throw new Error("Konto lub uprawnienia zmienily sie. Odswiez liste.");
  snapshot.errors = [...new Set(snapshot.errors)]; snapshot.checkedAt = new Date().toISOString();
  return snapshot;
}
