# Zmiany Wystawiacza - uruchomienie

Punkt wyjsciowy: tag `backup-2026-10-12-before-approved-changes`.
Nie zmieniono zadnych istniejacych aukcji w Allegro. Testy uzywaja atrap API.

## Zmiany interfejsu

- Zaznaczanie aukcji i sekwencyjne wystawianie zaznaczonych; opublikowane sa pomijane.
- Edycja opublikowanej aukcji otwiera Allegro, nie formularz tworzenia nowej oferty.
- Wyszukiwanie wlasnych aktywnych ofert po numerze w tytule, z pelnym dopasowaniem numeru (nie wariantu z inna koncowa litera).
- Kopiowanie tytulu, opisu, kategorii, parametrow, ceny, liczby jednostek, wysylki, zwrotow, reklamacji i GPSR. Biezace lokalne zdjecia zostaja. Polaczenie katalogowe nie jest automatycznie wlaczane.
- Model auta z listy zmienia tytul. W opisie zmienia tylko rozpoznany, jednoznaczny blok auta; dla nieznanych opisow zaznacz stary fragment i wybierz `Wstaw dane auta tutaj`. Program nie zgaduje, jakie akapity usunac.
- Opis i pelny opis auta obsluguja akapity, pogrubienie i listy. Przyciski edytora dodaja bezpieczne oznaczenia `**tekst**` i `- element`; podglad i Allegro otrzymuja formatowanie, nie surowy HTML.
- Zapis wlasnego szablonu z miejscem na auto na koncie uzytkownika (wymaga migracji).
- Link do cennikow wysylki w Allegro, kompaktowe pola reklamacji.
- Uporzadkowana tabela wyszukiwania po numerze/tytule: Allegro, Google, Ovoko, Otomoto, OLX.
- Import sesji nie osadza obcych adresow obrazow ani surowego HTML z liczby sztuk.
- Wybrane HEIC/HEIF, nieobslugiwane typy i obrazy powyzej 20 MB sa przygotowywane do JPEG w tle, kolejno. Zwykle JPEG/PNG/WebP nie sa przeliczane bez potrzeby. Po odrzuceniu obrazu HTTP 400 jedna proba JPEG usuwa problematyczne metadane. Publikacja oferty nigdy nie jest automatycznie ponawiana.
- Przegladarka musi umiec odczytac plik HEIC; jesli nie umie, aplikacja poprosi o eksport JPEG. Bez oryginalnego problematycznego pliku nie mozna potwierdzic naprawy wszystkich zdjec z iPhone'a.

## Baza danych - przed wlaczeniem funkcji serwerowych

1. Wykonaj kopie bazy Supabase.
2. W SQL Editor uruchom JEDEN RAZ plik `supabase/004_workspace_and_pairing.sql`, po wczesniej wykonanej migracji 003.
3. Sprawdz w srodowisku testowym sesje dwoch roznych uzytkownikow, dwie karty tej samej sesji i administratora. Migracja nie zostala wykonana przez agenta i nie byla przetestowana na prawdziwym PostgreSQL.
4. Po migracji udostepnione sa zapis sesji, 20 poprzednich wersji i wlasne szablony. Zdjecia nadal pozostaja lokalne. Autozapis wlacza sie ptaszkiem w menu `Serwer`, co 15 sekund. Otwieranie starszej wersji tworzy nowa sesje, nie niszczy nowszej. Przy konflikcie innej karty autozapis zatrzymuje sie; mozna wyeksportowac JSON.

## Flagi Cloudflare - etapowe wlaczenie

Nie zmieniono konfiguracji dzialajacego serwera ani jego sekretow.

- `PUBLICATION_DEDUP_ENABLED=true`: wymaga migracji 004 i odswiezenia starych kart. Rejestr publikacji chroni przed dwiema kartami, powtorka ze starego JSON i utracona odpowiedzia. Nowe oferty otrzymuja techniczna sygnature `wystawiacz-UUID`. Po niepewnym wyniku kolejna proba najpierw szuka tej sygnatury we wlasnym asortymencie. Jesli wyniku nie mozna potwierdzic, odmawia utworzenia duplikatu.
- `ALLEGRO_PAIRING_ENFORCED=true`: domyslnie 1 sprzedawca Allegro na konto firmy. Dotychczasowe polaczenie jest rejestrowane przed rozpoczeciem zmiany. Nieudane parowanie nie nadpisuje tokena. Logout nie zwalnia przypisania. Administrator w `Konta Allegro` zmienia limit (np. 2) lub zwalnia wskazane konto do zastapienia. Zwalnianie odlacza token, nie modyfikuje aukcji. Obecna aplikacja przechowuje jedno aktywne polaczenie naraz; dozwolone drugie konto mozna sparowac przy przelaczaniu.
- `TRIAL_ENABLED=true`: 30 dni triala, z zachowaniem najwczesniejszej daty dla zadeklarowanego NIP oraz powiazanego sprzedawcy Allegro. Samo zalozenie nowego adresu e-mail nie restartuje triala. Zadeklarowany NIP nie jest weryfikacja tozsamosci firmy.
- `BILLING_ENFORCED`: pozostaw obecna wartosc / `false` do uruchomienia i przetestowania platnosci. Po wlaczeniu brak dostepu blokuje publikacje, ale nie kasuje aukcji, JSON ani sesji. Przygotowanie danych, odczyt konta i zapis sesji pozostaja dostepne, chyba ze administrator zawiesi konto.
- `BILLING_ENABLED`: nie wlaczaj starych platnosci Stripe jako zamiennika Tpay.

