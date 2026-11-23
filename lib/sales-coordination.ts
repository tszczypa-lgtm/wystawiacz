// Read-only decisions. Provider writes must use a separate durable, account-bound queue.
export type SaleEvidence = { itemId: string; eventId: string; orderId?: string; listingId: string; quantity: number; at: string; kind: "purchase" | "cancelled"; source: "allegro" | "ovoko" };
export type CoordinationPair = { offerId: string; partId: string; allegroStatus: string; stock: number | null; ovokoStatus: "stock" | "sold" | "reserved" | "withdrawn" | "unknown"; linked: boolean };
export type CoordinationDecision = { status: "ready" | "review" | "idle"; action: "end_allegro" | "sold_ovoko" | null; reason: string; evidenceIds: string[] };
export type WithdrawalScope = "allegro" | "ovoko" | "both";
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Nieprawidlowe dane sprzedazy.");
  return value as Record<string, unknown>;
};
const id = (value: unknown) => typeof value === "string" && /^[0-9]{1,30}$/.test(value);
const instant = (value: unknown) => typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value));
export function allegroSaleEvidence(payload: unknown, sellerId: string): SaleEvidence[] {
  const data = object(payload);
  if (!Array.isArray(data.events) || data.events.length > 1000) throw new Error("Niepelny odczyt zdarzen Allegro.");
  const result: SaleEvidence[] = [];
  for (const value of data.events) {
    const event = object(value), order = object(event.order);
    if (!id(event.id) || !instant(event.occurredAt) || object(order.seller).id !== sellerId) throw new Error("Niepotwierdzone konto lub zdarzenie Allegro.");
    const purchase = ["BOUGHT", "READY_FOR_PROCESSING"].includes(String(event.type)), cancelled = ["BUYER_CANCELLED", "AUTO_CANCELLED"].includes(String(event.type));
    if (!purchase && !cancelled) continue;
    if (!Array.isArray(order.lineItems) || order.lineItems.length > 1000) throw new Error("Niepelne pozycje zamowienia Allegro.");
    for (const raw of order.lineItems) {
      const item = object(raw), offer = object(item.offer);
      if (typeof item.id !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(item.id) || !id(offer.id) || !Number.isSafeInteger(item.quantity) || Number(item.quantity) < 1) throw new Error("Nieprawidlowa pozycja zamowienia Allegro.");
      const checkout = order.checkoutForm && typeof order.checkoutForm === "object" && !Array.isArray(order.checkoutForm) ? order.checkoutForm as Record<string, unknown> : undefined;
      result.push({ itemId: item.id, eventId: String(event.id), ...(typeof checkout?.id === "string" && /^[a-zA-Z0-9-]{1,100}$/.test(checkout.id) ? { orderId: checkout.id } : {}), listingId: offer.id as string, quantity: Number(item.quantity), at: event.occurredAt as string, kind: cancelled ? "cancelled" : "purchase", source: "allegro" });
    }
  }
  return result;
}
export function decideSalesCoordination(pair: CoordinationPair, evidence: SaleEvidence[]): CoordinationDecision {
  const review = (reason: string): CoordinationDecision => ({ status: "review", action: null, reason, evidenceIds: [] });
  const idle = (reason: string): CoordinationDecision => ({ status: "idle", action: null, reason, evidenceIds: [] });
  if (!pair.linked || !id(pair.offerId) || !id(pair.partId)) return review("Brak jednoznacznego, potwierdzonego powiazania ofert. Nie laczymy po numerze OE ani tytule.");
  if (pair.ovokoStatus === "unknown" || !["ACTIVE", "ENDED", "INACTIVE", "ACTIVATING"].includes(pair.allegroStatus) || pair.stock === null || !Number.isSafeInteger(pair.stock) || pair.stock < 0) return review("Niepelne statusy lub ilosc. Blad odczytu nie jest sprzedaza.");
  const latest = new Map<string, SaleEvidence>();
  for (const item of evidence) {
    if (item.listingId !== (item.source === "allegro" ? pair.offerId : pair.partId)) continue;
    if (!instant(item.at) || item.quantity < 1 || !Number.isSafeInteger(item.quantity)) return review("Niepotwierdzony dowod sprzedazy.");
    const key = `${item.source}:${item.itemId}`, old = latest.get(key);
    if (!old || Date.parse(item.at) > Date.parse(old.at) || Date.parse(item.at) === Date.parse(old.at) && item.kind === "cancelled") latest.set(key, item);
  }
  const values = [...latest.values()];
  if (values.some(item => item.kind === "cancelled")) return review("Anulowanie lub zwrot wymaga sprawdzenia. Nigdy nie wznawiamy automatycznie oferty.");
  const a = values.filter(item => item.source === "allegro" && item.kind === "purchase"), o = values.filter(item => item.source === "ovoko" && item.kind === "purchase");
  if (a.length && o.length) return review("Zamowienia na obu portalach: mozliwa podwojna sprzedaz. Potrzebna decyzja sprzedawcy.");
  if (a.length) {
    if (a.length !== 1 || a[0].quantity !== 1 || pair.stock !== 0) return review("To nie jest potwierdzona sprzedaz ostatniej pojedynczej sztuki. Nie wycofujemy pozostalego zapasu.");
    if (pair.ovokoStatus === "sold") return idle("Oba kanaly wskazuja brak dostepnej sztuki.");
    if (pair.ovokoStatus !== "stock") return review("Ovoko ma rezerwacje lub wycofanie. Nie nadpisujemy recznej decyzji.");
    return { status: "ready", action: "sold_ovoko", reason: "Zakup Allegro i aktualny zapas 0: oznacz powiazana czesc Ovoko jako sprzedana poza Ovoko.", evidenceIds: [a[0].itemId] };
  }
  if (o.length) {
    if (o.length !== 1 || o[0].quantity !== 1 || pair.stock > 1 || pair.ovokoStatus !== "sold") return review("Nie potwierdzono sprzedazy pojedynczej czesci Ovoko lub Allegro ma wiecej niz jedna sztuke.");
    if (pair.allegroStatus === "ENDED" || pair.allegroStatus === "INACTIVE") return idle("Powiazana oferta Allegro jest juz nieaktywna.");
    if (pair.allegroStatus !== "ACTIVE") return review("Oferta Allegro zmienia status; potrzebny ponowny odczyt.");
    return { status: "ready", action: "end_allegro", reason: "Zakup Ovoko i status Sprzedano: zakoncz powiazana oferte Allegro.", evidenceIds: [o[0].itemId] };
  }
  if (pair.ovokoStatus === "sold" || pair.stock === 0) return review("Brak zapasu lub status Sprzedano bez dowodu zamowienia w sprawdzonym zakresie. Nie zgadujemy przyczyny.");
  return idle("Brak potwierdzonej sprzedazy w sprawdzonym zakresie.");
}
export function withdrawalPlan(scope: WithdrawalScope, available: { allegro: boolean; ovoko: boolean; conflict: boolean }) {
  if (!["allegro", "ovoko", "both"].includes(scope) || available.conflict) throw new Error("Najpierw wyjasnij powiazanie czesci.");
  const targets = scope === "both" ? ["allegro", "ovoko"] as const : [scope];
  if (targets.some(target => !available[target])) throw new Error("Brak potwierdzonej oferty na wybranym kanale.");
  return targets.map(target => ({ target, operation: target === "allegro" ? "END" : "Written off", preservesRecord: true, deletePhotos: false }));
}
