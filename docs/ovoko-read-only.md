# Ovoko - pierwszy test odczytu

- Panel `/panel/ovoko`, link widoczny tylko administratorom. API osobno sprawdza uprawnienia i zawieszenie konta.
- `GET /api/ovoko/status` sprawdza tylko dostep lokalny, bez kontaktu z Ovoko.
- `POST /api/ovoko/test` przyjmuje login, haslo i user_token z formularza i wywoluje WYLACZNIE `POST https://api.rrr.lt/get/car_brands` jako form data. Nie przyjmuje docelowego URL ani operacji od klienta. Redirecty sa blokowane.
- Nie ma zapisu danych API w bazie, cookies, localStorage ani sessionStorage. Pola hasla i tokena sa czyszczone po probie. Nie logujemy danych, surowych odpowiedzi ani bledow dostawcy. Do stalego polaczenia bedzie potrzebny osobny etap z szyfrowaniem i rozdzieleniem kont.
- R200 oraz prawidlowa lista marek oznaczaja poprawny test odczytu. HTTP 200 samo nie wystarcza. R013 oznacza odrzucenie IP. R202 i niepelne odpowiedzi nie sa uznawane za sukces.
- Wynik NIE potwierdza wlasnosci magazynu, uprawnien do importu ani braku ograniczen konkretnego szablonu dostepu. Dopisek Partlinker nie jest automatycznie interpretowany jako blokada ani jako gwarancja pelnego dostepu.
- Brak importu, callbackow, cronow, zapisu ofert, zmiany stanow/cen i konczenia ofert. Istniejacy Wystawiacz, beta, Allegro i platnosci pozostaja bez zmian.
- Kill switch `OVOKO_TEST_ENABLED=false`. Limit 3 prob/min/admin na instancje Workera (nie jest limitem globalnym). Zadania i odpowiedzi maja limity rozmiaru, 20 s timeout, bez automatycznych ponowien. Wymagana zgodnosc Origin; sesja Supabase z potwierdzonym e-mailem.
- Dane ujawnione na zrzutach powinny zostac wymienione przed uzyciem. Nigdy nie zapisujemy ich w repo ani fixture testowych.

Zrodlo: https://api.rrr.lt/docs/integration_guide.php - sekcje 2 i 3.

Testy: `node scripts/test-ovoko.mjs` oraz `node scripts/test-ovoko-browser.mjs` (PLAYWRIGHT_MODULE wskazuje runtime). Dane i zewnetrzne zadania sa atrapami. Pierwszy test rzeczywistego konta wykonuje administrator w panelu.
