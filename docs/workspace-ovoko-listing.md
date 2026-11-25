# Ovoko w formularzu wystawiania

## Wdrozenie

1. Uruchom caly plik `supabase/027_workspace_vehicles.sql` w Supabase SQL Editor.
   Migracja dodaje dwie nowe tabele i funkcje rezerwacji, nie usuwa ofert ani sesji.
2. Wyslij commit przez GitHub Desktop: Push origin. Poczekaj na build Cloudflare.
3. Odswiez formularz. Konto musi miec polaczone Allegro i Ovoko oraz dostep do publikacji.

## Korzystanie

- Domyslnie formularz wystawia tylko Allegro, jak dotychczas.
- W oknie aut podaj skrot/opis. Dodane lub edytowane auto trafia do trwalej listy
  Moje samochody i do biezacej sesji. Usuniecie z sesji nie usuwa go z biblioteki.
- W opcjonalnych danych Ovoko wybierz marke, model i rok. VIN, silnik,
  pojemnosc, moc w kW, przebieg, kolor i miejsce sa opcjonalne.
- Zaznaczenie zapisu do Ovoko i Dodaj/Zapisz tworzy konkretnego dawce w Ovoko.
- W kolejnej sesji dodaj zapisane auto z biblioteki, potem wybierz jego przycisk
  przy czesci. Starsze auta sprzed tej funkcji mozna otworzyc do edycji i zapisac.
- Zaznacz Wystaw takze w Ovoko. Podaj osobna cene za sztuke, w walucie oferty
  Allegro, bez przeliczania walut. Wybierz wspolny lub osobny rekord dla sztuk.
- Kategoria/jakosc/status/numer czesci sa mapowane obecnym mechanizmem.
  Kategorie mozna wybrac recznie; zdjecia i rozwiniety opis pochodza z Allegro.
- Publikacja jest sekwencyjna: Allegro, potem Ovoko. Po bledzie drugiego kanalu
  uzyj Popraw Ovoko / Ponow tylko Ovoko. Nie powstaje druga oferta Allegro.
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

Biblioteka pobiera po 100 aut, przycisk Wczytaj starsze auta rozszerza liste.
Wyszukiwarka filtruje juz pobrana czesc biblioteki.

## Weryfikacja

- `scripts/test-workspace-vehicles.mjs`: walidacja, CAS, zakres konta, tozsamosc dawcy.
- `scripts/test-workspace-vehicles-sql.mjs`: prawdziwy PostgreSQL/PGlite, RLS i rezerwacje.
- `scripts/test-listing-ovoko-browser.mjs`: rzeczywisty formularz, biblioteka i ponowienie kanalu.
- `scripts/test-ovoko-publish.mjs`: istniejacy przeplyw i nowy kanal z konkretnym dawca.
- `scripts/test-workspace-layout.mjs`, `test-approved-workspace.mjs`, `test-workspace-server.mjs`.

Testy nie publikuja prawdziwych ofert; API portali jest zastepowane kontrolowanymi odpowiedziami.
