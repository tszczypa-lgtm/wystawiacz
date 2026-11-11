# Wystawiacz Beta - przygotowanie aukcji ze zdjec i komentarzy

## Granice wersji

- Wejscie: przycisk Wystawiacz Beta w panelu (tylko administrator); strona `/panel/beta`.
- Zamrozona kopia edytora w `public/wystawiacz-beta`, na bazie stabilnego `f932c2c`. Nie laduje skryptow z `public/wystawiacz`. Stabilne pliki nie sa zmieniane.
- Beta i stabilna wersja maja osobne pliki UI i dane, ale obecnie sa budowane i wdrazane razem w tym samym Workerze Cloudflare. Nie jest to osobny serwer staging. Nowy backend obsluguje tylko `/api/beta/*`; istniejace trasy nie sa przepisywane.
- BETA_ENABLED=false wylacza dostep do strony przez panel i operacje backendu bety. Zmienne nie trzeba dodawac, aby administrator mogl przygotowywac lokalnie zdjecia i komentarze.
- Beta nie publikuje ofert. Przyciski publikacji sa zablokowane; dodatkowa oslonka fetch blokuje wszystkie mutacje `/api/allegro/*`, w tym upload i rozlaczenie konta. Do polaczenia sluzy panel Allegro.
- Osobny backend AI nie wywoluje Allegro, nie modyfikuje sesji, nie udostepnia modelowi narzedzi. Osoba z dostepem administratora nadal ma swoje zwykle uprawnienia Allegro w stabilnym programie; blokada bety nie oznacza zmiany zakresow istniejacego tokena OAuth.

## Zdjecia i aukcje

1. Wskaz folder zdjec. Nazwy plikow musza byc unikalne. Plik o innej zawartosci/metadanych nie moze po cichu zastapic zdjecia tej samej nazwy.
2. Nowy zestaw -> zaznacz zdjecia jednej czesci -> Utworz aukcje z zaznaczonych zdjec.
3. Przelaczaj zestawy przyciskami z numerem, nazwa i licznikiem zdjec. Formularz i komentarz sa zapisywane przy zmianie aukcji.
4. Poprawiaj zdjecia w wybranym zestawie jak w obecnym edytorze. Aby przeniesc zdjecie, odznacz je w starej aukcji i zapisz zmiane przed wybraniem w nowej. Oryginaly pozostaja w folderze.
5. QR nie jest jeszcze obslugiwany. To kolejny etap po sprawdzeniu recznego podzialu.

## Dane i odzyskiwanie

- Ustawienia localStorage maja prefiks `wystawiacz-beta-v1:<owner>:`. Szablony bety sa zapisywane lokalnie, nie w stabilnym `/api/workspace/preferences`.
- Osobna IndexedDB `wystawiacz-beta-v1-<owner>` zapisuje formularz, aukcje, zdjecia i nagrania. Zapis sesji i nowych plikow jest atomowy. Dotychczas zapisane pliki nie sa przepisywane przy kazdym wpisanym znaku.
- Po ponownym otwarciu najpierw wybierz Przywroc zapis bety. Pusty ekran poczatkowy nie nadpisuje poprzedniej pracy. Autozapis zaczyna sie po przywroceniu.
- Pamiec przegladarki NIE jest zewnetrzna kopia zapasowa: wyczyszczenie danych witryny, tryb prywatny, quota lub awaria komputera moga ja usunac. Zachowaj folder zdjec, eksport JSON i pobrane nagrania. Bledy zapisu sa widoczne.
- Eksport bety ma format `wystawiacz-beta-session` i rozszerzenie `.wystawiacz-beta.json`. Stabilny edytor go odrzuca, aby nie zastapic produkcyjnej pracy. JSON zawiera teksty i nazwy plikow, ale nie binarne audio/zdjecia. Nagrania mozna pobrac osobno.
- Pliki audio nie sa automatycznie usuwane po skasowaniu aukcji; pozostaja w lokalnej bazie bety. Nie ma jeszcze archiwum wielu sesji bety ani synchronizacji miedzy komputerami.

## Komentarz i AI

- Nagranie jest przypisane do konkretnego ID aukcji, maks. 2 minuty / 8 MB. Podczas nagrywania/przetwarzania blokujemy przelaczanie i operacje przyciskami. Odmowa dostepu do mikrofonu pozostawia mozliwosc wpisania tekstu.
- Aby wlaczyc zdalna transkrypcje i propozycje, ustaw serwerowe BETA_AI_ENABLED=true oraz OPENAI_API_KEY. Klucz pozostaje sekretem, nigdy w publicznych assetach. Nie wlaczamy platnych wywolan automatycznie przy wdrozeniu.
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

Przed szerszym udostepnieniem: reczny test mikrofonu, test rzeczywistego OpenAI na koncie z budzetem, zgody/informacje o przetwarzaniu danych, niezalezny przeglad i osobne srodowisko staging. Nie wlaczac publikacji w tej becie.
