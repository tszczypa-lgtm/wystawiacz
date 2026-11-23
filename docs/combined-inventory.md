# Wspolna lista czesci

`/panel/inventory` pokazuje wspolny podglad Allegro i Ovoko. Starszy `/panel/inventory/ovoko` otwiera ten sam komponent z zaznaczonym Ovoko. To etap listy, nie synchronizacja stanow, rezerwacje ani master-magazyn.

- Jeden cienki pasek filtrow, kompaktowe wiersze okolo 40 px, tekst 12 px, miniatury 32 px. Dlugie tytuly maja pelna tresc w podpowiedzi. Rozwiniecie Wiecej zawiera inne statusy, historie transferu i objasnienia.
- Checkboxy Allegro / Ovoko dzialaja jak suma zbiorow; Na obu jest osobnym filtrem. Tylko Allegro / Tylko Ovoko wymagaja kompletnego odczytu drugiego portalu. Blad API nie jest dowodem nieobecnosci.
- Allegro aktywne to publication.status=ACTIVE. Ovoko Na stanie to slownik statusow dostawcy, nie potwierdzona widocznosc w marketplace. Inne statusy sa dostepne opcjonalnie.
- Laczymy tylko rzeczywiscie odczytane rekordy: pelne ID powiazania z rejestru aktualnego konta albo dokladny external_id `tymo:seller:offer` zgodny z odczytanym sprzedawca. Nie laczymy po OEM, zdjeciu ani podobnym tytule. Sprzeczne albo wielokrotne powiazania pozostaja osobnymi oznaczonymi wierszami; nie mozna ich zbiorczo przenosic.
- Historia transferu bez aktualnego rekordu Ovoko nigdy nie tworzy oznaczenia Na stanie. Wskazniki portali reprezentuja ostatni odczyt, nie dzialajaca synchronizacje w tle.
- Osobne ceny; Ovoko ma oznaczona niepotwierdzona walute zgodnie z obecnym kontraktem parsera. Filtr ceny i sortowanie cenowe dotycza Allegro w walucie oferty, bez FX. Wartosci bez ceny sa na koncu sortowania.
- 20/50/100/200 wierszy na stronie. Zaznaczenia tylko widocznej strony, czyszczone po filtrach/nawigacji/odswiezeniu. Przenoszenie nadal korzysta z istniejacego osobnego okna i zabezpieczen serwera. Czesci tylko Ovoko nie sa kopiowane na Allegro przez ten etap.

## Odczyt

Istniejace autoryzowane API, bez migracji, nowych uprawnien ani operacji publikacji przy montowaniu listy. Allegro: strony po 200, Ovoko: po 100. Jedna partia doczytuje do 2000 rekordow kazdego zrodla, pokazuje postep. Dla wiekszych zbiorow przycisk Wczytaj dalsze czesci; wyniki i liczniki sa jawnie opisane jako wczytane, nie globalna migawka. Pierwsza partia obejmuje konto z 1500 pozycjami. Lokalne okno budzetu ogranicza czytnik Ovoko do 25 stron na 61 sekund; bledy limitow wymagaja jawnej kolejnej proby.

Filtry i paginacja dzialaja lokalnie na odczytanym zbiorze; nie odpytywuja API przy kazdym znaku. Dane sa tylko w pamieci karty, bez zapisu do localStorage. Zmiana konta Wystawiacza, sprzedawcy Allegro, uprawnien lub czasu weryfikacji polaczenia Ovoko przerywa/wyrzuca odpowiedni odczyt. Niepelna strona, zmieniony licznik lub duplikaty sa bledem, nie pusta lista. Udany odczyt drugiego portalu moze byc pokazany niezaleznie od awarii pierwszego.

Testy: `test-combined-inventory.mjs`, `test-combined-inventory-client.mjs`, `test-combined-inventory-browser.mjs`, `test-account-shell-browser.mjs`. Wszystkie dane i API w testach sa atrapami. Testy przegladarki zapisuje podglady do `outputs/combined-inventory`.
