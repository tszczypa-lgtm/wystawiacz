import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dokumentacja Wystawiacza | Tymo Garage",
  description: "Opis Wystawiacza, połączenia konta Allegro, uprawnień i pracy z sesjami produktów.",
};

export default function DocumentationPage() {
  return (
    <main className="min-h-screen bg-[#0d1117] px-5 py-12 text-white">
      <article className="mx-auto grid max-w-3xl gap-8 leading-7">
        <header>
          <a href="/" className="font-bold text-[#ff8a3d]">Tymo Garage · Wystawiacz</a>
          <h1 className="mt-5 text-4xl font-black">Dokumentacja Wystawiacza</h1>
          <p className="mt-4 text-white/70">Narzędzie do przygotowywania ofert używanych części samochodowych i ich publikowania na własnym koncie sprzedawcy Allegro.</p>
          <p className="mt-4 rounded-xl border border-amber-300/20 bg-amber-300/10 p-4 text-amber-100">Wersja rozwojowa. Integracja Allegro wymaga konfiguracji administratora oraz sprawdzenia na rzeczywistym koncie. Płatności i abonamenty nie są uruchomione.</p>
        </header>
        <section>
          <h2 className="text-2xl font-bold">Połączenie konta Allegro</h2>
          <ol className="mt-4 list-decimal space-y-2 pl-6 text-white/75">
            <li>Załóż konto w Wystawiaczu, potwierdź adres e-mail i zaloguj się.</li>
            <li>W panelu kliknij „Połącz z Allegro”. Zezwól przeglądarce na otwarcie okna autoryzacji.</li>
            <li>Na stronie Allegro sprawdź konto, z którym chcesz pracować, i zaakceptuj dostęp aplikacji.</li>
            <li>Po zakończeniu autoryzacji wróć do panelu. Dane połączenia są przypisane do konta użytkownika Wystawiacza.</li>
          </ol>
          <p className="mt-4 text-white/75">Użytkownik nie rejestruje własnej aplikacji ani nie wpisuje Client ID, Client Secret czy hasła Allegro w Wystawiaczu. Hasło i ewentualne dodatkowe potwierdzenie podaje wyłącznie na stronie Allegro. Aplikację integracyjną konfiguruje administrator Tymo Garage.</p>
        </section>
        <section>
          <h2 className="text-2xl font-bold">Przygotowanie i wystawianie ofert</h2>
          <ol className="mt-4 list-decimal space-y-2 pl-6 text-white/75">
            <li>Wskaż folder zdjęć i wybierz zdjęcia części, w tym zdjęcie główne.</li>
            <li>Wpisz numer części oraz tytuł. Możesz dodać modele aut do pomocniczej listy sesji.</li>
            <li>Sprawdź opis, kategorię, parametry, liczbę sztuk oraz szablony wysyłki, zwrotów i reklamacji pobrane z połączonego konta Allegro.</li>
            <li>Dodaj produkt do listy. Cena może zostać uzupełniona później podczas wyceny.</li>
            <li>Przed publikacją uzupełnij cenę, wymagane parametry i lokalizację. Przycisk „Wystaw” prosi o potwierdzenie jednej konkretnej oferty.</li>
          </ol>
          <p className="mt-4 text-white/75">Sprzedawca odpowiada za sprawdzenie poprawności tytułu, opisu, zdjęć, parametrów, ceny i warunków sprzedaży. Podpowiedzi programu nie zastępują tej kontroli.</p>
        </section>
        <section>
          <h2 className="text-2xl font-bold">Sesje i zdjęcia</h2>
          <p className="mt-4 text-white/75">„Zapisz sesję” pobiera plik JSON z listą produktów i aut. „Otwórz sesję” pozwala odczytać go ponownie lub przekazać go drugiej osobie do wyceny. Zdjęcia nie są osadzane w tym pliku: należy ponownie wskazać folder zawierający pliki o tych samych nazwach.</p>
          <p className="mt-3 text-white/75">Zapisz sesję przed zamknięciem lub odświeżeniem strony. Obecna wersja nie zapewnia automatycznego zapisu sesji ani współdzielonego magazynu zdjęć w chmurze. Zdjęcia oferty są przekazywane do Allegro przy publikacji.</p>
        </section>
        <section>
          <h2 className="text-2xl font-bold">Uprawnienia i bezpieczeństwo</h2>
          <p className="mt-4 text-white/75">Konfiguracja integracji obejmuje odczyt i zapis ofert, odczyt i zapis ustawień sprzedaży oraz odczyt profilu sprzedawcy. Profil służy do identyfikacji połączonego konta. Program nie żąda dostępu do płatności, zamówień ani wiadomości.</p>
          <p className="mt-3 text-white/75">Autoryzacja wykorzystuje OAuth Authorization Code z PKCE. Tokeny Allegro są przechowywane na serwerze w postaci zaszyfrowanej i nie są udostępniane przeglądarce. Klucze wspólnej aplikacji pozostają po stronie serwera.</p>
          <p className="mt-3 text-white/75">„Przełącz konto” usuwa zapisane połączenie z Wystawiacza, ale nie usuwa opublikowanych ofert. Pełne cofnięcie zgody aplikacji można wykonać w ustawieniach powiązanych aplikacji na Allegro.</p>
        </section>
        <footer className="border-t border-white/10 pt-5 text-sm text-white/50">Dokumentacja wersji rozwojowej · Tymo Garage</footer>
      </article>
    </main>
  );
}
