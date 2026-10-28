import type { OrderSummary } from "@/lib/order-confirmation";

export function OrderHistory({ orders, onDownload, busy }: { orders: OrderSummary[]; onDownload: (id: string) => void; busy: boolean }) {
  if (!orders.length) return null;
  const labels: Record<string, string> = { creating: "Przygotowywanie platnosci", pending: "Oczekuje na potwierdzenie Tpay", paid: "Platnosc potwierdzona", failed: "Platnosc niedokonczona", refunded: "Platnosc zwrocona" };
  return <section className="rounded-3xl border border-white/10 bg-white/5 p-6" aria-label="Historia zamowien">
    <h2 className="text-xl font-bold">Ostatnie zamowienia</h2>
    <div className="mt-4 grid gap-3">{orders.map(order => <article key={order.id} className="rounded-xl border border-white/10 p-4">
      <p className={order.status === "paid" ? "font-bold text-emerald-300" : "font-bold text-amber-200"}>{order.environment === "sandbox" ? "TEST: " : ""}{labels[order.status] || "Sprawdz status"}</p>
      <p className="mt-1 text-sm text-white/70">{new Date(order.created_at).toLocaleString("pl-PL", { timeZone: "Europe/Warsaw" })} · {order.transaction_title || order.id} · {(order.amount_grosz / 100).toFixed(2)} {order.currency}{order.environment === "sandbox" ? " (kwota testowa)" : " brutto"}</p>
      {order.environment === "sandbox" && <p className="mt-2 text-sm text-white/70">Bez prawdziwej oplaty. Test nie przedluza abonamentu; okres probny pozostaje bez zmian.</p>}
      {order.environment === "production" && order.access_until && <p className="mt-2 text-sm">Oplacony dostep do {new Date(order.access_until).toLocaleDateString("pl-PL", { timeZone: "Europe/Warsaw" })}.</p>}
      {order.hasConfirmation && <button disabled={busy} onClick={() => onDownload(order.id)} className="mt-3 rounded-lg border border-white/20 px-3 py-2 text-sm disabled:opacity-50">Pobierz potwierdzenie i dokumenty</button>}
    </article>)}</div>
    <p className="mt-3 text-xs text-white/50">Potwierdzenie zawiera dokumenty zapisane przy zamowieniu. Nie jest faktura ani paragonem.</p>
  </section>;
}
