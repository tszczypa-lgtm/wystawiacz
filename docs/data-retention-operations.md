# Reczne zamykanie kont i przeglad danych

Zatwierdzone przez wlasciciela 2026-10-30. To procedura operacyjna,
nie opis automatycznego zadania ani potwierdzenie przeprowadzenia audytu prawnego.

## Zamkniecie konta

1. Przyjmij wniosek na biuro@tymogarage.pl. Zweryfikuj tozsamosc
   proporcjonalnie do ryzyka, bez zadania hasla, tokenu lub kodu platnosci.
2. Ustal zakres wniosku i udostepnij wymagane prawem dane klienta.
   Brak abonamentu nie blokuje realizacji praw.
3. Oddziel niezbedne dokumenty rozliczeniowe i dane konkretnego sporu.
   Nie zachowuj calej sesji jako zabezpieczenia potencjalnych roszczen.
4. Usun zbedne sesje i ich wersje, preferencje, szablony, profil,
   tokeny Allegro i dostep do konta. Przed operacja sprawdz zaleznosci FK:
   nie usuwaj kaskadowo dokumentow wymaganych prawem.
5. Minimalny slad proby to NIP lub identyfikator sprzedawcy i termin proby.
   Zachowaj tylko niezbedny zakres najwyzej przez 3 lata po zamknieciu konta.
   Zanotuj date zamkniecia i termin usuniecia w chronionym rejestrze
   operatora; obecna tabela company_trial_claims nie zapisuje daty zamkniecia.
   Nie przechowuj rejestru danych klientow w repozytorium.
6. Potwierdz wykonanie wniosku i wyjasnij zakres/okres danych zachowanych
   z obowiazku prawnego. Usuniecie nie konczy ofert klienta na Allegro.

## Co miesiac

- Przejrzyj rejestr zamknietych kont i usun przeterminowane slady proby.
  Usun je wczesniej, jezeli nie sa juz niezbedne.
- Przejrzyj dane sporow i rozliczen zgodnie z wlasciwymi terminami
  przedawnienia i obowiazkami ustawowymi, z uwzglednieniem ich zawieszenia.
- Sprawdz zalegle zadania i odnotuj wykonanie bez kopiowania tresci sesji.
- Po odtworzeniu kopii ponownie zastosuj wykonane zadania usuniecia.

## Przed uruchomieniem prawdziwych platnosci

- Sprawdz umowy powierzenia, mechanizmy transferu i konfiguracje regionow
  Cloudflare, Supabase i home.pl. Publikacja polityki nie potwierdza sama
  wykonania tych czynnosci ani zawarcia umowy powierzenia.
- Odnotuj aktualne cykle logow/kopii dla wykorzystywanych planow.
  Retencja logow widocznych w panelu nie obejmuje automatycznie kazdego
  wewnetrznego logu dostawcy; nie deklaruj niepotwierdzonych terminow.
- Sprawdz przekazanie warunkow i oswiadczen na trwalym nosniku
  w wymaganym terminie, takze przy awarii kolejki poczty.
- Zlecenie konsumenta bez wczesniejszego startu obsluguj po indywidualnym
  uzgodnieniu przed zakupem; obecny checkout go samodzielnie nie obsluguje.
- Osobno zatwierdz gotowosc sprzedazy. salesPolicy.approved pozostaje false.

## Wersje dokumentow

Opublikowana wersja: 2026-10-30-1. Archiwum 2026-10-28-review-2
pozostaje dostepne po starych adresach. Nie podmieniaj historycznych
oswiadczen ani pelnych dokumentow w zamowieniach.
