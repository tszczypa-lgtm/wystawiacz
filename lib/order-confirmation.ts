export type ConfirmedOrder = {
  id: string; environment: string; status: string; amount_grosz: number; currency: string;
  transaction_title: string | null; created_at: string; paid_at: string | null; access_until: string | null;
  checkout_acceptance: {
    recordedAt?: string; draft?: boolean;
    seller?: { name: string; nip: string; address: string; email: string };
    buyer?: { email: string; company: unknown };
    statements?: Record<string, string>;
    documents?: { terms?: { version: string; text: string }; privacy?: { version: string; text: string } };
  } | null;
};

// Read historical snapshots, never substitute today's documents for accepted terms.
export function orderConfirmation(order: ConfirmedOrder) {
  const acceptance = order.checkout_acceptance;
  const sandbox = order.environment === "sandbox";
  const seller = acceptance?.seller;
  return [
    sandbox ? "TEST ZAMOWIENIA - BEZ PRAWDZIWEJ OPLATY I UMOWY" : "POTWIERDZENIE ZAMOWIENIA - WYSTAWIACZ BY TYMO",
    `Numer zamowienia: ${order.id}`, `Transakcja: ${order.transaction_title || "brak"}`,
    `Status: ${order.status}`, `Utworzono (UTC): ${order.created_at}`,
    `Potwierdzenie operatora (UTC): ${order.paid_at || "brak"}`,
    `${sandbox ? "Kwota testowa" : "Kwota brutto"}: ${(order.amount_grosz / 100).toFixed(2)} ${order.currency}`,
    sandbox ? "Test nie przedluza platnego dostepu. Okres probny pozostaje bez zmian." : `Oplacony dostep do (UTC): ${order.access_until || "oczekuje na rozliczenie"}`,
    "To potwierdzenie nie jest faktura ani paragonem.",
    seller ? `Sprzedawca: ${seller.name}\nNIP: ${seller.nip}\nAdres: ${seller.address}\nKontakt: ${seller.email}` : "Brak historycznych danych sprzedawcy.",
    acceptance?.buyer ? `Nabywca: ${JSON.stringify(acceptance.buyer.company)}\nE-mail: ${acceptance.buyer.email}` : "Dane nabywcy nie zostaly utrwalone w tej wersji zamowienia.",
    `Oswiadczenia zapisano (UTC): ${acceptance?.recordedAt || "brak"}`,
    ...Object.values(acceptance?.statements || {}),
    "REGULAMIN Z CHWILI ZAMOWIENIA",
    acceptance?.documents?.terms?.text || "Brak historycznego dokumentu. Skontaktuj sie ze sprzedawca; nie podmieniono go aktualnym regulaminem.",
    "PRYWATNOSC Z CHWILI ZAMOWIENIA",
    acceptance?.documents?.privacy?.text || "Brak historycznego dokumentu.",
  ].join("\n\n") + "\n";
}

export type OrderSummary = Pick<ConfirmedOrder, "id" | "environment" | "status" | "amount_grosz" | "currency" | "transaction_title" | "created_at" | "paid_at" | "access_until"> & { hasConfirmation: boolean };
export function orderSummary(order: ConfirmedOrder): OrderSummary {
  const { id, environment, status, amount_grosz, currency, transaction_title, created_at, paid_at, access_until } = order;
  return { id, environment, status, amount_grosz, currency, transaction_title, created_at, paid_at, access_until,
    hasConfirmation: !!order.checkout_acceptance?.documents?.terms?.text && ["paid", "refunded"].includes(status) };
}
