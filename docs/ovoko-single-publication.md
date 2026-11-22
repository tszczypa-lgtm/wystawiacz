# Pojedyncza proba Allegro -> Ovoko

## Wdrozenie

1. Wykonaj `supabase/012_ovoko_single_publications.sql` w SQL Editor Supabase. Tworzy tylko nowy rejestr prob z RLS i uprawnieniami service_role; nie zmienia ofert, aut ani magazynow.
2. Wdroz kod i ustaw `OVOKO_PUBLISH_ENABLED=true` w Cloudflare. Brak flagi lub inna wartosc blokuje zapis. `OVOKO_TEST_ENABLED=false` blokuje rowniez caly modul Ovoko.
3. Otworz Przygotuj do Ovoko przy jednej wlasnej ofercie Allegro. Proba jest tylko dla aktywnego administratora, jednej sztuki, bez zestawu i z kompletem dozwolonych zdjec.
4. Sprawdz numer, cene, kategorie, stan, marke i model. Lista Moje samochody Ovoko automatycznie odczytuje do 20 zapisanych aut wybranego modelu. Wybierasz rekord, a techniczny car_id wypelnia sie sam (rowniez automatycznie przy jednym pasujacym rekordzie). To nie ID modelu. Serwer ponownie odczytuje rekord i porownuje model przed zapisem. Nie tworzymy aut i nie zgadujemy VIN ani roku produkcji.
5. Kliknij widoczny u gory Wystaw 1 czesc w Ovoko lub Sprawdz pojedyncza wysylke na dole. Oba przyciski otwieraja podsumowanie bez zapisu. Lista Co blokuje wystawienie podaje konkretne braki. Potwierdz poprawne przypisanie rekordu auta i zweryfikowane ustawienia wysylki Ovoko. Dopiero Wyslij 1 czesc do Ovoko wykonuje jeden zapis.

Panel Ovoko oferuje Moje samochody oraz Nowy samochod / Sugerowane. Zrzuty potwierdzaja wymaganie modelu i roku przy nowym rekordzie, nie obowiazek recznego zakladania fizycznego dawcy z VIN. Nasz obecny zapis korzysta z istniejacego car_id. Jesli brakuje rekordu, dodaj go w Ovoko i uzyj Odswiez moje samochody. Tworzenie nowego rekordu i kopiowanie sugestii Ovoko przez API nie sa jeszcze zaimplementowane.

Tytul moze wymieniac kilka kompatybilnych modeli (Ford Edge / S-Max MK2 / Kuga). Dopasowania trafiaja do grupy na gorze listy; nie wybieramy arbitralnie jednego auta. Rozpoznajemy S-MAX/SMAX/S MAX oraz MK2/MKII/II. Pojedyncza rodzina i wyraznie najlepsza generacja nadal moga byc wybrane automatycznie.

## Zakres i zabezpieczenia

- Jedyna mutacja dostawcy: `POST /crm/importPart`. Nie ma update/delete, zmiany statusow istniejacych czesci, tworzenia aut, ustawiania miejsc skladowania ani modyfikacji Allegro.
- Zapis korzysta wylacznie z zaszyfrowanego polaczenia zalogowanego administratora. Dane dostepowe i adres dostawcy nie pochodza z formularza.
- Serwer sprawdza aktualna przynaleznosc oferty do sprzedawcy, stock=1, ACTIVE, zestaw, zdjecia oraz zgodnosc snapshotu. Powtarza odczyt Allegro i kontrole uprawnien tuz przed rezerwacja wysylki. Zmiana konta, roli, zawieszenie lub brak stanu blokuje probe.
- Kategorie poziomu 3, jakosc, status Na stanie, marka/model i istniejacy dawca sa ponownie odczytywane z Ovoko. Opony/felgi nie sa jeszcze obslugiwane z powodu dodatkowych atrybutow. Pozostale szczegolne wymagania dostawcy moga spowodowac odrzucenie proby.
- Zdjecia sa pobierane z aktualnej wlasnej oferty, tylko HTTPS na subdomenach allegroimg.com. Cala unikalna galeria, w kolejnosci Allegro, trafia do photos[0..n]; pierwszy adres rowniez do photo. Powtorzenia usuwamy bez blokowania wysylki; niedozwolone adresy i przekroczenie limitu 50 nadal blokuja. UI pokazuje liczbe przenoszonych zdjec i osobne liczniki powtorzen/odrzuconych adresow. Nie dopisujemy rozszerzen URL i nie zamieniamy formatu plikow.
- `external_id=tymo:<seller_id>:<offer_id>` sluzy identyfikacji powiazania. Przed zapisem odczytujemy Ovoko po tym external_id. Nie nadpisujemy znalezionej czesci.
- Trwaly klucz unikalny obejmuje hash loginu Ovoko, sprzedawce Allegro i oferte. Atomowy INSERT ignore-duplicates z potwierdzona odpowiedzia poprzedza zapis. Osobne konta Wystawiacza nie obchodza tego klucza. Hash formularza nie zawiera hasla/tokena; nie zapisujemy opisu ani zdjec w rejestrze prob.
- Timeout, redirect, nieprawidlowy wynik, odrzucenie dostawcy lub blad zapisu potwierdzenia pozostawia blokade sending/uncertain. Brak automatycznych ponowien i cofania operacji. Kolejne wywolanie dla potwierdzonej created zwraca zapisane part_id bez ponownej mutacji.
- Po niepewnym wyniku sprawdz konto Ovoko po numerze i external_id. NIE kasuj blokady ani nie zmieniaj powiazania, dopoki faktyczny wynik nie zostanie wyjasniony. Nie ma automatycznego odblokowania ani przycisku ponownej wysylki w tej sesji.
- R200 i part_id potwierdzaja utworzenie rekordu, nie widocznosc w sklepie. Recznie sprawdz zdjecia, cene, wysylke i widocznosc w Ovoko. Cennik Allegro nie jest przenoszony. Nie ma jeszcze synchronizacji sprzedazy: trzeba pilnowac dostepnosci na obu portalach.

## Weryfikacja

`scripts/test-ovoko-publish.mjs`: wszystkie uslugi sa atrapami; role/CSRF/flaga, wlasnosc, snapshot, dodatnia cena, jedna sztuka, slowniki, dawca-model, aktualnosc stanu i roli, brak trwalej blokady, duplikaty, jednoczesne zadania, replay i niepewne wyniki. `scripts/test-ovoko-preparation-browser.mjs`: brak wysylki przy otwarciu, dwa potwierdzenia, jeden finalny przycisk, podwojne klikniecie i brak ponowien. Dodatkowo testy inventory, read API, workerd, sugestii i TypeScript/build.

Nie wykonano migracji ani rzeczywistej publikacji automatycznie. Pierwsza proba konta nalezy do administratora po wdrozeniu.

Dokumentacja dostawcy: https://api.rrr.lt/docs/import_part.php oraz https://api.rrr.lt/openapi/swagger.yaml (odczyt dawcy i czesci V2). Sprawdzone 2026-11-22.
