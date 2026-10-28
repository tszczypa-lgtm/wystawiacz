import { salesPolicy } from "./sales-policy";
import { salesDocumentText } from "./sales-documents";

// Change this revision whenever the displayed checkout statements change.
export const checkoutPolicy = {
  version: "2026-10-28-checkout-review-3",
  termsVersion: salesPolicy.version,
  terms: "Akceptuję regulamin Wystawiacza by Tymo.",
  earlyStart: "Chcę rozpocząć usługę po potwierdzeniu płatności, przed upływem 14 dni na odstąpienie.",
  withdrawal: "Konsument ma co do zasady 14 dni od zawarcia umowy na odstąpienie. Przy wyraźnie zamówionym wcześniejszym starcie i spełnieniu warunków ustawowych wykorzystana usługa jest rozliczana proporcjonalnie. Nie jest to dodatkowa gwarancja zwrotu.",
  offer: "500 PLN brutto za jeden miesiac kalendarzowy dostepu. Bez automatycznego odnawiania. Oplaty Allegro nie sa wliczone.",
} as const;

export function checkoutAcceptance(input: unknown, environment: string) {
  const value = input as Record<string, unknown> | null;
  if (!value || typeof value !== "object" || Array.isArray(value)
    || value.version !== checkoutPolicy.version || value.termsVersion !== checkoutPolicy.termsVersion
    || value.acceptTerms !== true || value.requestEarlyStart !== true) return null;
  // Only server-owned text and strict boolean choices are persisted, never a client snapshot.
  return {
    version: checkoutPolicy.version, termsVersion: checkoutPolicy.termsVersion,
    environment, draft: !salesPolicy.approved,
    acceptTerms: true, requestEarlyStart: true,
    statements: { terms: checkoutPolicy.terms, earlyStart: checkoutPolicy.earlyStart, withdrawal: checkoutPolicy.withdrawal, offer: checkoutPolicy.offer },
    documents: {
      terms: { version: salesPolicy.version, text: salesDocumentText("regulamin") },
      privacy: { version: salesPolicy.version, text: salesDocumentText("prywatnosc") },
    },
    seller: { name: salesPolicy.seller, nip: salesPolicy.nip, address: salesPolicy.address, email: salesPolicy.email },
  };
}
