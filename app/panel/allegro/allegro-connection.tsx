"use client";

import { useEffect, useRef, useState } from "react";
import { allegroRequest } from "@/lib/allegro-client";

const callbackErrors: Record<string, string> = {
  oauth_configuration: "Nieprawidlowa konfiguracja aplikacji Allegro lub adresu powrotu na serwerze.",
  oauth_database_config: "Brakuje konfiguracji bazy polaczen na serwerze.",
  oauth_cookie_missing: "Brakuje sesji rozpoczetego laczenia. Zamknij stare okna logowania i rozpocznij raz jeszcze w tej samej przegladarce.",
  oauth_encryption: "Serwer nie moze zaszyfrowac lub odczytac sesji laczenia. Nie zmieniaj klucza szyfrowania.",
  oauth_cookie_invalid: "Nie mozna odczytac sesji laczenia. Zamknij stare okna logowania i rozpocznij nowa probe.",
  oauth_session_invalid: "Sesja laczenia wygasla albo odpowiedz pochodzi z innej proby. Zamknij stare okna logowania i rozpocznij tylko jedna nowa probe.",
  oauth_denied: "Allegro zwrocilo blad lub zgoda na polaczenie zostala anulowana.",
  oauth_code_missing: "W odpowiedzi Allegro brakuje kodu autoryzacji.",
  oauth_token_unavailable: "Nie udalo sie polaczyc z serwerem autoryzacji Allegro.",
  oauth_token_rejected: "Allegro odrzucilo wymiane kodu na token. Nie potwierdzono blokady przypisania sprzedawcy.",
  oauth_invalid_grant: "Allegro odrzucilo kod autoryzacji lub PKCE (invalid_grant). Kod mogl wygasnac albo zostac juz wykorzystany. Wymagana nowa proba logowania.",
  oauth_invalid_client: "Allegro odrzucilo identyfikacje aplikacji (invalid_client/unauthorized_client). Sprawdzimy konfiguracje serwera, nie zmieniaj kont sprzedawcy.",
  oauth_invalid_request: "Allegro odrzucilo format zadania autoryzacji (invalid_request). Sprawdzimy integracje, nie przypisanie sprzedawcy.",
  oauth_token_response: "Allegro nie zwrocilo prawidlowych danych dostepu.",
  oauth_seller_read: "Uzyskano token, ale nie udalo sie potwierdzic tozsamosci sprzedawcy przez API Allegro.",
  oauth_seller_binding: "Nie udalo sie sprawdzic przypisania sprzedawcy w bazie. To nie jest potwierdzone odrzucenie konta.",
  oauth_connection_save: "Autoryzacja przeszla, ale nie potwierdzono zapisu polaczenia w bazie Wystawiacza. Odswiez status przed kolejna proba.",
  seller_not_allowed: "Zablokowano przypisanie konta Allegro: jest juz przypisane do innego konta Wystawiacza albo osiagnieto limit kont Allegro. Administrator nie omija tej blokady. Nie rozlaczaj dzialajacego konta; najpierw sprawdzimy przypisanie.",
};

export function AllegroConnection() {
  const [seller, setSeller] = useState<{ id: string; login?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const popup = useRef<Window | null>(null);
  const waiting = useRef(false);
  const starting = useRef(false);
  useEffect(() => {
    let mounted = true;
    void allegroRequest<{ id: string; login?: string }>("/me").then(data => { if (mounted) setSeller(data); }).catch(error => { if (mounted) setMessage(error.message); });
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || !popup.current || event.source !== popup.current || event.data?.type !== "wystawiacz-allegro-complete") return;
      waiting.current = false;
      if (event.data.ok === true) window.location.reload();
      else {
        setBusy(false);
        const code = typeof event.data.code === "string" && Object.hasOwn(callbackErrors, event.data.code) ? event.data.code : "";
        setMessage(code ? `${callbackErrors[code]} Kod: ${code}. ${code === "oauth_connection_save" ? "Nie zmieniono ofert." : "Dotychczasowe polaczenie pozostalo bez zmian."}` : "Nie udalo sie polaczyc konta. Nie potwierdzono, ze przyczyna jest przypisanie sprzedawcy. Odswiez status polaczenia przed kolejna proba.");
      }
    };
    window.addEventListener("message", receive);
    const timer = window.setInterval(() => {
      if (waiting.current && !starting.current && popup.current?.closed) { waiting.current = false; setBusy(false); setMessage("Okno logowania zostalo zamkniete bez potwierdzenia polaczenia. Odswiez status przed kolejna proba. Nie zmieniono ofert."); }
    }, 500);
    return () => { mounted = false; window.clearInterval(timer); window.removeEventListener("message", receive); };
  }, []);
  async function connect() {
    if (waiting.current) return;
    const target = window.open("about:blank", "wystawiacz-allegro", "popup,width=650,height=760");
    if (!target) { setMessage("Zezwol na otwarcie okna logowania Allegro i sprobuj ponownie."); return; }
    popup.current = target;
    waiting.current = true;
    starting.current = true;
    setBusy(true); setMessage("");
    try {
      const result = await allegroRequest<{ url: string }>("/auth/start", { method: "POST" });
      if (target.closed) throw new Error("Okno logowania zamknieto przed rozpoczeciem autoryzacji. Mozesz rozpoczac nowa probe.");
      const url = new URL(result.url);
      if (url.origin !== "https://allegro.pl" || url.pathname !== "/auth/oauth/authorize") throw new Error("Nieprawidlowy adres logowania Allegro.");
      target.location.href = url.href;
    } catch (error) { waiting.current = false; target.close(); setBusy(false); setMessage(error instanceof Error ? error.message : "Nie udalo sie rozpoczac logowania."); }
    finally { starting.current = false; }
  }
  return <div className="mt-5 space-y-4">
    {seller && <p className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-4 text-emerald-200">Polaczone konto: <strong>{seller.login || seller.id}</strong> <span className="text-sm">(ID {seller.id})</span></p>}
    {message && <p role="status" className="rounded-xl border border-amber-400/20 bg-amber-400/10 p-4 text-amber-100">{message}</p>}
    <div className="flex flex-wrap gap-3">
      <button type="button" disabled={busy} onClick={() => void connect()} className="rounded-xl bg-[#ff5a00] px-5 py-3 font-bold disabled:opacity-50">{busy ? "Otwieram Allegro..." : seller ? "Polacz ponownie z Allegro" : "Polacz z Allegro"}</button>
      <button type="button" className="rounded-xl border border-white/20 px-5 py-3 font-bold" onClick={() => window.location.reload()}>Odswiez status</button>
      <a href="/panel/inventory" className="rounded-xl border border-white/20 px-5 py-3 font-bold">Moje oferty</a>
    </div>
    <p className="text-sm leading-6 text-white/60">To samo polaczenie obsluguje formularz wystawiania i podglad ofert. Haslo wpisujesz wylacznie na stronie Allegro; nie podawaj nam kluczy ani hasla.</p>
    <p className="text-sm text-white/60">Po zakonczonym logowaniu, jesli status nie zmieni sie automatycznie, kliknij Odswiez status.</p>
  </div>;
}
