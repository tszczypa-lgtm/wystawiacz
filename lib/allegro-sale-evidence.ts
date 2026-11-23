import type { SaleEvidence } from "./sales-coordination";

// Keep this server parser out of the policy module imported by client components.
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
