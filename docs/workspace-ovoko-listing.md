# Ovoko w formularzu wystawiania

## Wdrozenie

1. Uruchom `supabase/027_workspace_vehicles.sql` (jesli jeszcze nie wykonany),
   potem `supabase/028_workspace_ovoko_drafts.sql` w Supabase SQL Editor.
   Migracje nie usuwaja ofert ani sesji.
2. Wyslij commit przez GitHub Desktop: Push origin. Poczekaj na build Cloudflare.
3. Odswiez formularz. Konto musi miec polaczone Allegro i Ovoko oraz dostep do publikacji.

## Korzystanie

- Formularz ma osobne przyciski Wystaw Allegro, Wystaw Ovoko i Wystaw Allegro i Ovoko.
- Cena Ovoko jest obok ceny Allegro; automatyczna kategoria jest pod kategoria Allegro.
  Pola i przyciski Ovoko maja granatowe tlo, bez dodatkowego dlugiego panelu.
- W oknie aut podaj skrot/opis. Dodane lub edytowane auto trafia do trwalej listy
  Moje samochody i do biezacej sesji. Usuniecie z sesji nie usuwa go z biblioteki.
- W opcjonalnych danych Ovoko wybierz marke, model i rok. VIN, silnik,
  pojemnosc, moc w kW, przebieg, kolor i miejsce sa opcjonalne.
- Zaznaczenie zapisu do Ovoko i Dodaj/Zapisz tworzy konkretnego dawce w Ovoko.
- Przycisk Historia samochodow otwiera przeszukiwalna historie wszystkich zapisanych
  aut i wszystkich starszych sesji. Strony pobieraja sie automatycznie do konca.
  Klikniecie auta uzupelnia biezaca aukcje bez dodawania auta do listy sesji.
- Podaj osobna cene Ovoko za sztuke (PLN), bez przeliczania walut.
- Kategoria/jakosc/status/numer czesci sa mapowane obecnym mechanizmem.
  Kategorie mozna wybrac recznie; zdjecia i rozwiniety opis pochodza z Allegro.
- Przy obu portalach publikacja jest sekwencyjna: Allegro, potem Ovoko. Po bledzie drugiego kanalu
  uzyj Popraw Ovoko / Ponow tylko Ovoko. Nie powstaje druga oferta Allegro.
- Samo Ovoko nie tworzy aukcji Allegro ani nie wymaga jego kategorii, zwrotow i lokalizacji.
  Korzysta z dotychczasowego uploadu zdjec przez polaczone Allegro. Wiele sztuk
  publikuje jako osobne rekordy Ovoko, bo nie ma oferty Allegro sterujacej zapasem.
- Bez wybranego fizycznego dawcy przygotowanie uzywa tego samego mechanizmu
  co przenosiny. Dla szkicu bez oferty Allegro rozpoznanie numeru korzysta rowniez
  z istniejacego wyszukiwania internetowego; nie udajemy dostepu do nieistniejacej aukcji.
- Polaczenie ofert korzysta z dotychczasowego trwalego SKU i rejestru publikacji.
  Samo wystawienie nie wlacza synchronizacji sprzedazy; ma ona osobne przelaczniki.

## Trwalosc i ograniczenia

Samochod jest identyfikowany UUID biblioteki, nie samym modelem/rokiem. Dwa auta
tego samego modelu nie sa automatycznie scalane. Serwer sprawdza wlasciciela,
polaczenie konta i konkretny rekord dawcy przed publikacja. Dane techniczne
polaczonego auta sa niezmienne; blednego dawce nalezy dodac jako nowe auto.

Tworzenie samochodu ma trwala rezerwacje i stabilny `external_id`. Po niepewnej
odpowiedzi nie wysylamy slepo kolejnego zapisu. Czesc uzywa istniejacego rejestru
publikacji i ochrony przed duplikatami. Nie ma atomowej transakcji miedzy portalami;
Allegro moze byc wystawione, gdy Ovoko wymaga poprawy lub ponowienia.

Historia pobiera wszystkie strony biblioteki oraz sesji (bez pobierania produktow
sesji). Wyszukiwarka dziala podczas pobierania i po zakonczeniu obejmuje cala historie.
Samodzielne publikacje maja osobny rejestr, podpisane przygotowanie i SKU
`tymo:draft:...`, ktore nie udaje powiazania z oferta Allegro. Rozpoczetego szkicu
Ovoko nie przeksztalcamy w druga publikacje Allegro. Brak potwierdzenia zapisu
zachowuje blokade duplikatu; bledy przed wysylka pozwalaja poprawic szkic.

## Weryfikacja

- `scripts/test-workspace-vehicles.mjs`: walidacja, CAS, zakres konta, tozsamosc dawcy.
- `scripts/test-workspace-vehicles-sql.mjs`: prawdziwy PostgreSQL/PGlite, RLS i rezerwacje.
- `scripts/test-listing-ovoko-browser.mjs`: rzeczywisty formularz, biblioteka i ponowienie kanalu.
- `scripts/test-ovoko-publish.mjs`: istniejacy przeplyw i nowy kanal z konkretnym dawca.
- `scripts/test-workspace-layout.mjs`, `test-approved-workspace.mjs`, `test-workspace-server.mjs`.

Testy nie publikuja prawdziwych ofert; API portali jest zastepowane kontrolowanymi odpowiedziami.
