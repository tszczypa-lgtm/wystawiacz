# Weryfikacja Tpay

Stan audytu: 2026-10-28. To instrukcja wdrozenia, nie potwierdzenie zatwierdzenia
dokumentow ani uruchomienia platnosci produkcyjnych.

## Oddzielne konto do testu

1. Zarejestruj osobne konto Wystawiacza na kontrolowanym adresie e-mail
   i potwierdz adres. Nie uzywaj konta wlasciciela lub pracownika.
2. Nie dodawaj wpisu do `account_admins`. Nie lacz konta z Allegro.
   Nie umieszczaj na nim sesji ani danych klientow.
3. Odczytaj UUID tego uzytkownika w Supabase Authentication / Users lub wykonaj
   tylko odczyt z `scripts/find-tpay-reviewer.sql` dla tpaytest@tymogarage.pl.
4. Po wdrozeniu kodu ustaw po stronie Cloudflare:
   - `TPAY_SANDBOX_REVIEWER_IDS`: dokladny UUID konta. Kilka UUID rozdziela przecinek.
   - `TPAY_SANDBOX_REVIEWER_UNTIL`: uzgodniona data konca dostepu w ISO 8601 z `Z`.
   - `TPAY_ENVIRONMENT=sandbox`; nie zmieniaj na production na potrzeby weryfikacji.
5. Na koncie wypelnij poprawne dane rozliczeniowe do testu. Nie wpisuj
   danych innego klienta. Test nie wymaga polaczenia z Allegro.
6. Sprawdz logowanie oraz formularz `/panel/billing` w osobnej sesji.
   Powinien byc widoczny test Tpay, ale nie panel administratora.
7. Przekaz dane tylko przez sprawdzony kanal kontaktu z Tpay. Oznacz,
   ze bramka jest testowa, a platnosc nie pobiera pieniedzy.
8. Po weryfikacji usun UUID i termin z konfiguracji, uniewaznij sesje konta
   i zmien jego haslo albo usun konto po sprawdzeniu wymogow retencji.

Upowaznienie wygasa po wskazanej dacie i dziala tylko w sandbox.
Nie nadaje praw administratora, dostepu do cudzych kont, Allegro ani sekretow.
Pusta lista, brak daty i niepoprawna lub przeszla data nie przyznaja dostepu.
Testowe rozliczenie nadal nie przedluza dostepu produkcyjnego.

## Dokumenty: co trzeba zamknac przed odpowiedzia "gotowe"

- `/regulamin` i `/prywatnosc` sa nadal projektami; `salesPolicy.approved=false`.
- Wersja dokumentow `2026-10-28-review-2` opisuje 30 dni proby, 500 zl za miesiac,
  brak automatycznego odnawiania i brak dobrowolnej gwarancji zwrotu. Zachowuje
  prawa ustawowe i warunkowe rozliczenie spelnionego swiadczenia.
- Akceptacja wersji regulaminu, oswiadczen i pelnych tresci obu dokumentow jest
  zapisywana przy nowym zamowieniu przez istniejaca migracje 007.
  Dziala pobieranie TXT; zrodlem strony, pliku i snapshotu jest ten sam modul.
  Nie uzupelniamy ani nie zmieniamy historycznych oswiadczen.
- Zmiana wersji blokuje ponowne wykorzystanie otwartego zamowienia ze starszymi
  oswiadczeniami (409). Nie oznaczac takich zamowien zbiorczo jako failed;
  kazdy przypadek trzeba sprawdzic z operatorem. Nie naruszac zaplaconych zamowien.
- Brakuje potwierdzenia umowy z kompletem informacji i dokumentami na trwalym
  nosniku. Sam link do zmiennej strony i wewnetrzny zapis w bazie nie wystarcza.
- Nalezy ustalic retencje/usuwanie kont, sesji, tokenow, logow, platnosci,
  korespondencji i kopii oraz zrealizowac przyjeta procedure.
- Trzeba zweryfikowac umowy z dostawcami, region bazy, transfery danych,
  zabezpieczenia i informacje dla uzytkownikow.
- Nalezy uzgodnic zakres danych powierzanych przez klientow biznesowych.
- Finalne dokumenty wymagaja akceptacji uslugodawcy i sprawdzenia prawnego.
  Nie usuwac slowa "projekt" tylko po to, aby zakonczyc weryfikacje.
- Zgoda Tpay i publikacja dokumentow nie sa zgoda na zmiane
  `TPAY_LIVE_APPROVED` lub `salesPolicy.approved` bez osobnej decyzji o starcie.

## Odpowiedz do Tpay po wykonaniu powyzszych czynnosci

Nie wysylac ponizszego tekstu, dopoki dokumenty nie zostana rzeczywiscie
zatwierdzone i wdrozone, a konto nie zostanie sprawdzone.

> Dzien dobry,
>
> regulamin i polityka prywatnosci zostaly uzupelnione i zatwierdzone jako
> dokumenty docelowe dla uslugi Wystawiacz by Tymo:
> https://wystawiacz.tszczypa.workers.dev/regulamin
> https://wystawiacz.tszczypa.workers.dev/prywatnosc
>
> Oddzielne konto weryfikacyjne umozliwia przejscie formularza zamowienia
> pod adresem https://wystawiacz.tszczypa.workers.dev/panel/billing.
> Dane dostepowe przekazujemy uzgodnionym bezpiecznym kanalem.
> Konto nie wymaga polaczenia z Allegro i nie posiada uprawnien administratora.
>
> Platnosci sa obecnie w srodowisku testowym Tpay: nie pobieraja prawdziwych
> pieniedzy i nie aktywuja platnego dostepu produkcyjnego. Prosze o informacje,
> jezeli weryfikacja wymaga innego przebiegu testu.
>
> Tymo Garage Tymoteusz Szczypka
> biuro@tymogarage.pl

## Materialy do sprawdzenia dokumentow

- https://prawakonsumenta.uokik.gov.pl/prawo-odstapienia-od-umowy/
- https://prawakonsumenta.uokik.gov.pl/pytania-i-odpowiedzi/prawo-do-informacji/
- https://eli.gov.pl/api/acts/DU/2024/1796/text.html
- https://uodo.gov.pl/pl/676/4260
- https://zpe.gov.pl/a/przechowywanie-dokumentacji-ksiegowej/DYeS0IGPf
- Projekt UC169 (funkcja odstapienia w interfejsie): sprawdzic stan wdrozenia
  przed startem, nie deklarowac istnienia niewdrozonego przycisku lub wysylki.

Sprawdz aktualny stan prawny przy zatwierdzaniu; niniejsza lista nie zastepuje
indywidualnej weryfikacji dokumentow i konfiguracji uslugi.