Administrator moze przedluzyc dostep przez istniejace `Nadaj darmowy dostep` z konkretna data.
Przypomnienie o koncu triala jest w panelu i przy Wystawiaczu w ostatnich 3 dniach; nie sa wysylane e-maile.

## Tpay - aktualizacja przygotowania integracji

Dodano osobny, domyslnie wylaczony checkout Tpay, weryfikacje powiadomien
JWS/sumy kontrolnej i atomowe rozliczenie w migracji 005. Aktualna instrukcja:
`TPAY-SETUP.md`. Wczesniejszy stan i plan ponizej nie oznaczaja uruchomienia
nowej integracji. Potrzebne sa nadal sandbox end-to-end, weryfikacja firmy,
dokumenty sprzedazy i osobna akceptacja produkcji. Stripe pozostaje wylaczony.

Ustalona cena: **500 zl brutto / miesiac**. Uzytkownik nie ma jeszcze konta Tpay.
Nie uruchomiono obciazen ani produkcyjnego checkoutu Tpay. Nie dodano cyklicznych zgod. Dotychczasowy kod Stripe nie zostal wlaczony.

1. Zaloz i zweryfikuj konto firmowe: https://tpay.com/ .
2. Utworz tez konto testowe: https://register.sandbox.tpay.com/ .
3. Po aktywacji integracja wymaga API OAuth, tworzenia transakcji 500 PLN oraz zweryfikowanych powiadomien JWS i sumy kontrolnej. Sam powrot do aplikacji po platnosci NIE przyznaje dostepu.
4. Najpierw testy sandbox: platnosc udana, anulowana, bledna kwota, powtorzony webhook, dwie karty, wygasniecie, zawieszenie i odnowienie. Dopiero potem wlaczenie platnosci.
5. Na poczatek jednorazowy BLIK za kolejny miesiac. Automatyczne odnawianie nie jest teraz wdrazane.

Oficjalne dokumenty: https://docs-api.tpay.com/en/first-steps/first-transaction/ oraz https://docs-api.tpay.com/en/webhooks/ .
Nie przesylaj kluczy na czacie; pozniej beda sekretami serwera.

## Automatyczny podglad najnizszych cen - pozostaje do uzgodnienia dostepu

Przyciski wyszukiwania sa dodane. Nie dodano scrapingowego pobierania cen ani nie przedstawiono wynikow Google jako potwierdzonej wyceny.
Allegro ogranicza `/offers/listing` do zweryfikowanych aplikacji; nie potwierdzono tego uprawnienia dla tej aplikacji.
Dla pozostalych serwisow potrzebna jest dostepna i dozwolona integracja oraz wiarygodna informacja o stanie towaru. Sam brak slowa `uszkodzony` nie dowodzi sprawnosci.
Podglad powinien pokazywac najtansza pasujaca z pobranych ofert, link, stan deklarowany i osobno dostawe. Nie obiecywac najnizszej ceny calego rynku.

## Weryfikacja i publikacja

Testy: `test-approved-workspace.mjs`, `test-workspace-server.mjs`, `test-workspace-layout.mjs`, `test-publishing.mjs`, `test-allegro-port.mjs`, `test-accounts.mjs` oraz dotychczasowe testy zdjec i tytulow.
Testy serwerowe uzywaja atrap transakcji bazy; nie zastepuja wykonania SQL w srodowisku testowym.
Lokalny pelny build nadal zatrzymuje sie na znanym bledzie Windows EPERM przy rozpoznawaniu zaleznosci w node_modules. Pelny typecheck ma dotychczasowe bledy typow Supabase/Vite; w zmienionych nowych modulach nie zglosil nowych bledow. Nie oznacza to potwierdzenia buildu Cloudflare.
Po sprawdzeniu zmian `Push origin` w GitHub Desktop uruchamia dotychczasowy proces Cloudflare. Nie zmieniaj sekretu szyfrowania Allegro.
Powrot do starego kodu nie usuwa sesji ani wpisow nowych tabel; nie kasuj nowych tabel przy rollbacku. Nie usuwaj rejestru publikacji, bo utracisz ochrone przed powtorkami.
Luzne pomysly (magazyn, szablony kategorii, dodatkowa historia i optymalizacje) nie zostaly wprowadzone.
