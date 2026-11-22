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

- Pod filtrami jest tylko przycisk Przenies zaznaczone do Ovoko. Zaznacz do 100 ofert na aktualnej stronie i otworz osobne okno `/panel/inventory/transfer-ovoko`; tam wybierz Bez zmiany / Zmien o kwote / Zmien procentowo i uruchom partie. Podglad pokazuje cene Allegro i docelowa cene Ovoko przed rozpoczeciem. Minus obniza, plus podwyzsza. Kwota jest w walucie danej oferty PLN/EUR, bez przewalutowania; inne waluty i niepoprawne lub niedodatnie ceny sa blokowane.
- Zaznaczenie jest przekazywane jednorazowo przez postMessage tylko miedzy konkretnym oknem otwierajacym i otwartym oknem tego samego origin; bez zapisu w localStorage ani kluczy w URL. Okno ponownie sprawdza administratora i format zaznaczenia. Przy zablokowanym popupie lista pokazuje komunikat. Bez przekazania zaznaczenia nowa trasa nie uruchamia partii. Zmiana filtrow/nawigacja na liscie nie zmienia migawki ani nie zatrzymuje juz otwartego okna.
- Ceny sa liczone w calkowitych groszach, procent z dokladnoscia do 0.01 punktu procentowego, zaokraglenie polowek w gore do grosza. Korekta dotyczy tylko nowo tworzonej czesci Ovoko; nie aktualizuje cen Allegro ani juz przeniesionych czesci.
- `POST /api/ovoko/bulk` wymaga aktywnego administratora, zgodnego Origin, flagi OVOKO_PUBLISH_ENABLED i zapisanych polaczen. Operacje start / prepare / item maja osobne limity 10/minute na uzytkownika w instancji. Start przypina ID sprzedawcy i odcisk polaczenia Ovoko. Zmiana konta lub kluczy przerywa partie, rowniez w trakcie tworzenia auta/publikacji.
- Przygotowanie korzysta z tych samych funkcji rozpoznawania numerow, kategorii, stanu, marki i modelu co widok pojedynczy. Sprawdza komplet danych przed ewentualnym utworzeniem auta, wykorzystuje istniejace auto albo tworzy katalogowy rekord z dotychczasowa ochrona. Przygotowanie auta i wysylka czesci to osobne zadania, aby ograniczyc liczbe wywolan w pojedynczym Workerze.
- Kilka marek nie blokuje juz wyboru: marka pojazdu z parametru ma pierwszenstwo, a przy kilku rozpoznanych markach wybieramy pierwsza wymieniona (takze alias VW). Kolejnosc slownika nie zmienia wyniku. Zlozone nazwy Land Rover pozostaja wazniejsze niz zawarte w nich Rover. Nieznany jawny parametr marki nadal blokuje zgadywanie z tytulu.
- Gdy dla pierwszej marki nie znaleziono modelu, partia sprawdza modele pozostalych wymienionych marek (maksymalnie 5 dodatkowych). Jesli znajdzie model w danych oferty, uzywa go przed modelem pomocniczym.
- W osobnym oknie jest opcjonalny Model pomocniczy: pobiera marki i modele ze slownikow Ovoko po rozwinieciu. Uzytkownik wybiera raz sprawdzony model dla partii, np. gdy tytuly zawieraja samo Citroen / Peugeot / Opel. Wybor jest zamrazany przy starcie i uzywany tylko przy braku rozpoznanego modelu oraz zgodnej marce. Model musi nalezec do wybranej marki; jawnie sprzeczna generacja jest blokowana. Parametr pojedynczej marki pojazdu nie moze zostac nadpisany inna marka pomocnicza. Wynik pozycji pokazuje uzyte auto i oznaczenie modelu pomocniczego.
- Przed modelem pomocniczym automat probuje dopasowania z `Pasuje do`: sekcja wlasnej oferty Allegro, sugerowana sekcja dla tej oferty, a nastepnie katalog Allegro `mode=MPN` po pelnym numerze czesci. Dla katalogu sprawdzamy pelny numer w parametrze producenta (zachowujac indeks i zera) oraz taka sama kategorie Allegro lub kategorie podobna wskazana przez samo Allegro. Bierzemy maksymalnie szesc produktow i 200 unikatowych wierszy. W trybie masowym `expand=1` sprawdza katalog takze wtedy, gdy wczesniejsze wiersze Pasuje do nie daly modelu Ovoko. Dopasowanie bierze rowniez nazwe produktu oraz pary Marka pojazdu / Model pojazdu z tego samego zweryfikowanego produktu. Jesli MPN nie daje poprawnego produktu, wykonujemy wyszukanie pelnego numeru jako frazy, nadal wymagajac dokladnej zgodnosci numeru w parametrach. Dane katalogu sa tylko odczytywane; oferty nie sa laczone z produktami.
- Nowy `GET /api/allegro/ovoko-fitment/{offerId}?number={pelnyNumer}` wymaga sesji i potwierdzenia wlasnosci oferty z aktualnego polaczenia. Parametr number jest opcjonalny: bez niego nadal czytamy wlasne Pasuje do i sugestie dla oferty, ale nie przeszukujemy katalogu MPN. Publikacja bez numeru jest dozwolona, jesli pozostale wymagane dane sa kompletne. Odczyty sa ograniczone do stalych tras Allegro; timeout 10 s na zapytanie. Tylko 404/422 opcjonalnego dopasowania oznacza brak pozycji; bledy limitow/infrastruktury i nieprawidlowe schematy nie udaja poprawnego dopasowania.
- Kazdy wiersz Pasuje do jest mapowany oddzielnie na marke/model Ovoko. Nie laczymy marki jednego wiersza z modelem innego. Marki wynikajace z danych oferty ograniczaja wybor, a jawnie sprzeczne generacje sa odrzucane. Wynik pokazuje auto i zrodlo (Dane oferty / Pasuje do Allegro / Katalog Allegro - pelny MPN). Aliasowanie polskich nazw radia/nawigacji oraz jednostek multimedialnych NAC/RCC uzupelnia kategorie radia, gdy brak literalnego slowa Radio.
- To nie jest odczyt wewnetrznego panelu Ovoko Sugerowane ani gwarancja kompatybilnosci. Jesli dane oferty, Pasuje do i katalog nie zawieraja dopasowania do slownika Ovoko, pozycja pozostaje z konkretnym bledem zamiast przypadkowego modelu. Model pomocniczy pozostaje opcjonalna sciezka zaawansowana, nie wymogiem automatycznego dopasowania. Blokady zapisu, zdjecia, ceny, konta i ochrona duplikatow pozostaja takie same. Zrodlo kontraktu: https://developer.allegro.pl/tutorials/jak-zarzadzac-sekcja-pasuje-do-E7Zj6gAEGil
- Pozycje sa przetwarzane po kolei w osobnym otwartym oknie, z migawki zaznaczenia i korekty. Nalezy zostawic okno przenoszenia otwarte; lista nie musi pozostac otwarta. Uspione lub zamkniete okno nie jest trwala kolejka serwerowa. Odswiezenie nie wznawia jej automatycznie. Zostaja trwale rejestry utworzonych aut i publikacji, blokujace duplikaty. Po zakonczeniu lista jest odswiezana, jezeli nadal otwarta; podsumowanie pokazuje liczbe przeniesionych, pominietych, bledow i niewyslanych.
- Cena z aktualnej oferty jest ponownie sprawdzana i wyliczana na serwerze. Porownujemy grosze, nie zapis tekstowy: `25`, `25.0` i `25.00` oznaczaja te sama cene. Rzeczywista zmiana ceny nadal blokuje dana wysylke; komunikat przy porownaniu listy pokazuje obie kwoty. Zmiana oferty, cen, zdjec, kont lub uprawnien zatrzymuje wysylke. Cala galeria, opis i pelne numery sa przekazywane zwyklym, chronionym mechanizmem pojedynczej publikacji. Nie przenosimy cennika wysylki Allegro; obowiazuja ustawienia Ovoko.
- Rejestr utworzonej publikacji powoduje pominiecie, nie kolejna publikacje ani aktualizacje. Niepewny wynik, blad infrastruktury, limit lub brak uprawnien zatrzymuja pozostale pozycje bez automatycznego ponawiania. Blad brakujacych danych (400) jest pokazany przy pozycji i pozwala przejsc do kolejnej. Przycisk Zatrzymaj po biezacej nie anuluje trwajacego zapisu; moze pozostawic przygotowane auto bez wyslanej czesci.
- Ograniczenia dotychczasowej publikacji pozostaja: aktywna oferta, jedna sztuka, bez zestawu, opony/felgi nieobslugiwane. Brak automatycznej synchronizacji sprzedazy lub wycofywania. Wymaga istniejacych migracji 011-013; bez nowego SQL.

Testy bez kont produkcyjnych:

```text
node scripts/test-inventory.mjs
node scripts/test-inventory-browser.mjs
node scripts/test-ovoko-transfer-inventory.mjs
node scripts/test-ovoko-bulk-price.mjs
node scripts/test-ovoko-fitment.mjs
node scripts/test-ovoko-publish.mjs
node scripts/test-allegro-connection-browser.mjs
node node_modules/typescript/bin/tsc --noEmit
```

Test przegladarki korzysta z lokalnego pakietu esbuild, Chrome i Playwright (PLAYWRIGHT_MODULE moze wskazac dolaczony runtime). Wszystkie API sa atrapami. Nie pobiera rzeczywistych ofert.
