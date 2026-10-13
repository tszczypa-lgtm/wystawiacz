# Tpay: przygotowanie i uruchomienie

Kod jest domyslnie wylaczony. Rejestracja Tpay nie wlacza zadnej platnosci.
Nie wlaczaj starych platnosci Stripe (`BILLING_ENABLED`).

## Przed testami

1. Kopia bazy, nastepnie jednorazowa migracja `supabase/005_tpay_payments.sql` po 004.
2. Wdrozenie nowego kodu dotychczasowym procesem GitHub/Cloudflare.
3. Osobne konto sandbox; klucze produkcyjne nie dzialaja w sandbox.
4. Zmienne Text: `TPAY_ENVIRONMENT=sandbox`, `APP_ORIGIN=https://wystawiacz.tszczypa.workers.dev`.
5. Sekrety: `TPAY_CLIENT_ID`, `TPAY_CLIENT_SECRET`, `TPAY_SECURITY_CODE`.
6. Zmienna Text `TPAY_MERCHANT_ID`: numer akceptanta konta sandbox.
7. W panelu testowym Tpay ustaw powiadomienia na
   `https://wystawiacz.tszczypa.workers.dev/api/account/tpay/webhook`,
   pozwol na nadpisanie URL powiadomien w transakcji. Kod bezpieczenstwa musi
   zgadzac sie z `TPAY_SECURITY_CODE` (Ustawienia -> Powiadomienia -> Bezpieczenstwo).
8. Dopiero wtedy `TPAY_ENABLED=true`. `TPAY_LIVE_APPROVED` pozostaje nieustawione.

## Wlasciwosci

- Kwota serwerowa zawsze 500 PLN. Klient wybiera BLIK lub inna udostepniona metode na stronie Tpay.
- Bez zapisywania kart, zgody na odnawianie ani automatycznego pobierania.
- Miesiac kalendarzowy od pozniejszej daty: teraz, koniec oplaconego dostepu, koniec triala.
- Powrot z bramki ani przycisk Sprawdz status nie przyznaja dostepu.
- Dostep tylko po poprawnym JWS, certyfikacie, sumie kontrolnej, numerze akceptanta,
  kwocie docelowej/zaplaconej, walucie, srodowisku oraz powiazaniu zamowienia.
- Brak waluty w powiadomieniu jest dozwolony przez API Tpay; samo zamowienie jest PLN.
- Sandbox zapisuje platnosc jako testowa, ale nie zmienia dostepu. Checkout sandbox tylko dla administratora.
- Jedna nierozstrzygnieta platnosc na klienta/srodowisko; ponowne klikniecie wznawia ten sam link.
- Przerwane tworzenie bez odpowiedzi blokuje ponowny POST. Administrator sprawdza
  transakcje w Tpay po hiddenDescription (UUID zamowienia) i nie usuwa rekordu w ciemno.
- Powtorki i rownolegle powiadomienia sa rozliczane atomowo w PostgreSQL.
- Pelny zwrot zapisuje status refunded; administrator recznie rozstrzyga dostep,
  zeby nie odebrac innych zakupow lub darmowego dostepu. Nie wykonujemy zwrotow przez API.
- Nie ma automatycznego wystawiania faktur. Przed startem ustal obsluge ksiegowa,
  regulamin, prywatnosc, reklamacje oraz wymagane zgody z odpowiednim specjalista.

## Testy przed produkcja

Przeprowadz sandbox end-to-end: BLIK udany/anulowany, dwie karty (ten sam link),
powtorzony webhook (bez drugiego miesiaca), zla kwota/waluta/srodowisko/podpis,
powrot bez zaplaty, opoznione potwierdzenie, zawieszone konto, przedluzenie i zwrot.
Uruchomienie SQL i testy prawdziwego Tpay wymagaja osobnej weryfikacji;
testy lokalne z atrapami nie sa dowodem produkcyjnego dzialania.

## Produkcja dopiero po akceptacji testow

Weryfikacja firmy i strony przez Tpay musi byc zakonczona. Wylacz checkout
`TPAY_ENABLED=false` na czas zmiany wszystkich danych srodowiska. Wstaw klucze,
numer i security code produkcji; ustaw `TPAY_ENVIRONMENT=production`.
Po sprawdzeniu powiadomien, dokumentow i testow: `TPAY_LIVE_APPROVED=true`,
potem `TPAY_ENABLED=true`. Nie wlaczaj `BILLING_ENFORCED` przed potwierdzonym
zakupem/odnowieniem; istniejace darmowe dostepy pozostaja bez zmian.

Dokumentacja: https://docs-api.tpay.com/en/first-steps/first-transaction/
oraz https://docs-api.tpay.com/en/webhooks/ .
