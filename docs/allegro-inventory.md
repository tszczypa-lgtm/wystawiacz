# Moje oferty - etap tylko do odczytu

- Panel: `/panel/inventory`. Polaczenie konta: `/panel/allegro`.
- Korzysta z istniejacego, zaszyfrowanego polaczenia Allegro zalogowanego uzytkownika. Nie wymaga migracji bazy ani nowych sekretow.
- Nowy endpoint `GET /api/allegro/inventory` wywoluje tylko `GET /sale/offers`. Metody zapisu tego endpointu zwracaja 405. Istniejacy formularz wystawiania nie jest zmieniany.
- Odczyt oferty nie zmienia jej ceny, dostepnosci ani publikacji. Odnowienie wygaslego tokena OAuth moze zaktualizowac zaszyfrowane dane polaczenia, ale nie oferty.
- Filtry sa walidowane i kodowane przez URLSearchParams. Nie mozna wskazac innego sprzedawcy ani uzytkownika. Ochrona sesji i konta pozostaje taka sama jak dla innych tras Allegro.
- Strony po 20/50/100 ofert, z przejsciem do numeru strony; bez pobierania calego konta. API Allegro dopuszcza sume offset + limit do 10 000 000.
- Zaznaczenia dotycza tylko biezacej strony i sa kasowane przy pobieraniu. Administrator moze uruchomic partie kopiowania do Ovoko opisana ponizej. Nie ma masowych zmian Allegro ani domniemanego powiazania po numerze producenta.
- Cena i stan pochodza z listy ofert. ID zewnetrzne nie jest interpretowane jako pewny numer czesci. Cennik dostawy jest laczony po ID z lista cennikow konta. Brak nazwy cennika pokazuje ID, nie wymyslona nazwe.
- Bledy Allegro, limity i niepelne odpowiedzi nie sa przedstawiane jako poprawna pusta lista. Poprzednie wyniki i zaznaczenia znikaja, aby nie sugerowac aktualnosci danych.
- Lista odswieza sie na zadanie, nie stanowi kopii zapasowej ani migawki magazynu. Zmiany ofert podczas stronicowania moga przesunac wyniki. Brak ofert nigdy nie uruchamia wycofywania.

Dokumentacja API: https://developer.allegro.pl/documentation/#operation/searchOffersUsingGET

## Filtr przeniesienia do Ovoko (administrator)

- Przy aktualnym polaczeniu Ovoko: Wszystkie, Nieprzeniesione, Przeniesione, W trakcie przenoszenia, Blad / do sprawdzenia. To status lokalnego rejestru publikacji, nie status sprzedazy ani synchronizacji stanow.
- Przy potwierdzonym przeniesieniu lista pokazuje ID czesci Ovoko. Rejestr jest laczony po hashu aktualnego loginu API Ovoko, ID zalogowanego sprzedawcy Allegro i ID oferty Allegro, nigdy po numerze czesci lub zdjeciu. Oferta dodana poza tym rejestrem nie jest automatycznie uznawana za przeniesiona. Usuniecie czesci w Ovoko nie kasuje historii przeniesienia.
- `created` z poprawnym part_id oznacza Przeniesione; `sending` oznacza W trakcie; `uncertain` lub niepelny zapis created oznacza Do sprawdzenia. Brak rekordu po udanym odczycie oznacza Nieprzeniesione. Blad bazy/polaczenia oznacza status nieustalony, nie brak publikacji.
- `POST /api/ovoko/transfer-inventory` jest tylko do odczytu: wymaga aktywnego administratora, sesji i zgodnego Origin, ma limit 30 wywolan na minute na uzytkownika w instancji. Pobiera zapisane zaszyfrowane polaczenie, nie przyjmuje loginu ani wskazanego przez klienta sprzedawcy/odbiorcy.
- Domyslna lista pobiera jedna strone Allegro i osobno jej statusy. Filtr przeniesienia sprawdza kolejne strony Allegro w kolejnosci wybranego sortowania, do 5 stron po 100 ofert na zadanie; zwraca do wybranego limitu dopasowan. Nie pobiera calego konta w tle.
- Nawigacja filtrowana uzywa kursora pozycji Allegro i historii poprzednich partii; nie udaje dokladnej liczby stron dopasowan. Licznik Allegro jest opisany jako liczba przed filtrem przeniesienia. Pusta partia z dalszym kursorem pozwala szukac dalej. Zmiany danych Allegro podczas nawigacji moga przesuwac wyniki.
- Sam filtr niczego nie publikuje ani nie wycofuje. Korzysta z istniejacych migracji 011/012; nie wymaga nowej migracji ani sekretow.

