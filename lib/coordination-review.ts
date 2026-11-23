import type { accountContext } from "./account-api";
import { handleAllegroApi } from "./allegro-api";
import { loadOvokoConnection, ovokoConnectionKey } from "./ovoko-connection";
import { ovokoWriteClient, ovokoWriteDigest } from "./ovoko-write-client";
import { OvokoError, ovokoPageData, parseOvokoRead } from "./ovoko-read";
import { decideSalesCoordination, type SaleEvidence, type CoordinationPair } from "./sales-coordination";
import type { OvokoPublishEnv } from "./ovoko-publish";

export async function reviewCoordination(request: Request, env: OvokoPublishEnv, context: Awaited<ReturnType<typeof accountContext>>, input: Record<string, unknown>) {
  if (Object.keys(input).some(key => key !== "offerIds") || !Array.isArray(input.offerIds) || !input.offerIds.length || input.offerIds.length > 5 || new Set(input.offerIds).size !== input.offerIds.length || input.offerIds.some(id => typeof id !== "string" || !/^\d{1,30}$/.test(id))) throw new OvokoError(400, "Kontrola obejmuje od 1 do 5 zaznaczonych ofert.");
  const source = await handleAllegroApi(new Request(`${new URL(request.url).origin}/api/allegro/coordination-snapshot?offerIds=${input.offerIds.join(",")}`, { headers: { Authorization: request.headers.get("Authorization")! } }), env);
  if (!source.ok) throw new OvokoError(source.status, [400, 403].includes(source.status) ? "Allegro odrzucilo odczyt. Sprawdz zgode na odczyt zamowien; starsze polaczenie wymaga ponownej autoryzacji w Polaczeniu Allegro. Nie rozlaczaj ani nie usuwaj ofert." : "Nie potwierdzono ofert lub zdarzen Allegro. Sprawdz sesje i ponow odczyt pozniej. Niczego nie wycofano.");
  const snapshot = await source.json() as { sellerId: string; offers: { id: string; name: string; status: string; stock: number | null }[]; evidence: SaleEvidence[]; partial: boolean; eventsRead: number };
  const credentials = await loadOvokoConnection(context, await ovokoConnectionKey(env)), remote = ovokoWriteClient(credentials);
  const account = await ovokoWriteDigest(credentials.username.trim().toLowerCase());
  const statuses = parseOvokoRead("statuses", await remote("/get/part_status")).rows;
  const checkedAt = new Date().toISOString();
  const rows = [];
  for (const offer of snapshot.offers) {
    const journal = await context.db(`ovoko_single_publications?owner_id=eq.${context.user.id}&ovoko_account=eq.${account}&allegro_seller_id=eq.${snapshot.sellerId}&allegro_offer_id=eq.${offer.id}&select=state,part_id`);
    if (!Array.isArray(journal) || journal.length > 1) throw new OvokoError(503, "Nieprawidlowy rejestr powiazan.");
    const externalId = `tymo:${snapshot.sellerId}:${offer.id}`;
    const result = ovokoPageData(await remote(`/v2/get/parts?external_ids=${encodeURIComponent(externalId)}&page=1&limit=2`), { page: 1, limit: 2 }, "coordination.external");
    const part = result.data.length === 1 && result.pagination.total === 1 ? result.data[0] : undefined;
    const linked = !!part && /^[1-9]\d{0,11}$/.test(String(part.id)) && part.external_id === externalId && journal.length === 1 && journal[0].state === "created" && String(part.id) === journal[0].part_id;
    const name = statuses.find(row => row.id === String(part?.status))?.name.trim().toLowerCase();
    const ovokoStatus: CoordinationPair["ovokoStatus"] = ["na stanie", "in stock"].includes(name || "") ? "stock" : ["sprzedano", "sold out"].includes(name || "") ? "sold" : ["zarezerwowano", "reserved"].includes(name || "") ? "reserved" : ["wycofany", "written off"].includes(name || "") ? "withdrawn" : "unknown";
    const pair: CoordinationPair = { offerId: offer.id, partId: linked ? String(part!.id) : "", allegroStatus: offer.status, stock: offer.stock, ovokoStatus, linked };
    const decision = decideSalesCoordination(pair, snapshot.evidence);
    rows.push({ ...pair, name: offer.name, decision, withdrawal: { allegro: true, ovoko: linked, both: linked }, ...(ovokoStatus === "sold" ? { note: "Kierunek Ovoko -> Allegro wymaga jeszcze potwierdzenia zamowienia Ovoko, nie tylko statusu magazynu." } : {}) });
  }
  return { readOnly: true, automatic: false, checkedAt, rows, eventsRead: snapshot.eventsRead, partial: snapshot.partial, scope: "Maksymalnie 1000 zdarzen Allegro. To nie jest pelny monitoring ani ochrona przed podwojna sprzedaza." };
}
