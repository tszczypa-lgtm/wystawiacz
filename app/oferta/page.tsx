import type { Metadata } from "next";
import { LegalLinks } from "@/components/legal-links";
import { SellerDetails } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Oferta i zasady dostepu | Wystawiacz by Tymo",
  description: "Przygotowanie i publikowanie ofert Allegro. Dostep za 500 zl brutto za miesiac, bez automatycznego odnawiania.",
};

export default function OfferPage() {
  return <main className="min-h-screen bg-[#0d1117] px-5 py-8 text-white">
    <div className="mx-auto max-w-5xl">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-6">
        <a href="/" className="text-xl font-black text-[#ff8a3d]">Wystawiacz by Tymo</a>
        <nav aria-label="Nawigacja publiczna" className="flex gap-5 text-sm text-white/70">
          <a href="/docs" className="hover:text-white">Jak to dziala</a>
          <a href="/login" className="hover:text-white">Logowanie</a>
        </nav>
      </header>
      <section className="grid items-start gap-8 py-12 lg:grid-cols-[1.2fr_0.8fr]">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-[#ff8a3d]">Asystent ofert Allegro</p>
          <h1 className="mt-4 text-4xl font-black leading-tight tracking-tight sm:text-5xl">Od zdjec czesci<br />do gotowej oferty.</h1>
          <p className="mt-6 max-w-xl text-lg leading-8 text-white/70">Wybierz zdjecia, uzupelnij dane i przygotuj liste produktow. Publikuj oferty na swoim koncie sprzedawcy Allegro, pojedynczo lub kolejno z zaznaczonej listy.</p>
          <p className="mt-4 text-sm leading-7 text-white/55">Wystawiacz jest niezaleznym narzedziem, a nie serwisem Allegro. Do publikacji potrzebujesz konta sprzedawcy i zgody na polaczenie aplikacji.</p>
        </div>
        <aside className="rounded-3xl border border-[#ff5a00]/35 bg-white/[.04] p-7" aria-label="Cena i okres dostepu">
          <h2 className="text-lg font-bold">Miesiac dostepu</h2>
          <p className="mt-4 text-5xl font-black">500 zl <span className="text-base font-normal text-white/60">brutto</span></p>
          <p className="mt-4 font-bold text-emerald-300">Bez automatycznego odnawiania</p>
          <p className="mt-3 text-sm leading-7 text-white/70">Kazdy kolejny miesiac oplacasz osobno. Rejestracja nie pobiera pieniedzy ani nie zapisuje karty do cyklicznych obciazen.</p>
          <a href="/panel/billing" className="mt-6 block rounded-xl bg-[#ff5a00] px-5 py-3 text-center font-bold">Przejdz do panelu dostepu</a>
          <p className="mt-4 text-xs leading-6 text-white/55">Prawdziwe platnosci nie sa jeszcze uruchomione. Obecny test Tpay jest dostepny tylko administratorowi i nie przyznaje platnego dostepu produkcyjnego.</p>
        </aside>
      </section>
      <section className="grid gap-4 sm:grid-cols-3" aria-label="Mozliwosci programu">
        {[
          ["Zdjecia i opisy", "Wybor i obracanie zdjec, zdjecie glowne, edycja tytulu oraz opisu. Dane auta dodajesz z wlasnej listy pomocniczej."],
          ["Twoje konto Allegro", "Podpowiedzi z katalogu i kopiowanie danych wlasnych ofert. Przed wystawieniem sprawdzasz kategorie, parametry, cene i warunki sprzedazy."],
          ["Sesje pracy", "Eksport i import JSON oraz zapis danych sesji na serwerze. Zdjecia pozostaja w Twoim folderze; zapis sesji nie jest kopia plikow zdjec."],
        ].map(([title, text]) => <article key={title} className="rounded-2xl border border-white/10 bg-white/[.03] p-6">
          <h2 className="text-lg font-bold">{title}</h2><p className="mt-3 text-sm leading-7 text-white/65">{text}</p>
        </article>)}
      </section>
      <section className="my-10 rounded-3xl border border-white/10 p-7">
        <h2 className="text-2xl font-bold">Co obejmuje oplata</h2>
        <dl className="mt-6 grid gap-6 text-sm leading-7 sm:grid-cols-2">
          <div><dt className="font-bold">Okres dostepu</dt><dd className="mt-1 text-white/65">Jeden miesiac kalendarzowy. Po potwierdzeniu zaplaty dostep liczymy od pozniejszej daty: dzisiaj, koniec oplaconego dostepu lub koniec przyznanego okresu probnego. Dokupienie miesiaca nie skraca pozostalego okresu.</dd></div>
          <div><dt className="font-bold">Aktywacja</dt><dd className="mt-1 text-white/65">Platny dostep jest przyznawany po zweryfikowanym potwierdzeniu Tpay, nie po samym powrocie z bramki. Termin dostepu sprawdzisz w panelu Abonament.</dd></div>
          <div><dt className="font-bold">Konta sprzedawcy</dt><dd className="mt-1 text-white/65">Domyslnie jedno konkretne konto Allegro na konto firmy. Administrator moze indywidualnie zwiekszyc limit. Obecnie aktywne jest jedno polaczenie naraz, a przelaczanie wymaga autoryzacji Allegro.</dd></div>
          <div><dt className="font-bold">Koszty poza Wystawiaczem</dt><dd className="mt-1 text-white/65">Cena dostepu nie obejmuje prowizji, oplat za wystawienie lub promowanie ofert ani innych kosztow Allegro. Sprzedawca rozlicza je osobno z Allegro.</dd></div>
        </dl>
      </section>
      <section className="mb-10 grid gap-6 sm:grid-cols-2">
        <div><h2 className="text-xl font-bold">Zanim zaczniesz</h2><p className="mt-3 text-sm leading-7 text-white/65">Potrzebujesz internetu i aktualnej przegladarki. Dostep do folderu zdjec zalezy od obslugi w przegladarce; polecamy aktualny Chrome lub Edge na komputerze. HEIC wymaga dekodera przegladarki; jesli plik nie jest obslugiwany, wyeksportuj JPEG.</p></div>
        <div><h2 className="text-xl font-bold">Ty zatwierdzasz oferte</h2><p className="mt-3 text-sm leading-7 text-white/65">Sprawdz dane przed kliknieciem Wystaw. Program nie gwarantuje poprawnosci podpowiedzi ani przyjecia oferty przez Allegro. Zapisuj kopie sesji JSON i zachowuj oryginaly zdjec.</p></div>
      </section>
      <section className="mb-10 rounded-2xl border border-white/10 p-6"><h2 className="mb-4 text-xl font-bold">Sprzedawca i kontakt</h2><SellerDetails /><p className="mt-4 text-sm text-white/60">Oferta jest przygotowywana dla firm i osób prywatnych. Dokumenty sprzedaży są obecnie projektami do zatwierdzenia; płatności produkcyjne pozostają zablokowane.</p></section>
      <footer className="flex flex-wrap justify-between gap-4 border-t border-white/10 py-6 text-sm text-white/55">
        <span>Wystawiacz by Tymo</span>
        <LegalLinks />
      </footer>
    </div>
  </main>;
}
