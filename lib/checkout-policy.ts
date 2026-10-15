import { salesPolicy } from "./sales-policy";

// Change this revision whenever the displayed checkout statements change.
export const checkoutPolicy = {
  version: "2026-10-15-checkout-draft-1",
  termsVersion: salesPolicy.version,
  terms: "Akceptuje regulamin uslugi Wystawiacz by Tymo we wskazanej wersji.",
  earlyStart: "Wyraznie zadam rozpoczecia swiadczenia uslugi po potwierdzeniu platnosci, przed uplywem 14 dni od zawarcia umowy.",
  withdrawal: "Samo rozpoczecie uslugi nie oznacza utraty prawa odstapienia. W razie odstapienia po rozpoczeciu uslugi na moje wyrazne zadanie moze byc nalezna proporcjonalna zaplata za wykonane swiadczenie. Szczegolowe zasady wymagaja zatwierdzenia przed uruchomieniem sprzedazy.",
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
    seller: { name: salesPolicy.seller, nip: salesPolicy.nip, address: salesPolicy.address, email: salesPolicy.email },
  };
}
