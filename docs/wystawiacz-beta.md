# Wystawiacz Beta - przygotowanie aukcji ze zdjec i komentarzy

## Granice wersji

- Wejscie: przycisk Wystawiacz Beta w panelu (tylko administrator); strona `/panel/beta`.
- Zamrozona kopia edytora w `public/wystawiacz-beta`, na bazie stabilnego `f932c2c`. Nie laduje skryptow z `public/wystawiacz`. Stabilne pliki nie sa zmieniane.
- Beta i stabilna wersja maja osobne pliki UI i dane, ale obecnie sa budowane i wdrazane razem w tym samym Workerze Cloudflare. Nie jest to osobny serwer staging. Nowy backend obsluguje tylko `/api/beta/*`; istniejace trasy nie sa przepisywane.
- BETA_ENABLED=false wylacza dostep do strony przez panel i operacje backendu bety. Zmienne nie trzeba dodawac, aby administrator mogl przygotowywac lokalnie zdjecia i komentarze.
- Beta nie publikuje ofert. Przyciski publikacji sa zablokowane; dodatkowa oslonka fetch blokuje wszystkie mutacje `/api/allegro/*`, w tym upload i rozlaczenie konta. Do polaczenia sluzy panel Allegro.
- Osobny backend AI nie wywoluje Allegro, nie modyfikuje sesji, nie udostepnia modelowi narzedzi. Osoba z dostepem administratora nadal ma swoje zwykle uprawnienia Allegro w stabilnym programie; blokada bety nie oznacza zmiany zakresow istniejacego tokena OAuth.

## Zdjecia i aukcje

1. Nad zdjeciami jest kompaktowy wybor Standardowy / AI-separatory, zapamietywany lokalnie osobno dla wlasciciela. Domyslnie Standardowy: narzedzia AI/QR i komentarz sa ukryte. AI/separatory pokazuje je w kolorze fioletowym. Przelaczenie nie kasuje danych i jest blokowane podczas nagrywania/przetwarzania. Import Z aplikacji jest wylaczony i oznaczony jako wkrotce. Nadal jest to beta bez publikacji; do realnego wystawiania sluzy Stabilny Wystawiacz.
2. Utworz QR otwiera kartke do druku lub pobrania PNG. Ten sam kod fotografuje sie przed kazda kolejna czescia. Obecny QR jest separatorem, nie kodem konkretnego auta.
3. Wskaz folder zdjec. Nazwy plikow musza byc unikalne. Kolejnosc podzialu to naturalne sortowanie nazw plikow (1, 2, 10), a nie data skopiowania pliku ani EXIF.
4. Brak zdjecia QR: ustaw podglad na pierwszym zdjeciu kolejnej czesci i kliknij Wstaw zdjecie separatora. Powstaje lokalny obraz PNG z QR, widoczny PRZED tym zdjeciem w miniaturach i duzym podgladzie. Usun separator usuwa tylko wygenerowany obraz, nie oryginal. Bez dodatkowego komunikatu. Obraz nie trafia do galerii aukcji i nie jest zapisywany do folderu na dysku.
5. Utworz aukcje AI skanuje CALY wskazany folder lokalnie po QR i recznych separatorach. Pomimo nazwy przycisku ten etap jest deterministyczny, nie uzywa platnego AI i nie wysyla zdjec. Rozpoznaje wylacznie dokladny kod WYSTAWIACZ:BETA:SEPARATOR:1; obce QR pozostaja zdjeciami, nie sa otwierane jako linki.
6. Przed dopisaniem aukcji pokazujemy krotki modal z zakresami nazw i licznikami. Zatwierdzenie dopisuje grupy do zwyklej listy Wystawiacza. Nie ma drugiej listy przy komentarzu. Przelaczanie: Edytuj przy aukcji lub dotychczasowe przyciski poprzednia/nastepna.
7. QR rozpoczyna nastepna grupe. Zdjecia przed pierwszym QR tez tworza grupe; puste grupy, powtorzone i koncowe QR sa pomijane. Zdjecia separatorow pozostaja w oryginalnym folderze/pamieci zrodlowej, ale nie sa przypisywane do aukcji.
8. Skan jest anulowalny. Nieczytelny plik lub zmiana danych podczas skanu przerywa bez czesciowego dopisania aukcji. Maksymalnie 5000 zdjec/skan i 2000 aukcji/sesja. Niewyrazny QR moze zostac nierozpoznany: zawsze sprawdz zakresy i popraw reczny separator w razie potrzeby.
9. Ponowne przetworzenie nie dubluje zdjec juz przypisanych. Mieszanka nowych i przypisanych zdjec w jednym zakresie zatrzymuje podzial do recznej poprawy. Nie przebudowujemy ani nie kasujemy istniejacych aukcji/komentarzy.
10. Nowe grupy dostaja puste pola czesci oraz wspolne ustawienia dostawy/warunkow i wybrane auto. Nie kopiujemy ceny, numeru ani parametrow poprzedniej czesci. Oryginalne pliki sa nietkniete.

## Dane i odzyskiwanie

