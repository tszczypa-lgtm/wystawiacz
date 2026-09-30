# Wystawiacz Allegro SaaS - fundament produktu

## Cel

Nowa wersja ma byc sprzedawana jako strona z dostepem abonamentowym. Stary program lokalny zostaje prototypem funkcji, ale nowa aplikacja nie powinna dziedziczyc lokalnego przechowywania tokenow, plikow i sesji.

## Role

- `owner` - wlasciciel konta firmy, zarzadza abonamentem i integracja Allegro.
- `manager` - przygotowuje aukcje, zdjecia, tytuly, parametry i opisy.
- `pricing` - uzupelnia ceny i zatwierdza liste do wystawienia.

## Moduly

1. Konto firmy i uzytkownicy
   - rejestracja firmy,
   - zaproszenia pracownikow,
   - role i uprawnienia.

2. Subskrypcja
   - status planu blokuje lub odblokowuje publikowanie ofert,
   - provider platnosci: Stripe jako domyslny start,
   - Przelewy24 mozna dodac pozniej dla rynku PL.

3. Allegro
   - OAuth po stronie serwera,
   - Client Secret nigdy nie trafia do przegladarki,
   - tokeny zapisywane szyfrowane,
   - pobieranie kategorii, parametrow, cennikow, zwrotow, reklamacji i producentow odpowiedzialnych.

4. Sesje ofert
   - sesja robocza np. "Pazdziernik 2026",
   - lista aut/modeli dla sesji,
   - produkty z opisem, parametrami, zdjeciami i statusem.

5. Zdjecia
   - pliki trafiaja do magazynu obiektowego,
   - baza przechowuje metadane i kolejnosc,
   - glowne zdjecie jest oznaczone w rekordzie.

6. Publikowanie
   - cena jest wymagana dopiero przy publikacji,
   - faktura ustawiana automatycznie jako `VAT`,
   - numer katalogowy czesci moze byc calym tytulem,
   - numer katalogowy oryginalu ma zostac samym numerem czesci.

## Minimalny etap 1

- Publiczna strona produktu.
- Zamkniety panel jako widok docelowy.
- Schema bazy pod konta, subskrypcje, integracje Allegro, sesje, aukcje i zdjecia.
- Deklaracja bazy `DB` i magazynu plikow `FILES`.
- Podstrony startowe:
  - `/login` - logowanie/rejestracja jako przyszly przeplyw auth,
  - `/panel` - roboczy panel aukcji,
  - `/panel/billing` - plany i zasady blokady abonamentu,
  - `/panel/allegro` - bezpieczne polaczenie Allegro OAuth,
  - `/panel/settings` - ustawienia firmy i pracownikow.

## Etap 2

- Rejestracja/logowanie uzytkownikow.
- Panel organizacji.
- Ekran subskrypcji.
- Zaproszenia pracownikow.
- Middleware/guard: bez aktywnej sesji uzytkownik nie widzi `/panel`.
- Guard abonamentu: bez aktywnej subskrypcji serwer blokuje publikowanie ofert.

## Etap 3

- Integracja Allegro OAuth.
- Pobieranie kategorii i szablonow konta.
- Import funkcji ze starego programu: tytuly, parametry, opis, zdjecia, wystawianie.

## Etap 4

- Platnosci abonamentowe.
- Limity planow.
- Panel administracyjny dla wlasciciela SaaS.
