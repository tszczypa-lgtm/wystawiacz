# Weryfikacja danych produkcyjnych Tpay

Stan przygotowan: 2026-11-04. Nie odczytujemy sekretow z panelu klienta.
Zgloszenie przez wlasciciela aktywnego Tpay i podmiany kluczy nie jest
jeszcze wynikiem testu polaczenia ani dowodem poprawnosci webhooka.

1. Podczas konfiguracji pozostaw TPAY_ENABLED=false i TPAY_LIVE_APPROVED=false.
2. Ustaw TPAY_ENVIRONMENT=production i dane z produkcyjnego panelu Tpay:
   TPAY_CLIENT_ID, TPAY_CLIENT_SECRET, TPAY_SECURITY_CODE (sekrety)
   oraz TPAY_MERCHANT_ID. Nie mieszaj danych sandboxa.
3. Po wdrozeniu przycisk administratora w Abonament:
   Sprawdz Tpay (bez platnosci) wywoluje wylacznie OAuth.
   Nie tworzy zamowienia w bazie ani transakcji Tpay, nie zmienia flag,
   nie wysyla maila i nie udostepnia tokenu w odpowiedzi ani logach.
4. Sprawdz tez poczte istniejacym przyciskiem SMTP. Potwierdza polaczenie
   i logowanie, nie doreczenie wiadomosci.
5. Przed uruchomieniem pozostaja zatwierdzenie gotowosci sprzedazy
   (docs/data-retention-operations.md), kod bezpieczenstwa i podpisane
   powiadomienia, rozliczenie okresu oraz dokumenty na trwalym nosniku.
   OAuth nie weryfikuje ID sprzedawcy, kodu bezpieczenstwa ani aktywacji konta.
6. salesPolicy.approved pozostaje false. Przycisk diagnostyczny nie obchodzi
   tej blokady ani flag Cloudflare.

Nie wykonuj prawdziwej platnosci automatycznie. Oplacenie zamowienia
500 PLN jest rzeczywista transakcja, nie bezplatnym testem polaczenia.
