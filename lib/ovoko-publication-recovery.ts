import type { accountContext } from "./account-api";
import { handleAllegroApi, openConnection, sealConnection } from "./allegro-api";
import { loadOvokoConnection, ovokoConnectionKey } from "./ovoko-connection";
import { ovokoWriteClient, ovokoWriteDigest } from "./ovoko-write-client";
import { OvokoError, ovokoPageData } from "./ovoko-read";
import type { OvokoPublishEnv } from "./ovoko-publish";

type Row = { state: string; request_hash: string; updated_at: string; part_id: string | null };
type Proof = { offerId: string; owner: string; seller: string; account: string; fingerprint: string; row: Row; expires: number };
export async function scanPublicationRecovery(remote: (path: string) => Promise<Record<string, unknown>>, external: string, knownId: string | null) {
  const lookup = async () => {
    const result = ovokoPageData(await remote(`/v2/get/parts?external_ids=${encodeURIComponent(external)}&page=1&limit=2`), { page: 1, limit: 2 }, "recovery.external");
    if (result.pagination.total > 1 || result.data.some(row => row.external_id !== external || !/^[1-9]\d{0,11}$/.test(String(row.id)))) throw new OvokoError(409, "Niejednoznaczne powiazanie Ovoko. Nie zwalniamy blokady.");
    if (result.pagination.total === 1 && result.data.length === 1) {
      const found = String(result.data[0].id);
      if (knownId && knownId !== found) throw new OvokoError(409, "Zapisane ID i znalezione powiazanie sa rozne. Potrzebna kontrola reczna.");
      return found;
    }
    return null;
  };
  const found = await lookup(); if (found) return { partId: found, scanned: 0 };
  let total: number | undefined, lastId = BigInt(0), scanned = 0;
  // A complete, ordered inventory snapshot is required before proposing absence, never a search page.
  for (let page = 1; page <= 20; page++) {
    const result = ovokoPageData(await remote(`/v2/get/parts?page=${page}&limit=100&sort[id]=asc`), { page, limit: 100 }, "recovery.inventory");
    if (total !== undefined && total !== result.pagination.total || result.pagination.total > 2000) throw new OvokoError(409, "Magazyn zmienil sie lub przekracza limit kontroli. Nie zwalniamy blokady.");
    total = result.pagination.total;
    for (const row of result.data) {
      if (!/^[1-9]\d{0,11}$/.test(String(row.id)) || BigInt(String(row.id)) <= lastId) throw new OvokoError(502, "Nie potwierdzono kompletnego porzadku czesci Ovoko.");
      lastId = BigInt(String(row.id)); scanned++;
      if (String(row.id) === knownId) throw new OvokoError(409, "Zapisane ID czesci nadal istnieje w Ovoko, ale ma inne powiazanie. Nie zwalniamy blokady.");
      if (row.external_id === external) throw new OvokoError(409, "Czesc pojawila sie podczas kontroli. Uruchom sprawdzenie ponownie, bez wystawiania.");
    }
    if (scanned === total) {
      const late = await lookup();
      if (late) return { partId: late, scanned };
      return { partId: null, scanned };
    }
  }
  throw new OvokoError(409, "Nie sprawdzono calego magazynu. Blokada pozostaje.");
}
export async function recoverOvokoPublication(request: Request, env: OvokoPublishEnv, context: Awaited<ReturnType<typeof accountContext>>, input: Record<string, unknown>) {
  if (!["check", "confirm"].includes(String(input.operation)) || Object.keys(input).some(key => !["operation", "offerId", "token", "confirmAbsent"].includes(key)) || typeof input.offerId !== "string" || !/^\d{1,30}$/.test(input.offerId)) throw new OvokoError(400, "Nieprawidlowe sprawdzenie blokady.");
  const source = await handleAllegroApi(new Request(`${new URL(request.url).origin}/api/allegro/ovoko-source/${input.offerId}`, { headers: { Authorization: request.headers.get("Authorization")! } }), env);
  if (!source.ok) throw new OvokoError(409, "Nie potwierdzono wlasnosci oferty Allegro.");
  const owned = await source.json() as { sellerId: string };
  if (!/^\d{1,30}$/.test(owned.sellerId)) throw new OvokoError(502, "Niepotwierdzone konto Allegro.");
  const key = await ovokoConnectionKey(env), credentials = await loadOvokoConnection(context, key);
  const account = await ovokoWriteDigest(credentials.username.trim().toLowerCase()), fingerprint = await ovokoWriteDigest(JSON.stringify(credentials));
  const rows = await context.db(`ovoko_single_publications?owner_id=eq.${context.user.id}&ovoko_account=eq.${account}&allegro_seller_id=eq.${owned.sellerId}&allegro_offer_id=eq.${input.offerId}&select=state,part_id,request_hash,updated_at`);
  if (!Array.isArray(rows) || rows.length !== 1 || !["sending", "uncertain"].includes(rows[0]?.state) || !/^[a-f0-9]{64}$/.test(rows[0]?.request_hash || "") || !Number.isFinite(Date.parse(rows[0]?.updated_at)) || (rows[0]?.part_id != null && !/^[1-9]\d{0,11}$/.test(rows[0].part_id))) throw new OvokoError(409, "Brak starej niepewnej blokady do rozstrzygniecia. Odswiez oferte.");
  const row = rows[0] as Row;
  if (Date.now() - Date.parse(row.updated_at) < 1800000) throw new OvokoError(409, "Od ostatniej proby musi uplynac 30 minut. Nie zwalniamy operacji, ktora moze jeszcze trwac.");
  const proof: Proof = { offerId: input.offerId, owner: context.user.id, seller: owned.sellerId, account, fingerprint, row, expires: Date.now() + 300000 };
  const aad = `ovoko-publication-recovery:${context.user.id}`;
  if (input.operation === "confirm") {
    if (typeof input.token !== "string" || input.token.length > 8192) throw new OvokoError(400, "Najpierw sprawdz blokade.");
    let old: Proof;
    try { old = await openConnection<Proof>(input.token, key, aad); } catch { throw new OvokoError(409, "Nieprawidlowe potwierdzenie kontroli."); }
    if (old.expires < Date.now() || old.expires > Date.now() + 300000 || old.owner !== proof.owner || old.offerId !== proof.offerId || old.seller !== proof.seller || old.account !== account || old.fingerprint !== fingerprint || JSON.stringify(old.row) !== JSON.stringify(row)) throw new OvokoError(409, "Kontrola wygasla lub zmienilo sie konto/blokada. Sprawdz ponownie.");
  }
  const result = await scanPublicationRecovery(ovokoWriteClient(credentials), `tymo:${owned.sellerId}:${input.offerId}`, row.part_id);
  if (input.operation === "check") return { readOnly: true, ...result, token: await sealConnection(proof, key, aad), message: result.partId ? `Znaleziono czesc Ovoko ID ${result.partId}. Mozna naprawic powiazanie bez wystawiania.` : `Sprawdzono ${result.scanned} czesci. Nie znaleziono tego powiazania. Przed odblokowaniem sprawdz tez recznie czesc w Ovoko (wszystkie statusy).` };
  if (!result.partId && input.confirmAbsent !== true) throw new OvokoError(400, "Potwierdz reczne sprawdzenie, ze tej fizycznej czesci nie ma w Ovoko.");
  let settled;
  try { settled = await context.db("rpc/resolve_ovoko_publication", { method: "POST", body: JSON.stringify({ p_owner: context.user.id, p_account: account, p_seller: owned.sellerId, p_offer: input.offerId, p_hash: row.request_hash, p_updated: row.updated_at, p_found: result.partId, p_scanned: result.scanned }) }); }
  catch { throw new OvokoError(503, "Nie potwierdzono rozstrzygniecia. Sprawdz migracje 015 i odswiez status; nie ponowiono publikacji."); }
  if (settled !== true) throw new OvokoError(409, "Blokada zmienila sie podczas kontroli. Niczego nie odblokowano.");
  return { resolved: true, partId: result.partId, message: result.partId ? `Naprawiono powiazanie z Ovoko ID ${result.partId}. Nie utworzono nowej czesci.` : "Zwolniono stara blokade po potwierdzeniu braku. Mozesz teraz odswiezyc podglad i przeniesc oferte. Niczego nie wystawiono automatycznie." };
}
