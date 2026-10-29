import { salesPolicy } from "./sales-policy";

export type SalesSection = { title: string; paragraphs: readonly string[] };

// Archive released versions before replacing these texts. Orders keep their own full snapshot.
export const salesDocuments = {
  regulamin: {
    title: "Regulamin usługi Wystawiacz by Tymo",
    sections: [
      { title: "1. Usługodawca i zakres regulaminu", paragraphs: [
        `${salesPolicy.seller}, NIP ${salesPolicy.nip}, ${salesPolicy.address}. Kontakt, reklamacje i oświadczenia: ${salesPolicy.email}.`,
        "Regulamin opisuje dostęp do Wystawiacza by Tymo dla przedsiębiorców i osób prywatnych w Polsce. Przepisy chroniące konsumentów stosuje się także do przedsiębiorców w zakresie przyznanym przez prawo. Samo podanie NIP nie wyłącza tej ochrony.",
      ] },
      { title: "2. Zakres usługi i wymagania", paragraphs: [
        "Wystawiacz by Tymo jest usługą cyfrową do przygotowywania i publikacji ofert na własnym koncie sprzedawcy Allegro: wyboru i obrotu zdjęć, edycji tytułów i opisów, listy pojazdów i szablonów, przygotowania produktów oraz zapisu sesji roboczych. Strona /oferta opisuje dostępne funkcje. Nie jest to usługa Allegro ani obietnica określonego wyniku sprzedaży, pozycji oferty lub automatycznej wyceny każdej części.",
        "Potrzebne są internet, aktualna przeglądarka, działający e-mail i urządzenie obsługujące używane funkcje. Praca na folderach zdjęć wymaga obsługi dostępu do plików w przeglądarce; zalecane są aktualny Chrome lub Edge na komputerze. W razie braku obsługi HEIC należy przygotować JPEG. Publikacja wymaga konta sprzedawcy i autoryzacji na stronie Allegro. W Wystawiaczu nie podaje się hasła Allegro.",
        "Użytkownik weryfikuje przed publikacją treść, cenę, zdjęcia, kategorię, parametry i warunki swojej oferty oraz musi mieć prawa do wykorzystywanych materiałów. Podpowiedzi nie zastępują tej weryfikacji. Nie ogranicza to ustawowej odpowiedzialności usługodawcy za zgodność własnej usługi z umową.",
      ] },
      { title: "3. Rejestracja i bezpłatny okres próbny", paragraphs: [
        "Konto powstaje po rejestracji i potwierdzeniu e-maila. Wymagane są prawidłowe dane konta i rozliczeń. Hasło należy chronić; niedozwolone są bezprawne treści, obchodzenie zabezpieczeń oraz udostępnianie konta niepowiązanym klientom w celu obchodzenia limitów. Upoważnieni pracownicy firmy mogą pracować na jej koncie.",
        "Bezpłatny okres próbny trwa 30 dni, zgodnie z terminem widocznym w panelu. Nie odnawia się i nie zmienia automatycznie w płatny dostęp. Aplikacja sprawdza wcześniejsze wykorzystanie próby przez firmę lub powiązane konto sprzedawcy. Zakładanie kolejnych kont nie daje prawa do wielokrotnej próby. Domyślnie konto klienta obejmuje jedno konkretne konto Allegro; większy limit wymaga uzgodnienia.",
        "Po próbie dalsza płatna praca wymaga osobnego zakupu. Brak zakupu nie jest zamówieniem i nie powoduje obciążenia. Wcześniej opublikowane oferty Allegro nie są z tego powodu usuwane. Oddzielny darmowy dostęp przyznany przez usługodawcę obowiązuje zgodnie z datą w panelu.",
      ] },
      { title: "4. Cena, okres i odnawianie", paragraphs: [
        "Cena wynosi 500 zł brutto za jeden miesiąc kalendarzowy dostępu. Każdy zakup jest opłacany osobno. Nie ma automatycznego odnawiania ani cyklicznego obciążania karty. Prowizje i inne opłaty Allegro nie są wliczone.",
        "Opłacony okres rozpoczyna się od późniejszej daty: potwierdzenia zapłaty, końca dotychczas opłaconego dostępu lub końca przyznanej próby. Dokupienie miesiąca nie skraca pozostałego dostępu. Miesiąc jest liczony kalendarzowo, a nie zawsze jako 30 dni; jeśli nie ma odpowiadającego dnia w kolejnym miesiącu, okres kończy się w jego ostatnim dniu. Termin sprawdza się w panelu Abonament.",
        "Cena kolejnego zakupu jest prezentowana przed jego złożeniem. Nowe ceny lub zmiany regulaminu nie zmieniają już zakupionego okresu na niekorzyść klienta; nie powstaje obowiązek kupowania kolejnych miesięcy.",
      ] },
      { title: "5. Zamówienie i płatność", paragraphs: [
        "W panelu /panel/billing klient sprawdza ofertę, cenę, dane rozliczeniowe i dokumenty. Składa osobne oświadczenie o akceptacji regulaminu oraz, jeżeli chce wcześniejszego rozpoczęcia płatnej usługi, wyraźne żądanie jej rozpoczęcia przed upływem terminu odstąpienia. Pola nie są zaznaczane z góry. Wersje i treści oświadczeń są zapisywane przy zamówieniu.",
        "Formularz z przyciskiem Zamawiam i płacę służy złożeniu zamówienia z obowiązkiem zapłaty przez Tpay. Umowa o płatny okres zostaje zawarta po przyjęciu zamówienia i potwierdzeniu płatności przez operatora. Powrót z bramki sam w sobie nie jest dowodem zapłaty. Dostęp i jego termin wynikają ze zweryfikowanego rozliczenia.",
        "Jeśli klient nie żąda wcześniejszego rozpoczęcia, nie zaznacza tego pola i kontaktuje się z usługodawcą, aby przed złożeniem płatnego zamówienia uzgodnić późniejszy start. Obecny formularz nie obsługuje samodzielnie takiego wariantu.",
        "Potwierdzenie zamówienia i płatności, warunki umowy w wersji obowiązującej przy zakupie, zapisane oświadczenia oraz informację i wzór odstąpienia przekazujemy na e-mail konta, w treści wiadomości i załączniku tekstowym, na trwałym nośniku. Dokumenty i potwierdzenie można również pobrać z panelu. W przypadku niedoręczenia wiadomości należy zgłosić problem na adres kontaktowy; nie trzeba ponawiać płatności.",
        "Aktualny sandbox służy wyłącznie próbie formularza i płatności. Nie zawiera odpłatnej umowy, nie pobiera prawdziwych pieniędzy i nie przedłuża produkcyjnego dostępu. Dostęp do próby ma administrator lub czasowo upoważnione konto weryfikacyjne. Płatności produkcyjne pozostają zablokowane do zakończenia przygotowań.",
      ] },
      { title: "6. Odstąpienie i brak dobrowolnej gwarancji zwrotu", paragraphs: [
        "Nie oferujemy dodatkowej gwarancji zwrotu pieniędzy za samą zmianę zdania ani dowolne skrócenie kupionego okresu. Nie ogranicza to praw ustawowych, w szczególności prawa odstąpienia i roszczeń z tytułu niezgodności usługi z umową. Bezpłatna próba nie znosi ochrony dotyczącej późniejszej umowy płatnej.",
        "Konsument może co do zasady odstąpić od umowy zawartej na odległość w ciągu 14 dni od jej zawarcia. Oświadczenie można złożyć e-mailem lub pisemnie na dane usługodawcy. Wystarczy jednoznaczne wskazanie decyzji i umowy, której dotyczy; poniższy wzór nie jest obowiązkowy. Dla zachowania terminu wystarczy wysłanie oświadczenia przed jego upływem.",
        "Jeżeli klient wyraźnie zażądał rozpoczęcia płatnej usługi przed upływem tego terminu i otrzymał wymagane prawem informacje, przy odstąpieniu może być należna zapłata proporcjonalna do świadczenia faktycznie spełnionego do chwili odstąpienia, obliczana na podstawie uzgodnionej ceny, zgodnie z przepisami. Nie naliczamy opłaty za bezpłatną próbę ani kary za odstąpienie. Nie potrącamy należności, których pobrania prawo zabrania, w szczególności przy braku wymaganego żądania lub informacji. Samo logowanie nie jest zrzeczeniem się prawa odstąpienia.",
        "Należny zwrot z tytułu odstąpienia następuje bez zbędnej zwłoki, najpóźniej w ustawowym terminie 14 dni od otrzymania oświadczenia, co do zasady tym samym sposobem płatności, chyba że klient wyraźnie zgodzi się na inny bez dodatkowych kosztów. Po zakończeniu umowy wygasa dostęp wynikający z tej umowy.",
        "Wzór oświadczenia: Do Tymo Garage Tymoteusz Szczypka, ul. Dębowa 40, 43-520 Mnich, biuro@tymogarage.pl. Informuję o odstąpieniu od umowy dostępu do Wystawiacza by Tymo zawartej dnia [data]. E-mail konta / numer zamówienia: [dane]. Imię i nazwisko konsumenta: [dane]. Adres konsumenta: [adres]. Data: [data]. Podpis: [tylko przy oświadczeniu papierowym].",
      ] },
      { title: "7. Reklamacje i ustawowa odpowiedzialność", paragraphs: [
        "Problemy z działaniem Wystawiacza zgłasza się usługodawcy e-mailem lub pisemnie. W zgłoszeniu warto wskazać konto, objawy, czas problemu i oczekiwane rozwiązanie. Brak proponowanego rozwiązania nie wyklucza reklamacji. Nie należy przesyłać haseł, kluczy API, tokenów, kodów BLIK ani pełnego numeru karty.",
        "Usługodawca odpowiada za zgodność usługi cyfrowej z umową na zasadach ustawowych, w tym w okresie jej dostarczania w sposób ciągły. Konsument może żądać doprowadzenia usługi do zgodności; obniżenie ceny lub odstąpienie przysługuje w przypadkach przewidzianych przepisami. Reklamacja nie oznacza automatycznie pełnego zwrotu w każdym przypadku. Nie pobiera się zapłaty za okres niezgodności, jeżeli przepisy przewidują takie rozliczenie.",
        "Na reklamację konsumenta odpowiadamy w terminie 14 dni od jej otrzymania na papierze lub innym trwałym nośniku; brak odpowiedzi wywołuje skutki ustawowe. Nie ustanawiamy dodatkowej gwarancji komercyjnej. Ograniczenia dotyczące B2B nie wyłączają ochrony osób, którym przyznają ją przepisy.",
        "Zmiany lub awarie zewnętrznych usług, w tym Allegro, mogą wpływać na integrację. Nie wyłącza to odpowiedzialności usługodawcy za własne obowiązki ani uprawnień klienta. Sprawy własnych transakcji klienta na Allegro i opłat Allegro rozlicza on z Allegro. Konsument może uzyskać pomoc rzecznika konsumentów lub Inspekcji Handlowej; informacja o udziale w postępowaniu pozasądowym zostanie przekazana zgodnie z przepisami przy rozpatrywaniu sporu.",
      ] },
      { title: "8. Sesje, dane i zakończenie korzystania", paragraphs: [
        "Plik sesji JSON i sesja serwerowa zawierają dane robocze, nie oryginalne pliki zdjęć. Zdjęcia należy zachować we własnym folderze. Autozapis serwerowy jest ustawieniem przeglądarki; po włączeniu zapamiętuje wybór, a przy konflikcie zmian może zostać wstrzymany. Użytkownik powinien zachowywać własne kopie danych i zdjęć.",
        "Klient może zaprzestać korzystania bez kupowania następnego okresu i zgłosić zamknięcie konta e-mailem. Samo zaprzestanie korzystania lub usunięcie konta nie tworzy dodatkowego prawa do zwrotu za prawidłowo świadczony okres. Nie narusza to praw ustawowych. Wniosek o udostępnienie danych lub treści klienta można skierować na adres kontaktowy także po utracie płatnego dostępu; jest realizowany w zakresie wymaganym prawem.",
        "Wygaśnięcie dostępu nie usuwa ofert już wystawionych na Allegro. Odłączenie Wystawiacza od Allegro jest możliwe przez cofnięcie autoryzacji na koncie Allegro. Dane wymagane do rozliczeń, obowiązków prawnych i ochrony roszczeń mogą pozostać po zamknięciu konta na zasadach opisanych w polityce prywatności.",
      ] },
      { title: "9. Zmiany i przepisy końcowe", paragraphs: [
        "Zmiany potrzebne do utrzymania zgodności i bezpieczeństwa usługi nie mogą odbierać ustawowych praw klienta. Pozostałe zmiany funkcjonalności w trakcie opłaconego okresu wymagają podstawy i procedury zgodnej z prawem; niniejszy regulamin nie przyznaje swobodnego prawa do usuwania opłaconych funkcji. Nowe warunki dla następnych zakupów są udostępniane przed ich złożeniem.",
        "Stosuje się prawo polskie, z zachowaniem bezwzględnie obowiązującej ochrony konsumenta. Regulamin nie narzuca konsumentowi sądu właściwego wyłącznie dla siedziby usługodawcy i nie wyłącza uprawnień, których nie można wyłączyć umową.",
      ] },
    ] satisfies SalesSection[],
  },
  prywatnosc: {
    title: "Polityka prywatności Wystawiacz by Tymo",
    sections: [
      { title: "1. Administrator i kontakt", paragraphs: [
        `Administratorem danych kont, rozliczeń i korespondencji jest ${salesPolicy.seller}, NIP ${salesPolicy.nip}, ${salesPolicy.address}, e-mail: ${salesPolicy.email}. Na ten adres można kierować pytania i żądania dotyczące danych. Nie należy przesyłać haseł ani tokenów.`,
      ] },
      { title: "2. Zakres i źródła danych", paragraphs: [
        "Od użytkownika otrzymujemy e-mail, dane logowania, imię i nazwisko lub nazwę firmy, adres rozliczeniowy, typ klienta i, w przypadku firmy, NIP oraz dane przesyłane w zgłoszeniach. W bazie zapisywane są dane konta, daty dostępu i próby, ustawienia, sesje robocze, szablony, dane pojazdów i historia operacji administracyjnych. Historia sesji może obejmować do 20 wcześniejszych wersji.",
        "Po autoryzacji Allegro przetwarzamy identyfikator konta sprzedawcy, dane własnych ofert i zaszyfrowane tokeny. Operator płatności przekazuje informacje o zamówieniu, kwocie, statusie i identyfikatorach transakcji. Podmioty infrastruktury przetwarzają dane techniczne połączenia, w tym adres IP, informacje o przeglądarce i logi bezpieczeństwa.",
        "Oryginały zdjęć pozostają w lokalnym folderze i nie są częścią serwerowej kopii sesji. Podczas publikacji wybrane zdjęcia i treść oferty są przekazywane do Allegro. Wystawiacz nie przechowuje hasła Allegro, kodu BLIK ani pełnego numeru karty. Dane w opisach, zdjęciach i sesjach mogą dotyczyć innych osób; nie należy umieszczać informacji zbędnych do wystawienia oferty.",
      ] },
      { title: "3. Cele i podstawy", paragraphs: [
        "Dane klienta będącego osobą fizyczną służą rejestracji, zawarciu i wykonaniu umowy, obsłudze dostępu i pomocy: art. 6 ust. 1 lit. b RODO. Rozliczenia i obowiązki podatkowe oraz inne obowiązki prawne: art. 6 ust. 1 lit. c RODO. Kontakt z przedstawicielami i upoważnionymi pracownikami firm, zabezpieczenie usługi, ograniczanie ponownych prób bezpłatnego dostępu, przeciwdziałanie nadużyciom oraz ustalanie, dochodzenie i obrona roszczeń: art. 6 ust. 1 lit. f RODO; interesem jest obsługa klienta i ochrona usługi oraz praw stron.",
        "Dane niezbędne do umowy i rozliczenia są dobrowolne, ale ich niepodanie może uniemożliwić rejestrację, zakup lub użycie określonej funkcji. Dane nie są wykorzystywane do niezależnego marketingu tylko dlatego, że klient założył konto. Gdy określone przetwarzanie wymaga zgody, ma ono osobną podstawę i informację, a zgodę można wycofać bez wpływu na wcześniejsze zgodne z prawem przetwarzanie.",
        "W odniesieniu do danych osób trzecich wpisanych przez klienta biznesowego do ofert i sesji klient może być administratorem, a usługodawca podmiotem przetwarzającym na jego polecenie. W takim zakresie przed przekazaniem danych należy ustalić właściwe warunki powierzenia. Polityka prywatności sama nie zastępuje umowy powierzenia.",
      ] },
      { title: "4. Odbiorcy i przekazywanie danych", paragraphs: [
        "Z usługi korzystają dostawcy: Cloudflare w zakresie hostingu, ruchu i zabezpieczeń; Supabase w zakresie logowania i bazy; home.pl w zakresie poczty kontaktowej, wiadomości logowania i potwierdzeń zamówień wraz z dokumentami. Allegro otrzymuje dane potrzebne do autoryzacji i publikacji. Tpay otrzymuje dane wymagane do obsługi płatności i realizuje własne obowiązki operatora. W przypadku wcześniej obsługiwanych rozliczeń Stripe dane tych rozliczeń przetwarza również Stripe. Dostęp mogą mieć upoważnieni współpracownicy, obsługa księgowa lub prawna i organy uprawnione na podstawie przepisów, w niezbędnym zakresie.",
        "Dostawcy infrastruktury działają międzynarodowo; nie deklarujemy przechowywania wszystkich danych wyłącznie w Polsce ani EOG. Przekazanie poza EOG wymaga właściwej podstawy z rozdziału V RODO, np. odpowiedniej decyzji o adekwatności lub standardowych klauzul umownych i wymaganych zabezpieczeń. Informacje o stosowanej dla konkretnego przekazania podstawie i sposobie uzyskania kopii zabezpieczeń można otrzymać od administratora. Nie oznacza to udzielenia zgody na dowolne przekazywanie danych. Korzystamy z mechanizmów przewidzianych w warunkach przetwarzania dostawców, odpowiednich do danego przekazania; informacje o zabezpieczeniach Cloudflare i Supabase są dostępne także w ich publicznych umowach przetwarzania danych (cloudflare.com/cloudflare-customer-dpa/ oraz supabase.com/legal/customer-resources/data-processing-addendum).",
        "Podpowiedzi i porównania cen korzystają z Allegro lub zapytań z numerem części do portali wskazanych w funkcji porównania: Allegro, Ovoko, Otomoto i OLX. Otwarcie zewnętrznej wyszukiwarki, w tym Google, przekazuje jej frazę i dane połączenia zgodnie z jej zasadami. Dostawca testowany na potrzeby przyszłej wyceny nie staje się automatycznie odbiorcą danych użytkowników; nowa integracja wymaga odrębnego sprawdzenia i aktualizacji informacji.",
      ] },
      { title: "5. Przechowywanie i usuwanie", paragraphs: [
        "Dane konta, profilu, ustawień, sesji i ich historii oraz połączenia Allegro przechowujemy przez czas utrzymywania konta. Sam koniec próby lub opłaconego miesiąca nie usuwa konta automatycznie. Zamknięcie konta obsługujemy ręcznie na wniosek wysłany na biuro@tymogarage.pl, bez konieczności aktywnego abonamentu. Po weryfikacji wniosku usuwamy zbędne dane robocze i połączenie Allegro; dane konieczne do obowiązków prawnych i konkretnego sporu wydzielamy zamiast zachowywać całe konto. Co miesiąc przeglądamy dane przeznaczone do usunięcia oraz upływ okresów ich przechowywania.",
        "Dokumenty podatkowe i niezbędne dane transakcji zachowuje się co do zasady do przedawnienia zobowiązania podatkowego: 5 lat od końca roku kalendarzowego, w którym upłynął termin płatności podatku. Zawieszenie lub przerwanie tego biegu oraz odrębne obowiązki rachunkowe mogą wydłużyć właściwy okres. Dane niezbędne do konkretnego roszczenia lub sporu mogą być przechowywane do upływu właściwego terminu przedawnienia, a przy trwającym postępowaniu do jego prawomocnego zakończenia i rozliczenia. Nie jest to podstawa do zachowywania całej zawartości sesji na czas roszczeń.",
        "Minimalny zapis wykorzystanej próby obejmuje identyfikator firmy (NIP) lub sprzedawcy Allegro i termin próby, bez zdjęć i treści sesji. Zachowujemy go podczas utrzymywania konta oraz najwyżej 3 lata po jego zamknięciu, aby przeciwdziałać wielokrotnemu zakładaniu kont dla tej samej bezpłatnej próby. Podczas comiesięcznego przeglądu usuwamy zapis po upływie tego okresu lub wcześniej, jeżeli nie jest już niezbędny. Nie jest to automatyczny mechanizm kasowania danych.",
        "Logi techniczne połączeń i kopie bezpieczeństwa są utrzymywane w rotacyjnych cyklach usług hostingowych i bazy danych, niezależnie od bieżących sesji roboczych. Kopii nie wykorzystujemy do dalszej zwykłej obsługi zamkniętego konta; usunięte dane mogą pozostać w istniejącej kopii do jej zastąpienia lub wygaśnięcia w cyklu dostawcy. Jeżeli kopia zostanie odtworzona, ponownie uwzględniamy wykonane żądania usunięcia. Dane potrzebne do wyjaśnienia konkretnego incydentu wydzielamy i przechowujemy do jego wyjaśnienia lub, gdy są konieczne do roszczeń, przez właściwy okres wskazany powyżej. Informacje o cyklach dostępnych logów i kopii: developers.cloudflare.com/workers/observability/logs/workers-logs/ oraz supabase.com/docs/guides/platform/backups; o warunki właściwe dla danych osoby można zapytać administratora.",
      ] },
      { title: "6. Prawa osób", paragraphs: [
        "W granicach wynikających z podstawy i okoliczności przetwarzania przysługują prawa dostępu, otrzymania kopii, sprostowania, usunięcia, ograniczenia i przenoszenia danych oraz sprzeciwu wobec przetwarzania opartego na uzasadnionym interesie. Przysługuje prawo wniesienia skargi do Prezesa Urzędu Ochrony Danych Osobowych. Wycofanie zgody, jeśli jest podstawą przetwarzania, nie wpływa na zgodność wcześniejszych działań.",
        "Administrator może zweryfikować tożsamość wnioskodawcy w sposób proporcjonalny do żądania; nie wymaga podania hasła ani tokenów. Usunięcie nie obejmuje danych, których dalsze przechowywanie wynika z obowiązku prawnego lub jest niezbędne do roszczeń. Odmowa lub ograniczenie realizacji żądania wymaga podstawy i wyjaśnienia, a nie samego braku aktywnego abonamentu.",
      ] },
      { title: "7. Pamięć przeglądarki i zewnętrzne strony", paragraphs: [
        "Logowanie przez Supabase wykorzystuje pamięć przeglądarki do utrzymania sesji. localStorage przechowuje również ustawienia autozapisu, wielkich liter i trybu podpowiedzi tytułu, numeru i dopisku katalogowego, sortowania i wyszukiwania cen, lokalizacji nadania oraz etykietę folderu zdjęć. Dostęp do plików może korzystać z uprawnień i pamięci przeglądarki. Ustawienia pozostają do zmiany lub usunięcia przez użytkownika albo wyczyszczenia danych witryny; wylogowanie nie musi usuwać wszystkich preferencji.",
        "Usunięcie tych danych może wylogować użytkownika lub usunąć lokalne ustawienia, lecz nie usuwa automatycznie konta ani sesji zapisanych na serwerze. W kodzie aplikacji nie wdrożono własnych trackerów reklamowych. Zewnętrzne portale otwarte przez użytkownika stosują własne zasady cookies i prywatności. Dodanie analityki lub marketingu wymaga uprzedniego sprawdzenia podstawy, informacji i, gdy konieczna, osobnej zgody.",
      ] },
      { title: "8. Automatyzacja i bezpieczeństwo", paragraphs: [
        "Podpowiedzi i porównania cen mają charakter pomocniczy; publikację zatwierdza użytkownik. Dostęp jest sprawdzany automatycznie na podstawie potwierdzenia e-maila, okresu próbnego, opłacenia, zawieszenia i powiązań kont. W razie sporu dotyczącego blokady można żądać wyjaśnienia i weryfikacji przez usługodawcę. Nie jest to zgoda na niezależne wykorzystywanie danych do innych celów.",
        "Połączenia są szyfrowane, tokeny Allegro są szyfrowane po stronie serwera, a uprawnienia do danych są rozdzielane między kontami. Stosowanie zabezpieczeń nie jest obietnicą całkowitego braku ryzyka. Nie należy przesyłać sekretów w korespondencji ani wpisywać danych szczególnie chronionych do opisów i sesji.",
      ] },
    ] satisfies SalesSection[],
  },
} as const;

export type SalesDocumentName = keyof typeof salesDocuments;
export function salesDocumentText(name: SalesDocumentName) {
  const document = salesDocuments[name];
  const status = salesPolicy.published ? "" : "Projekt do zatwierdzenia. Platnosci produkcyjne pozostaja wylaczone.\n";
  return `${document.title}\nWersja: ${salesPolicy.version}\n${status}\n${document.sections.map(section => `${section.title}\n${section.paragraphs.join("\n\n")}`).join("\n\n")}\n`;
}
export function salesDocumentPath(name: SalesDocumentName) {
  return `/dokumenty/${name}-${salesPolicy.version}.txt`;
}
