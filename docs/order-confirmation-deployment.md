# Potwierdzenia zamowien

## Co jest gotowe w kodzie

- Historia ostatnich 10 wlasnych zamowien, niezalezna od uprawnien testera.
- Wynik po powrocie z Tpay, automatyczne sprawdzanie przez minute i reczne odswiezanie.
- Pobieranie TXT z danymi zamowienia, oswiadczeniami oraz dokumentami z chwili zakupu.
- Wylacznie odczyt wlasnych zamowien; brak dostepu do cudzych nawet dla testera.
- Kolejka maili zapisywana w tej samej transakcji co potwierdzenie platnosci.
- Wysylka przez istniejaca skrzynke home.pl, SMTP 465 z TLS i weryfikacja certyfikatu.
- Bez Resend, nowego konta u dostawcy ani zmian w mailach rejestracyjnych Supabase.
- Bledy poczty nie cofaja zaplaty ani nie wywoluja ponownego obciazenia klienta.

## Wdrozenie

1. W Supabase SQL Editor uruchom **zawartosc** pliku
   `supabase/008_order_confirmation_mail.sql`, po migracji 007. Nie wpisuj samej nazwy.
   Migracja nie zmienia dostepu i nie wysyla starych zamowien.
2. Uruchom po niej `supabase/009_order_mail_smtp.sql`. Zachowuje kolejke i dokumenty.
   Wylacza poprzednia funkcje ponowien API, ktorej nie wolno uzywac do SMTP.
   Bez 009 kod nie wysyla maili: nie przechodzi na stary mechanizm w razie bledu.
3. Wypchnij kod i poczekaj na Ready w Cloudflare. Historia i pobieranie potwierdzen
   dzialaja niezaleznie od konfiguracji SMTP.
4. W Cloudflare dodaj **sekret** `ORDER_SMTP_PASSWORD` z haslem skrzynki
   `biuro@tymogarage.pl` oraz zmienna tekstowa `ORDER_MAIL_ENABLED=true`.
   Hasla nie wysylaj na czacie, nie wpisuj do SQL ani pliku w repozytorium.
   Domyslnie kod uzywa hosta `serwer2684289.hosting-home.pl`, portu 465 i loginu
   `biuro@tymogarage.pl` (zgodnie z dotychczasowa konfiguracja uzytkownika).
   Opcjonalne `ORDER_SMTP_HOST` i `ORDER_SMTP_USER` sluza do zmiany tych danych;
   nazwe hosta zweryfikuj w home.pl, gdyby zmienil sie serwer skrzynki.
   Nadawca i adres kopertowy sa zawsze zgodne z loginem SMTP. Certyfikat musi byc poprawny.
   Nie ma potrzeby dodawania domeny, zmieniania DNS ani ustawien Supabase.
5. W Workerze dodaj Cron Trigger `*/5 * * * *` (co 5 minut). Obsluga `scheduled`
   jest w kodzie; bez tego ponowienia po bledzie czekaja na kolejny webhook.
6. Zrob nowa platnosc sandbox, sprawdz TXT, mail i zalacznik. Poprzednia platnosc
   testowa moze miec dokumenty do pobrania, ale nie jest automatycznie wysylana.
7. Sprawdz zapisy w tabeli `order_confirmation_mail`. `accepted` oznacza przyjecie
   przez SMTP home.pl, NIE potwierdzone doreczenie do skrzynki. Sprawdz skrzynke
   odbiorcy oraz ewentualne zwrotki na adresie nadawcy. SMTP nie zapewnia deduplikacji
   po Message-ID: po zerwaniu polaczenia w niepewnym momencie lub utracie zapisu
   wyniku w bazie zadanie przechodzi do `review`, bez automatycznego ponowienia.
   Ponawiamy tylko pewne odrzucenia/bledy przed wyslaniem tresci, najwyzej 5 razy.
   `review` wymaga sprawdzenia przed recznym ponowieniem; nie zeruj zbiorczo stanow.
   Scheduler pobiera jedno zadanie na uruchomienie, aby zmiescic SMTP w czasie Workera.

Historia nie zmienia historycznych zgod. Stare zamowienia bez utrwalonych dokumentow
nie sa uzupelniane dzisiejsza wersja. Dane nabywcy sa utrwalane dla nowych zamowien.
Otwarte zamowienie utworzone bez nowego snapshotu moze wymagac osobnego wyjasnienia;
nie oznaczaj zbiorczo zamowien jako nieoplacone.

## Diagnostyka bez logow Cloudflare

Na koncie administratora w Abonamencie jest przycisk **Sprawdz poczte (bez wysylania)**.
Test wykonuje tylko TLS i logowanie do SMTP. Nie wysyla maila, nie zmienia kolejki,
nie sprawdza doreczenia i nie wymaga nowej platnosci ani migracji 010.
Wynik pokazuje kod, status SMTP oraz etap; nie zwraca hasla ani surowej odpowiedzi serwera.
Konto testowe bez praw administratora nie moze uruchomic tego sprawdzenia.

Opcjonalna migracja `supabase/010_order_mail_diagnostics.sql` dodaje bezpieczne pola
ostatniego bledu do kolejki. Dla przyszlych prob mozna odczytac `last_error_code`,
`last_smtp_status`, `last_error_stage`, `last_error_at` w Supabase. Stare bledy nie sa
odtwarzane. Bez tej migracji wysylka zachowuje poprzednie bezpieczne obslugiwanie bledow.
Migracja nie zeruje licznikow i nie ponawia zadan w stanie `review`.

Nie zmieniaj `TPAY_ENVIRONMENT=sandbox`, `TPAY_LIVE_APPROVED` ani
`salesPolicy.approved` podczas tych testow. Regulamin i prywatnosc nadal wymagaja
zamkniecia ustalen o retencji i dostawcach oraz zatwierdzenia przed sprzedaza.
Sam plik do pobrania nie jest deklaracja spelnienia wszystkich wymogow potwierdzenia
umowy na trwalym nosniku; trzeba sprawdzic komplet informacji i faktyczna wysylke.

Dokumentacja:
https://pomoc.home.pl/baza-wiedzy/jak-skonfigurowac-program-do-obslugi-poczty-e-mail
https://nodemailer.com/smtp
https://developers.cloudflare.com/workers/runtime-apis/nodejs/tls/
