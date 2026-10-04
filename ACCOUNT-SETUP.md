# Konta, administrator, poczta i rozliczenia

## Status

Kod formularza, profili firmowych, panelu administratora i integracji Stripe jest przygotowany.
Migracja SQL, nadanie administratora, skrzynka home.pl, SMTP i konto Stripe wymagają konfiguracji usług.
Nie uruchamiaj pobierania prawdziwych opłat bez testu kompletnego przepływu i ustalenia ceny,
warunków sprzedaży, podatków oraz sposobu wystawiania faktur z księgowością.
Dokumenty Stripe nie są tutaj deklarowane jako kompletna polska integracja fakturowa.

## Kolejność wdrożenia

1. W Supabase SQL Editor wykonaj `supabase/003_accounts_and_billing.sql`.
   Migracja tworzy profil dla istniejących kont oraz trigger dla nowych kont.
   Nie ma polityk udostępniających tabele `anon` ani `authenticated`.
2. Na serwerze Cloudflare dodaj runtime secret `SUPABASE_SERVICE_ROLE_KEY`.
   Nigdy nie używaj prefiksu `NEXT_PUBLIC_` dla klucza service-role ani Stripe.
3. Znajdź swoje istniejące, potwierdzone konto w Authentication -> Users.
   Nadaj administratora dokładnemu UUID, nie dowolnym metadanym rejestracji:

```sql
insert into public.account_admins(owner_id)
select id from auth.users
where id = 'TWOJ-UUID'::uuid and email_confirmed_at is not null
on conflict do nothing;
```

4. Dopiero po migracji i sekretach opublikuj kod przez GitHub Desktop Push origin.
   Konto bez profilu lub awaria bazy blokują dostęp zamiast przyznawać go domyślnie.
5. Sprawdź dwa osobne konta: administrator widzi `/panel/admin`, zwykły klient dostaje 403
   z API administratora, także gdy sam wpisze adres lub zmieni dane w przeglądarce.

## Uprawnienia

- Administrator może zawieszać/odwieszać, nadawać darmowy dostęp bezterminowo lub do daty,
  cofać darmowy dostęp oraz odczytywać ostatnie 100 zapisów historii.
- Każda zmiana wymaga powodu. Zmiana i wpis audytu są jedną transakcją SQL.
- Panel nie pozwala zmieniać dostępu administratorów ani nadawać roli admin.
- Zawieszenie blokuje operacje Allegro na serwerze; Wystawiacz sprawdza dostęp co 30 sekund.
  Pozostaje dostęp do rozliczeń i anulowania abonamentu.
- Bez `BILLING_ENFORCED=true` niezawieszeni klienci mają dostęp roboczy.
  To świadomy tryb wdrożenia, nie darmowy abonament przyznany wszystkim na zawsze.
- Przy `BILLING_ENFORCED=true` wymagany jest administrator, aktualny darmowy dostęp
  lub abonament `active` z potwierdzonym opłaconym okresem jeszcze niewygasłym.
- Nadanie darmowego dostępu, jego cofnięcie i zawieszenie NIE anulują abonamentu Stripe.
  Nie usuwamy ani nie zamykamy żadnych ofert Allegro.

## Poczta biuro@tymogarage.pl

1. home.pl -> Poczta -> Dodaj. Wybierz domenę `tymogarage.pl`, login `biuro`,
   ustaw unikalne silne hasło i zapisz. Nie wpisuj hasła w czacie ani do repozytorium.
   Jeśli domeny nie ma na liście, sprawdź przypisanie do hostingu/poczty.
2. Zaloguj się do nowej skrzynki na poczta.home.pl. Przetestuj wysłanie i odebranie wiadomości.
3. Odczytaj właściwy host SMTP i port TLS w panelu home.pl. Nie zgaduj hosta po domenie.
4. Supabase -> Authentication -> Email / SMTP Settings -> Custom SMTP.
   Nadawca: `biuro@tymogarage.pl`, nazwa: `Tymo Garage`.
   Login: pełny adres skrzynki. Host, port i hasło zgodnie z home.pl.
5. Authentication -> Email Templates -> Confirm signup:
   temat `Potwierdź konto w Wystawiaczu | Tymo Garage`,
   treść z `supabase/email-confirmation.html` (zachowaj `{{ .ConfirmationURL }}`).
6. URL Configuration: Site URL = właściwa domena aplikacji,
   Redirect URLs zawiera dokładny adres `/login` na tej domenie.
   Authentication: potwierdzanie e-mail włączone, minimalna długość hasła 10.
