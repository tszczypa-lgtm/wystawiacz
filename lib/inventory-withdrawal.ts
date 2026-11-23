import { openConnection } from "./allegro-api";
import { ovokoConnectionKey, validateOvokoCredentials, type OvokoKeyEnv } from "./ovoko-connection";
import { ovokoWriteClient, ovokoWriteDigest } from "./ovoko-write-client";
import { ovokoPageData, parseOvokoRead } from "./ovoko-read";
import type { WithdrawalScope } from "./sales-coordination";

type Data = Record<string, unknown>;
type Db = (path: string, options?: RequestInit) => Promise<unknown>;
type Remote = (path: string, options?: RequestInit) => Promise<Data>;
type TargetState = "pending" | "submitted" | "done" | "uncertain" | "not_requested";
type Job = { id: string; owner_id: string; offer_id: string; part_id: string | null; seller_id: string; fingerprint: string; publication_hash: string | null; scope: WithdrawalScope; state: "prepared" | "running" | "settled"; allegro_state: TargetState; ovoko_state: TargetState; expires_at: string };
export class WithdrawalError extends Error { constructor(public status: number, message: string) { super(message); } }
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const asRows = (value: unknown): Data[] => { if (!Array.isArray(value) || value.some(row => !row || typeof row !== "object" || Array.isArray(row))) throw new WithdrawalError(503, "Nieprawidlowy rejestr wycofan."); return value; };
export async function manageWithdrawal(input: Data, owner: string, env: OvokoKeyEnv & { INVENTORY_WITHDRAW_ENABLED?: string }, db: Db, allegro: Remote) {
  const operation = input.operation;
  if (!["prepare", "execute", "status"].includes(String(operation)) || Object.keys(input).some(key => !(operation === "prepare" ? ["operation", "offerId", "partId", "scope"] : ["operation", "jobId", "confirm"]).includes(key))) throw new WithdrawalError(400, "Nieprawidlowa operacja wycofania.");
  if (operation !== "status" && env.INVENTORY_WITHDRAW_ENABLED !== "true") throw new WithdrawalError(503, "Wycofywanie wymaga migracji 014 i INVENTORY_WITHDRAW_ENABLED=true. Automat sprzedazy pozostaje osobna funkcja.");
  const table = "inventory_withdrawals";
  const store: Db = async (path, options) => { try { return await db(path, options); } catch { throw new WithdrawalError(503, "Nie potwierdzono rejestru wycofan. Sprawdz migracje 014. Nie ponawiaj niepewnej operacji."); } };
  const selector = (id: string) => `${table}?id=eq.${id}&owner_id=eq.${owner}`;
  const seller = await allegro("/me", { signal: AbortSignal.timeout(15000) });
  if (typeof seller.id !== "string" || !/^\d{1,30}$/.test(seller.id)) throw new WithdrawalError(502, "Nie potwierdzono konta Allegro.");
  async function live(offerId: string, scope: WithdrawalScope, expectedPart?: string | null) {
    const result = await allegro(`/sale/offers?offer.id=${offerId}&limit=1`, { signal: AbortSignal.timeout(15000) });
    const offers = asRows(result.offers);
    if (offers.length !== 1 || offers[0].id !== offerId) throw new WithdrawalError(409, "Nie potwierdzono wlasnosci oferty Allegro.");
    const publication = offers[0].publication as { status?: unknown } | undefined;
    if (!publication || !["ACTIVE", "ENDED", "INACTIVE"].includes(String(publication.status))) throw new WithdrawalError(409, "Niepotwierdzony lub przejsciowy status oferty Allegro.");
    if (scope === "allegro") return { a: String(publication.status), fingerprint: "allegro-only", partId: null, publicationHash: null, ovoko: undefined, o: "", withdrawn: "" };
    const connection = asRows(await db(`ovoko_connections?owner_id=eq.${owner}&select=sealed`));
    if (connection.length !== 1 || typeof connection[0].sealed !== "string") throw new WithdrawalError(409, "Brak polaczenia Ovoko.");
    const credentials = validateOvokoCredentials(await openConnection<Data>(connection[0].sealed, await ovokoConnectionKey(env), `ovoko:v1:${owner}`));
    const account = await ovokoWriteDigest(credentials.username.trim().toLowerCase()), ovoko = ovokoWriteClient(credentials);
    const journal = asRows(await db(`ovoko_single_publications?owner_id=eq.${owner}&ovoko_account=eq.${account}&allegro_seller_id=eq.${seller.id}&allegro_offer_id=eq.${offerId}&select=state,part_id,request_hash`));
    if (journal.length !== 1 || journal[0].state !== "created" || typeof journal[0].part_id !== "string" || !/^[1-9]\d{0,11}$/.test(journal[0].part_id) || typeof journal[0].request_hash !== "string" || !/^[a-f0-9]{64}$/.test(journal[0].request_hash) || journal[0].part_id !== expectedPart) throw new WithdrawalError(409, "Nie potwierdzono dokladnego powiazania Ovoko. Nie wycofano zadnej oferty.");
    const external = `tymo:${seller.id}:${offerId}`;
    const parts = ovokoPageData(await ovoko(`/v2/get/parts?external_ids=${encodeURIComponent(external)}&page=1&limit=2`), { page: 1, limit: 2 }, "withdrawal.external");
    if (parts.pagination.total !== 1 || parts.data.length !== 1 || String(parts.data[0].id) !== expectedPart || parts.data[0].external_id !== external) throw new WithdrawalError(409, "Ovoko zwrocilo brak lub niejednoznaczne powiazanie. Nie wycofano ofert.");
    const statuses = parseOvokoRead("statuses", await ovoko("/get/part_status")).rows;
    const withdrawn = statuses.filter(row => ["wycofany", "written off"].includes(row.name.trim().toLowerCase()));
    const current = statuses.find(row => row.id === String(parts.data[0].status));
    if (withdrawn.length !== 1 || !current) throw new WithdrawalError(502, "Nie potwierdzono statusu Wycofany w Ovoko.");
    if (!["na stanie", "in stock", "wycofany", "written off"].includes(current.name.trim().toLowerCase())) throw new WithdrawalError(409, "Czesc Ovoko jest sprzedana, zarezerwowana lub w innym stanie. Nie nadpisujemy tego statusu.");
    return { a: String(publication.status), fingerprint: await ovokoWriteDigest(JSON.stringify(credentials)), publicationHash: journal[0].request_hash, partId: expectedPart, ovoko, o: String(parts.data[0].status), withdrawn: withdrawn[0].id };
  }
  if (operation === "prepare") {
    if (typeof input.offerId !== "string" || !/^\d{1,30}$/.test(input.offerId) || !["allegro", "ovoko", "both"].includes(String(input.scope)) || (input.scope !== "allegro" && (typeof input.partId !== "string" || !/^[1-9]\d{0,11}$/.test(input.partId)))) throw new WithdrawalError(400, "Sprawdz zakres i numery ofert.");
    const scope = input.scope as WithdrawalScope, target = await live(input.offerId, scope, input.partId as string | undefined);
    const job: Job = { id: crypto.randomUUID(), owner_id: owner, offer_id: input.offerId, seller_id: seller.id, part_id: target.partId || null, fingerprint: target.fingerprint, publication_hash: target.publicationHash, scope, state: "prepared", allegro_state: scope === "ovoko" ? "not_requested" : "pending", ovoko_state: scope === "allegro" ? "not_requested" : "pending", expires_at: new Date(Date.now() + 900000).toISOString() };
    const saved = asRows(await store(table, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(job) }));
    if (saved.length !== 1 || saved[0].id !== job.id || saved[0].owner_id !== owner) throw new WithdrawalError(503, "Nie potwierdzono przygotowania wycofania.");
    return publicJob(job);
  }
  if (typeof input.jobId !== "string" || !uuid.test(input.jobId)) throw new WithdrawalError(400, "Nieprawidlowe potwierdzenie wycofania.");
  const rows = asRows(await store(`${selector(input.jobId)}&select=*`));
  if (rows.length !== 1 || rows[0].owner_id !== owner || rows[0].seller_id !== seller.id) throw new WithdrawalError(409, "Plan nalezy do innego konta lub konto Allegro sie zmienilo.");
  const job = rows[0] as unknown as Job;
  if (operation === "execute" && input.confirm !== true) throw new WithdrawalError(400, "Potwierdz wycofanie wskazanych ofert.");
  if (operation === "execute" && job.state !== "prepared") return publicJob(job); // A second click never replays provider writes.
  if (operation === "status" && job.state === "prepared") return publicJob(job);
  if (job.state === "running" && operation === "status") throw new WithdrawalError(409, "Operacja jest w trakcie lub jej wynik nie zostal zapisany. Sprawdz portale; nie ponawiamy zapisu.");
  if (operation === "execute" && Date.parse(job.expires_at) <= Date.now()) throw new WithdrawalError(409, "Plan wygasl. Otworz nowy podglad; niczego nie wycofano.");
  const target = await live(job.offer_id, job.scope, job.part_id);
  if (target.fingerprint !== job.fingerprint || target.publicationHash !== job.publication_hash) throw new WithdrawalError(409, "Polaczenie lub powiazanie czesci zmienilo sie. Nie wykonano operacji.");
  async function save() {
    const saved = asRows(await store(`${selector(job.id)}&state=eq.${operation === "status" ? "settled" : "running"}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ state: job.state, allegro_state: job.allegro_state, ovoko_state: job.ovoko_state, updated_at: new Date().toISOString() }) }));
    if (saved.length !== 1) throw new WithdrawalError(503, "Nie potwierdzono zapisu wyniku. Sprawdz portale, nie ponawiaj wycofania.");
  }
  if (operation === "status") {
    if (["submitted", "uncertain"].includes(job.allegro_state) && ["ENDED", "INACTIVE"].includes(target.a)) job.allegro_state = "done";
    if (["submitted", "uncertain"].includes(job.ovoko_state) && target.o === target.withdrawn) job.ovoko_state = "done";
    await save(); return publicJob(job);
  }
  const claimed = asRows(await store(`${selector(job.id)}&state=eq.prepared`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ state: "running", updated_at: new Date().toISOString() }) }));
  if (claimed.length !== 1 || claimed[0].id !== job.id || claimed[0].owner_id !== owner || claimed[0].state !== "running") throw new WithdrawalError(409, "Wycofanie juz uruchomiono lub nie potwierdzono rezerwacji. Nie powtarzamy.");
  job.state = "running";
  if (job.allegro_state === "pending") {
    if (target.a !== "ACTIVE") job.allegro_state = "done";
    else try {
      const receipt = await allegro(`/sale/offer-publication-commands/${job.id}`, { method: "PUT", signal: AbortSignal.timeout(20000), headers: { "Content-Type": "application/vnd.allegro.public.v1+json" }, body: JSON.stringify({ publication: { action: "END" }, offerCriteria: [{ offers: [{ id: job.offer_id }], type: "CONTAINS_OFFERS" }] }) });
      if (receipt.id !== job.id) throw new Error("unconfirmed command");
      job.allegro_state = "submitted";
    } catch { job.allegro_state = "uncertain"; }
    await save();
  }
  if (job.ovoko_state === "pending") {
    try {
      // Recheck after the Allegro leg: never overwrite a newly sold/reserved part or rotated connection.
      const fresh = await live(job.offer_id, job.scope, job.part_id);
      if (fresh.fingerprint !== job.fingerprint || fresh.publicationHash !== job.publication_hash) throw new Error("changed binding");
      if (fresh.o === fresh.withdrawn) job.ovoko_state = "done";
      else {
        await fresh.ovoko!("/crm/changePartStatus", new URLSearchParams({ part_id: job.part_id!, status: fresh.withdrawn }));
        job.ovoko_state = "submitted";
      }
    } catch { job.ovoko_state = "uncertain"; }
    await save();
  }
  job.state = "settled"; await save();
  return publicJob(job);
}
function publicJob(job: Job) { return { id: job.id, offerId: job.offer_id, partId: job.part_id, scope: job.scope, state: job.state, allegro: job.allegro_state, ovoko: job.ovoko_state, expiresAt: job.expires_at, automatic: false }; }