- Ustawienia localStorage maja prefiks `wystawiacz-beta-v1:<owner>:`. Szablony bety sa zapisywane lokalnie, nie w stabilnym `/api/workspace/preferences`.
- Osobna IndexedDB `wystawiacz-beta-v1-<owner>` zapisuje formularz, aukcje, zdjecia i nagrania. Zapis sesji i nowych plikow jest atomowy. Dotychczas zapisane pliki nie sa przepisywane przy kazdym wpisanym znaku.
- Po ponownym otwarciu najpierw wybierz Przywroc zapis bety. Pusty ekran poczatkowy nie nadpisuje poprzedniej pracy. Autozapis zaczyna sie po przywroceniu.
- Pamiec przegladarki NIE jest zewnetrzna kopia zapasowa: wyczyszczenie danych witryny, tryb prywatny, quota lub awaria komputera moga ja usunac. Zachowaj folder zdjec, eksport JSON i pobrane nagrania. Bledy zapisu sa widoczne.
- Eksport bety ma format `wystawiacz-beta-session` i rozszerzenie `.wystawiacz-beta.json`. Stabilny edytor go odrzuca, aby nie zastapic produkcyjnej pracy. JSON zawiera teksty i nazwy plikow, ale nie binarne audio/zdjecia. Nagrania mozna pobrac osobno.
- Pliki audio nie sa automatycznie usuwane po skasowaniu aukcji; pozostaja w lokalnej bazie bety. Nie ma jeszcze archiwum wielu sesji bety ani synchronizacji miedzy komputerami.
- Reczne separatory sa zapisywane w `betaSeparators` w lokalnej sesji i eksporcie JSON. Kontrolki zapisu/przywracania sa w dotychczasowej sekcji sesji.

## Komentarz i AI

- Pod zdjeciami jest male pole komentarza z jednym przyciskiem mikrofonu: kliknij, aby nagrac, kliknij ponownie, aby zatrzymac. Nagranie jest przypisane do konkretnego ID aukcji, maks. 2 minuty / 8 MB. Podczas nagrywania/przetwarzania blokujemy przelaczanie i operacje przyciskami. Odmowa mikrofonu pozostawia mozliwosc wpisania tekstu.
- Odtwarzanie, pobieranie, zgoda i przyciski AI sa schowane pod AI i nagranie. Opcja Po nagraniu przepisz komentarz i przygotuj pola AI uruchamia oba kroki po zatrzymaniu, tylko przy wlaczonym AI i zaznaczonej zgodzie. Wynik nadal wymaga przegladu/zatwierdzenia pol.
- Aby wlaczyc zdalna transkrypcje i propozycje, ustaw serwerowe BETA_AI_ENABLED=true oraz OPENAI_API_KEY. Klucz pozostaje sekretem, nigdy w publicznych assetach. Nie wlaczamy platnych wywolan automatycznie przy wdrozeniu.
- Status AI dostepne oznacza tylko obecna konfiguracje, nie sprawdza waznosci klucza ani budzetu. Bledy dostawcy pokazuja etap, HTTP, dozwolony kod bledu i bezpieczny x-request-id. Log beta_ai_provider_error zawiera tylko te metadane, bez surowej odpowiedzi, komentarza i klucza. Rozrozniamy klucz, uprawnienia, model, budzet, limit zapytan, format i timeout. Nie ponawiamy platnych wywolan automatycznie.
- Domyslne modele: gpt-4o-mini-transcribe (audio), gpt-4.1-mini (ustrukturyzowany tekst). Modele i dostepnosc trzeba okresowo weryfikowac. Wywolania API moga byc platne.
- Przed wyslaniem trzeba zaznaczyc zgode w UI. Wysylamy tylko wybrane audio lub komentarz, nigdy zdjecia, profil klienta ani cala sesje. Backend sprawdza admina, zawieszenie konta i Origin.
- Transkrypcje trzeba sprawdzic, zwlaszcza numer czesci. Propozycje AI wymagaja zaznaczenia pol i klikniecia Zastosuj. Pola juz wypelnione nie sa domyslnie zaznaczone; ich zastapienie wymaga potwierdzenia.
- AI proponuje nazwe/strone, numer, stan/uszkodzenia, podana cene PLN i notatke o polce/regale. Nie potwierdza kompatybilnosci, sprawnosci ani rynkowej ceny. Stan w domyslnym opisie bety to "do sprawdzenia", nie automatyczne "100% sprawna".
- Lokalizacja z komentarza nie zmienia adresu nadania przesylek. Propozycje nie publikuja ofert.
- Limity: 6 zadan/min na admina w danej instancji Workera, 6000 znakow komentarza, 8 MB audio, timeout 60 s. Limit pamieciowy nie jest globalnym limitem kosztowym; ustaw osobny budzet/progi alarmowe u dostawcy przed wlaczeniem AI.
- Anulowanie oczekiwania w UI nie gwarantuje przerwania naliczania kosztu juz przyjetego zadania przez dostawce. Nie ma automatycznych ponowien AI.

Dokumentacja implementacji OpenAI:
- https://developers.openai.com/api/docs/guides/speech-to-text
- https://developers.openai.com/api/docs/guides/structured-outputs

## Weryfikacja

`scripts/test-beta-api.mjs`: uprawnienia, kill switch, CSRF, limity, schema i brak operacji na Allegro. Wywolania dostawcy sa atrapami.

`scripts/test-beta-browser.mjs`: pelny edytor, podzial zdjec, komentarze/nagrania na ID, blokady, propozycje AI, odzyskanie IndexedDB i izolacja stabilnego zapisu. Mikrofon i AI sa atrapami; fizyczny mikrofon wymaga proby u uzytkownika.

`scripts/test-beta-qr.mjs`: prawdziwy generator/dekoder QR, obrocone zdjecia JPEG, obce QR, kolejnosc nazw, reczne separatory, powtarzanie bez duplikatow, blad obrazu i anulowanie. Biblioteki sa przypiete i serwowane z vendor; bez CDN i zmian zaleznosci projektu.

Przed szerszym udostepnieniem: reczny test mikrofonu, test rzeczywistego OpenAI na koncie z budzetem, zgody/informacje o przetwarzaniu danych, niezalezny przeglad i osobne srodowisko staging. Nie wlaczac publikacji w tej becie.
