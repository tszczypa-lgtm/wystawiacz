"use client";

import { useEffect, useRef, useState } from "react";
import { allegroRequest } from "@/lib/allegro-client";

export function AllegroConnection() {
  const [seller, setSeller] = useState<{ id: string; login?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const popup = useRef<Window | null>(null);
  useEffect(() => {
    let mounted = true;
    void allegroRequest<{ id: string; login?: string }>("/me").then(data => { if (mounted) setSeller(data); }).catch(error => { if (mounted) setMessage(error.message); });
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || !popup.current || event.source !== popup.current || event.data?.type !== "wystawiacz-allegro-complete") return;
      if (event.data.ok) window.location.reload();
      else { setBusy(false); setMessage("Nie udalo sie polaczyc konta. Dotychczasowe polaczenie pozostalo bez zmian."); }
    };
    window.addEventListener("message", receive);
    return () => { mounted = false; window.removeEventListener("message", receive); };
  }, []);
  async function connect() {
    const target = window.open("about:blank", "wystawiacz-allegro", "popup,width=650,height=760");
    if (!target) { setMessage("Zezwol na otwarcie okna logowania Allegro i sprobuj ponownie."); return; }
    popup.current = target;
    setBusy(true); setMessage("");
    try {
      const result = await allegroRequest<{ url: string }>("/auth/start", { method: "POST" });
      const url = new URL(result.url);
      if (url.origin !== "https://allegro.pl" || url.pathname !== "/auth/oauth/authorize") throw new Error("Nieprawidlowy adres logowania Allegro.");
      target.location.href = url.href;
    } catch (error) { target.close(); setMessage(error instanceof Error ? error.message : "Nie udalo sie rozpoczac logowania."); }
    finally { setBusy(false); }
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