## Przenoszenie zaznaczonych i korekta ceny

- Panel administratora pod filtrami: zaznacz do 100 ofert na aktualnej stronie, wybierz Bez zmiany / Zmien o kwote / Zmien procentowo i kliknij Przenies zaznaczone do Ovoko. Podglad pokazuje cene Allegro i docelowa cene Ovoko przed rozpoczeciem. Minus obniza, plus podwyzsza. Kwota jest w walucie danej oferty PLN/EUR, bez przewalutowania; inne waluty i niepoprawne lub niedodatnie ceny sa blokowane.
- Ceny sa liczone w calkowitych groszach, procent z dokladnoscia do 0.01 punktu procentowego, zaokraglenie polowek w gore do grosza. Korekta dotyczy tylko nowo tworzonej czesci Ovoko; nie aktualizuje cen Allegro ani juz przeniesionych czesci.
- `POST /api/ovoko/bulk` wymaga aktywnego administratora, zgodnego Origin, flagi OVOKO_PUBLISH_ENABLED i zapisanych polaczen. Operacje start / prepare / item maja osobne limity 10/minute na uzytkownika w instancji. Start przypina ID sprzedawcy i odcisk polaczenia Ovoko. Zmiana konta lub kluczy przerywa partie, rowniez w trakcie tworzenia auta/publikacji.
- Przygotowanie korzysta z tych samych funkcji rozpoznawania numerow, kategorii, stanu, marki i modelu co widok pojedynczy. Sprawdza komplet danych przed ewentualnym utworzeniem auta, wykorzystuje istniejace auto albo tworzy katalogowy rekord z dotychczasowa ochrona. Przygotowanie auta i wysylka czesci to osobne zadania, aby ograniczyc liczbe wywolan w pojedynczym Workerze.
- Pozycje sa przetwarzane po kolei w otwartej karcie, z migawki zaznaczenia i korekty. Uspiona lub zamknieta karta nie jest trwala kolejka serwerowa. Odswiezenie nie wznawia jej automatycznie. Zostaja trwale rejestry utworzonych aut i publikacji, blokujace duplikaty.
- Cena z aktualnej oferty jest ponownie sprawdzana i wyliczana na serwerze. Zmiana oferty, cen, zdjec, kont lub uprawnien zatrzymuje wysylke. Cala galeria, opis i pelne numery sa przekazywane zwyklym, chronionym mechanizmem pojedynczej publikacji. Nie przenosimy cennika wysylki Allegro; obowiazuja ustawienia Ovoko.
- Rejestr utworzonej publikacji powoduje pominiecie, nie kolejna publikacje ani aktualizacje. Niepewny wynik, blad infrastruktury, limit lub brak uprawnien zatrzymuja pozostale pozycje bez automatycznego ponawiania. Blad brakujacych danych (400) jest pokazany przy pozycji i pozwala przejsc do kolejnej. Przycisk Zatrzymaj po biezacej nie anuluje trwajacego zapisu; moze pozostawic przygotowane auto bez wyslanej czesci.
- Ograniczenia dotychczasowej publikacji pozostaja: aktywna oferta, jedna sztuka, bez zestawu, opony/felgi nieobslugiwane. Brak automatycznej synchronizacji sprzedazy lub wycofywania. Wymaga istniejacych migracji 011-013; bez nowego SQL.

Testy bez kont produkcyjnych:

```text
node scripts/test-inventory.mjs
node scripts/test-inventory-browser.mjs
node scripts/test-ovoko-transfer-inventory.mjs
node scripts/test-ovoko-bulk-price.mjs
node scripts/test-ovoko-publish.mjs
node scripts/test-allegro-connection-browser.mjs
node node_modules/typescript/bin/tsc --noEmit
```

Test przegladarki korzysta z lokalnego pakietu esbuild, Chrome i Playwright (PLAYWRIGHT_MODULE moze wskazac dolaczony runtime). Wszystkie API sa atrapami. Nie pobiera rzeczywistych ofert.
