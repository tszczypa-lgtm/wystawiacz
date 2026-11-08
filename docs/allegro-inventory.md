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

Testy bez kont produkcyjnych:

```text
node scripts/test-inventory.mjs
node scripts/test-inventory-browser.mjs
node scripts/test-allegro-connection-browser.mjs
node node_modules/typescript/bin/tsc --noEmit
```

Test przegladarki korzysta z lokalnego pakietu esbuild, Chrome i Playwright (PLAYWRIGHT_MODULE moze wskazac dolaczony runtime). Wszystkie API sa atrapami. Nie pobiera rzeczywistych ofert.
