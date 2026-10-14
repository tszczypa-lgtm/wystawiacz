import { LegalPage, SellerDetails } from "@/components/legal-page";
import { salesPolicy } from "@/lib/sales-policy";
export const metadata = { title: "Kontakt | Wystawiacz by Tymo" };
export default function ContactPage() {
  return <LegalPage title="Kontakt i dane sprzedawcy">
    <section><h2>Usługodawca</h2><SellerDetails /></section>
    <section><h2>Pomoc i reklamacje</h2><p>Napisz na <a href={`mailto:${salesPolicy.email}`}>{salesPolicy.email}</a> lub prześlij zgłoszenie na adres działalności podany powyżej. Podaj e-mail konta Wystawiacza, opis problemu i oczekiwany sposób rozwiązania. Jeśli sprawa dotyczy płatności, podaj jej tytuł z Tpay.</p><p>Nie wysyłaj haseł, tokenów Allegro, kluczy API, kodów BLIK ani pełnych danych karty. Usuń je również ze zrzutów ekranu.</p></section>
    <section><h2>Dane osobowe i odstąpienie od umowy</h2><p>Na ten sam adres e-mail możesz skierować pytanie o przetwarzanie danych, żądanie usunięcia konta lub oświadczenie o odstąpieniu od umowy. Nie musisz zakładać kolejnego konta ani podawać hasła.</p></section>
  </LegalPage>;
}