7. Sprawdź DKIM/SPF w home.pl oraz dostarczanie do zewnętrznej skrzynki, również spam.
   Nie publikuj szablonu z adresem kontaktowym, zanim skrzynka zacznie działać.
   Domyślny SMTP Supabase nie nadaje się do publicznej rejestracji; ma ograniczenia odbiorców.

Źródła: https://supabase.com/docs/guides/auth/auth-smtp
https://supabase.com/docs/guides/auth/auth-email-templates
https://pomoc.home.pl/baza-wiedzy/jak-dodac-skrzynke-e-mail-na-hostingu

## Stripe (opcjonalny operator, wymaga zatwierdzenia właściciela)

Nie utworzono konta operatora, ceny ani płatnej subskrypcji. Kod nie działa w trybie live bez konfiguracji.

Runtime configuration Cloudflare:

- `APP_ORIGIN`: dokładny origin HTTPS Wystawiacza, bez końcowego `/`.
- `STRIPE_SECRET_KEY`: secret testowy na początek.
- `STRIPE_PRICE_ID`: aktywna cena cykliczna, co miesiąc, PLN, 1 jednostka, `tax_behavior=inclusive`.
  Kwotę i podatki ustala właściciel; kod nie wymyśla ceny.
- `STRIPE_WEBHOOK_SECRET`: secret konkretnego endpointu.
- `BILLING_ENABLED=true`: pokazuje zakup po udanej kontroli konfiguracji ceny.
- `BILLING_ENFORCED`: pozostaw `false` podczas konfiguracji. Przełącz na `true`
  dopiero po testach i przyznaniu darmowych kont, które mają pozostać dostępne.

Webhook HTTPS: `/api/account/stripe-webhook`, snapshot events:
`customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`,
`invoice.paid`, `invoice.payment_failed`, `checkout.session.completed`.
Włącz Stripe Customer Portal: aktualizacja metody płatności, historia dokumentów, anulowanie
na koniec okresu. Wyłącz zmiany ceny i ilości w portalu (wdrożenie obsługuje jeden plan).
API jest przypięte do `2025-03-31.basil`; koniec okresu czytany z subscription item.

Webhook sprawdza HMAC SHA-256 na surowym body oraz tolerancję czasu 5 minut.
Odczytuje aktualne subskrypcje z API Stripe, nie ufa kwocie/statusowi przesłanemu przez klienta.
Przypisanie klienta Stripe bierze z serwerowej bazy, nie z pól wysyłanych w formularzu.
Zapis zdarzenia i uprawnień jest atomowy; ponowienie tego samego ID nie zmienia danych.
Starsze zdarzenia nie cofają nowszego stanu. Błędy przejściowe zwracają błąd, by Stripe ponowił.
Powrót z Checkout nie aktywuje konta. Darmowy dostęp i zawieszenie pozostają niezależne od webhooków.
Duplikaty zakupów ogranicza sprawdzenie istniejących subskrypcji i zapisana w bazie próba Checkout:
równoczesne żądania dostają ten sam klucz idempotencji oraz ten sam termin wygaśnięcia sesji (24 godziny).

Testy przed aktywacją:

- rejestracja i potwierdzenie maila, błędne potwierdzenie hasła i błędny NIP;
- istniejące konto bez danych -> uzupełnienie w rozliczeniach;
- udana płatność, przerwana płatność, płatność wymagająca dodatkowej autoryzacji;
- fałszywy powrót `?payment=returned` nie daje dostępu;
- webhook powtórzony, opóźniony, z nieprawidłowym podpisem;
- nieudane odnowienie, anulowanie na koniec okresu, wznowienie;
- portal działa także przy zawieszonym koncie;
- dane firmy, NIP i podatki na faktycznym dokumencie operatora;
- darmowy dostęp z datą wygasa; webhook nie odwiesza klienta;
- zwykły użytkownik nie odczytuje listy klientów ani historii.

Zwroty, chargebacki, integracja polskiego programu fakturowego, samodzielny reset hasła,
regulamin i polityka prywatności wymagają kolejnego etapu przed publiczną sprzedażą.
Nie wprowadzamy automatycznych refundów ani usuwania kont. Monitorowanie awarii webhooków
i ręczna kontrola w Stripe są wymagane operacyjnie.

Źródła: https://docs.stripe.com/webhooks
https://docs.stripe.com/api/checkout/sessions/create
https://docs.stripe.com/changelog/basil/2025-03-31/deprecate-subscription-current-period-start-and-end
