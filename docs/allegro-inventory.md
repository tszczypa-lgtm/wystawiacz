# Moje oferty - etap tylko do odczytu

- Panel: `/panel/inventory`. Polaczenie konta: `/panel/allegro`.
- Korzysta z istniejacego, zaszyfrowanego polaczenia Allegro zalogowanego uzytkownika. Nie wymaga migracji bazy ani nowych sekretow.
- Nowy endpoint `GET /api/allegro/inventory` wywoluje tylko `GET /sale/offers`. Metody zapisu tego endpointu zwracaja 405. Istniejacy formularz wystawiania nie jest zmieniany.
- Odczyt oferty nie zmienia jej ceny, dostepnosci ani publikacji. Odnowienie wygaslego tokena OAuth moze zaktualizowac zaszyfrowane dane polaczenia, ale nie oferty.
- Filtry sa walidowane i kodowane przez URLSearchParams. Nie mozna wskazac innego sprzedawcy ani uzytkownika. Ochrona sesji i konta pozostaje taka sama jak dla innych tras Allegro.
- Strony po 20/50/100 ofert, z przejsciem do numeru strony; bez pobierania calego konta. API Allegro dopuszcza sume offset + limit do 10 000 000.
- Zaznaczenia dotycza tylko biezacej strony i sa kasowane przy pobieraniu. Nie ma operacji masowych, automatu, importu Ovoko ani domniemanego powiazania po numerze producenta.
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
- Nie dodaje kolejki masowej, publikacji, wycofywania ani synchronizacji. Korzysta z istniejacych migracji 011/012; nie wymaga nowej migracji ani sekretow.

Testy bez kont produkcyjnych:

```text
node scripts/test-inventory.mjs
node scripts/test-inventory-browser.mjs
node scripts/test-ovoko-transfer-inventory.mjs
node scripts/test-allegro-connection-browser.mjs
node node_modules/typescript/bin/tsc --noEmit
```

Test przegladarki korzysta z lokalnego pakietu esbuild, Chrome i Playwright (PLAYWRIGHT_MODULE moze wskazac dolaczony runtime). Wszystkie API sa atrapami. Nie pobiera rzeczywistych ofert.
