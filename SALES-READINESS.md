# Przygotowanie sprzedazy - 2026-10-15

Dane sprzedawcy i dzialajacy e-mail potwierdzone przez wlasciciela.
Sprzedaz docelowo firmom i osobom prywatnym z Polski.

## Gotowe w kodzie, nie oznacza zgody na uruchomienie platnosci

- Publiczne `/oferta`, `/kontakt`, `/regulamin`, `/prywatnosc`.
- Regulamin i prywatnosc sa jawnie oznaczone jako PROJEKTY; nie przedstawiamy
  ich jako koncowych dokumentow zgodnych z prawem.
- Informacja o 500 PLN brutto, miesiacu kalendarzowym, braku odnowien, datach
  aktywacji i oplatach Allegro nieuwzglednionych w cenie.
- Dane kontaktowe oraz skladanie reklamacji i oswiadczen bez podawania hasla.
- Wybor firma/osoba prywatna w rejestracji i rozliczeniach.
- Osoba prywatna nie podaje NIP-u. Dotychczasowy profil firmy zachowuje format.
- Profil prywatny ma ten sam poczatkowy termin triala; ochrona przed jego
  ponawianiem przy ponownym polaczeniu wykorzystuje zachowany identyfikator
  sprzedawcy Allegro. Sam zadeklarowany NIP nie dowodzi tozsamosci firmy.
- Bez zmian w istniejacych aukcjach i polaczeniach Allegro.

## Kolejnosc wdrozenia

1. Zachowaj kopie bazy. Przed wyslaniem nowego kodu uruchom jednorazowo
   `supabase/006_personal_customer_profiles.sql`.
   Zmienia jedynie whiteliste danych inicjalnego profilu nowego uzytkownika;
   nie przepisuje danych istniejacych klientow ani nie przenosi rol z metadanych.
2. Wdroz kod przez dotychczasowy GitHub/Cloudflare.
3. Sprawdz rejestracje testowej osoby prywatnej, potwierdzenie e-maila, zapis
   danych i test checkoutu sandbox. Sprawdz tez dotychczasowa firme.
4. Sprawdz dokumenty na telefonie i komputerze i potwierdz dane sprzedawcy.

## Warunki przed dopuszczeniem produkcji

`lib/sales-policy.ts` ma `approved: false`. Nawet samo ustawienie
`TPAY_LIVE_APPROVED=true` nie otworzy produkcyjnego checkoutu, dopoki dokumenty
i proces zakupu nie zostana przygotowane i osobno zatwierdzone w kodzie.
Sandbox pozostaje dostepny administratorowi i nie przyznaje produkcyjnych dni.

Przed zmiana approved trzeba wykonac co najmniej:

- sprawdzenie prawne regulaminu, prywatnosci, uslugi cyfrowej, konsumentow
  i przedsiebiorcow z ustawowa ochrona; nie utozsamiac SaaS z jednorazowym plikiem;
- wersjonowana akceptacja regulaminu i osobne oswiadczenia o rozpoczeciu
  uslugi przed uplywem terminu odstapienia (bez automatycznego zrzeczenia sie praw);
- niezmienny zapis wersji i oswiadczen w zamowieniu, wraz z potwierdzeniem umowy
  i dokumentow na trwalym nosniku; obecny checkout tych elementow NIE zapewnia;
- rozstrzygniecie retencji, usuwania kont i danych, eksportu, kopii, logow,
  rejestrow antynaduzyciowych, rol/umow powierzenia i transferow danych;
- uzgodnienie fakturowania i rozliczen z ksiegowoscia;
- zakonczenie weryfikacji firmy i strony przez Tpay;
- osobne testy procesu konsumenckiego i proba produkcyjna po zgodzie wlasciciela.

Nie wlaczaj starego `BILLING_ENABLED` (Stripe) jako zamiennika Tpay.

Zrodla do dalszej weryfikacji (nie zastepuja indywidualnej porady prawnej):
https://prawakonsumenta.uokik.gov.pl/prawo-do-informacji/sprzedaz-poza-lokalem-i-na-odleglosc/
https://prawakonsumenta.uokik.gov.pl/pytania-i-odpowiedzi/odstapienie-od-umowy/
https://prawakonsumenta.uokik.gov.pl/pytania-i-odpowiedzi/prawo-do-informacji/
https://www.parp.gov.pl/publikacje/publication/wzory-dokumentow-dla-e-przedsiebiorcow
