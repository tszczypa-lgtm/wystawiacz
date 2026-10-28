# Potwierdzenia zamowien

## Co jest gotowe w kodzie

- Historia ostatnich 10 wlasnych zamowien, niezalezna od uprawnien testera.
- Wynik po powrocie z Tpay, automatyczne sprawdzanie przez minute i reczne odswiezanie.
- Pobieranie TXT z danymi zamowienia, oswiadczeniami oraz dokumentami z chwili zakupu.
- Wylacznie odczyt wlasnych zamowien; brak dostepu do cudzych nawet dla testera.
- Kolejka maili zapisywana w tej samej transakcji co potwierdzenie platnosci.
- Wysylka opcjonalna przez API Resend. Nie korzysta z hasla SMTP Supabase.
- Bledy poczty nie cofaja zaplaty ani nie wywoluja ponownego obciazenia klienta.

## Wdrozenie

1. W Supabase SQL Editor uruchom **zawartosc** pliku
   `supabase/008_order_confirmation_mail.sql`, po migracji 007. Nie wpisuj samej nazwy.
   Migracja nie zmienia dostepu i nie wysyla starych zamowien.
2. Wypchnij kod i poczekaj na Ready w Cloudflare. Historia i pobieranie potwierdzen
   dzialaja bez zalozenia konta pocztowego u nowego dostawcy.
3. Automatyczne maile pozostaja wylaczone, dopoki nie wybierzesz i nie skonfigurujesz
   dostawcy. Dla przygotowanego adaptera Resend potrzebne sa konto, weryfikacja domeny
   nadawczej oraz klucz o uprawnieniu wysylki. Nie kupiono uslugi ani nie utworzono konta.
   Przed wlaczeniem sprawdz umowe powierzenia, transfery, limity/cennik i zaktualizuj
   informacje o odbiorcach danych w polityce prywatnosci. Nie dodawaj drugiego SPF:
   uzyj rekordow wskazanych przez dostawce dla wybranej subdomeny nadawczej.
4. W Cloudflare dodaj sekret `RESEND_API_KEY`, zmienne
   `ORDER_MAIL_FROM=Wystawiacz by Tymo <potwierdzenia@TWOJA_ZWERYFIKOWANA_DOMENA>`
   oraz `ORDER_MAIL_ENABLED=true`. Klucza ani hasel nie przesylaj na czacie.
5. W Workerze dodaj Cron Trigger `*/5 * * * *` (co 5 minut). Obsluga `scheduled`
   jest w kodzie; bez tego ponowienia po bledzie czekaja na kolejny webhook.
6. Zrob nowa platnosc sandbox, sprawdz TXT, mail i zalacznik. Poprzednia platnosc
   testowa moze miec dokumenty do pobrania, ale nie jest automatycznie wysylana.
7. Sprawdz zapisy w tabeli `order_confirmation_mail`. `accepted` oznacza przyjecie
   przez API dostawcy, NIE potwierdzone doreczenie do skrzynki. Doreczenie/odbicia
   sprawdz w panelu dostawcy. `review` wymaga recznego porownania z jego logami;
   nie zeruj go bez sprawdzenia, aby nie zdublowac maila po wygasnieciu klucza.

Historia nie zmienia historycznych zgod. Stare zamowienia bez utrwalonych dokumentow
nie sa uzupelniane dzisiejsza wersja. Dane nabywcy sa utrwalane dla nowych zamowien.
Otwarte zamowienie utworzone bez nowego snapshotu moze wymagac osobnego wyjasnienia;
nie oznaczaj zbiorczo zamowien jako nieoplacone.

Nie zmieniaj `TPAY_ENVIRONMENT=sandbox`, `TPAY_LIVE_APPROVED` ani
`salesPolicy.approved` podczas tych testow. Regulamin i prywatnosc nadal wymagaja
zamkniecia ustalen o retencji i dostawcach oraz zatwierdzenia przed sprzedaza.
Sam plik do pobrania nie jest deklaracja spelnienia wszystkich wymogow potwierdzenia
umowy na trwalym nosniku; trzeba sprawdzic komplet informacji i faktyczna wysylke.

Dokumentacja dostawcy:
https://resend.com/docs/api-reference/emails/send-email
https://resend.com/docs/dashboard/emails/idempotency-keys
