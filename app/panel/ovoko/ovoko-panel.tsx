"use client";

import { useEffect, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase";

type Probe = { ok: boolean; code: string; checkedAt: string; brands: { id: string; name: string }[] };
const field = "mt-1 w-full rounded-lg border border-white/20 bg-[#0d1117] px-3 py-2 text-white";
export function OvokoPanel() {
  const [allowed, setAllowed] = useState(false), [checking, setChecking] = useState(true), [busy, setBusy] = useState(false);
  const [username, setUsername] = useState(""), [password, setPassword] = useState(""), [token, setToken] = useState("");
  const [error, setError] = useState(""), [result, setResult] = useState<Probe | null>(null);
  const controller = useRef<AbortController | null>(null);
  async function request<T>(path: string, signal: AbortSignal, payload?: unknown): Promise<T> {
    const { data } = await createSupabaseBrowserClient().auth.getSession();
    if (!data.session) throw new Error("Zaloguj sie ponownie.");
    const response = await fetch(`/api/ovoko/${path}`, { method: payload ? "POST" : "GET", signal, cache: "no-store", headers: { Authorization: `Bearer ${data.session.access_token}`, ...(payload ? { "Content-Type": "application/json" } : {}) }, body: payload ? JSON.stringify(payload) : undefined });
    const body = await response.json().catch(() => null) as (T & { message?: string }) | null;
    if (!response.ok || !body) throw new Error(body?.message || "Nieprawidlowa odpowiedz serwera.");
    return body as T;
  }
  useEffect(() => {
    const check = new AbortController();
    void request<{ allowed: boolean }>("status", check.signal).then(data => { if (!check.signal.aborted) setAllowed(data.allowed === true); }).catch(error => { if (!check.signal.aborted) setError(error.message); }).finally(() => { if (!check.signal.aborted) setChecking(false); });
    return () => { check.abort(); controller.current?.abort(); };
  }, []);
  async function test(event: React.FormEvent) {
    event.preventDefault(); if (busy || !allowed) return;
    setBusy(true); setError(""); setResult(null);
    const active = new AbortController(); controller.current = active;
    try {
      const data = await request<Probe>("test", active.signal, { username, password, user_token: token });
      if (!data.ok || data.code !== "R200" || !Array.isArray(data.brands)) throw new Error("Nie potwierdzono poprawnego odczytu Ovoko.");
      setResult(data);
    } catch (error) { setError(error instanceof Error && error.name === "AbortError" ? "Przerwano oczekiwanie. Test nie zmienia ofert." : error instanceof Error ? error.message : "Blad testu."); }
    finally { setPassword(""); setToken(""); setBusy(false); controller.current = null; }
  }
  return <section className="max-w-3xl space-y-5">
    <h1 className="text-3xl font-black">Ovoko - test odczytu</h1>
    <p className="rounded-xl border border-emerald-400/25 bg-emerald-400/10 p-4 text-sm leading-6 text-emerald-100">Test tylko dla administratora. Pobieramy wylacznie liste marek aut. Nie importujemy czesci, nie zmieniamy cen ani stanow, nie konczymy ofert i nie uruchamiamy synchronizacji.</p>
    {checking && <p role="status">Sprawdzam uprawnienia...</p>}
    {error && <p role="alert" className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm">{error}</p>}
    {allowed && <form onSubmit={test} autoComplete="off" className="space-y-4 rounded-2xl border border-white/10 bg-white/5 p-5">
      <p className="text-sm text-white/70">Wpisz trzy wartosci otrzymane od Ovoko. Nie wklejaj linku 1Password. Dane sa przesylane do serwera i Ovoko tylko na czas testu, bez zapisu w bazie, sesji ani pamieci lokalnej aplikacji. Haslo i token sa czyszczone po kazdej probie. Uzyj aktualnych danych, ktore nie byly ujawnione na zrzutach.</p>
      <label className="block text-sm">Login API<input className={field} autoComplete="off" value={username} onChange={event => setUsername(event.target.value)} maxLength={256} required disabled={busy} /></label>
      <label className="block text-sm">Haslo API<input className={field} type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} maxLength={1024} required disabled={busy} /></label>
      <label className="block text-sm">Token API (user_token)<input className={field} type="password" autoComplete="new-password" value={token} onChange={event => setToken(event.target.value)} maxLength={2048} required disabled={busy} /></label>
      <div className="flex flex-wrap gap-3"><button type="submit" disabled={busy} className="rounded-lg bg-[#ff5a00] px-4 py-2 font-bold disabled:opacity-40">{busy ? "Sprawdzam odczyt..." : "Testuj odczyt Ovoko"}</button>{busy && <button type="button" onClick={() => controller.current?.abort()} className="rounded-lg border border-white/20 px-4 py-2">Anuluj oczekiwanie</button>}</div>
    </form>}
    {result && <div role="status" className="space-y-3 rounded-xl border border-emerald-400/25 p-4"><h2 className="font-bold text-emerald-300">Odczyt dziala: {result.code}</h2><p className="text-sm">Pobrano marek: {result.brands.length}. Test: {new Date(result.checkedAt).toLocaleString("pl-PL")}. Dane dostepowe nie zostaly zapisane.</p><p className="text-sm text-white/65">Ten wynik potwierdza uwierzytelnienie i odczyt slownika, nie uprawnienia do publikacji, wlasnosc magazynu ani gotowosc synchronizacji. Nie zmieniono zadnej oferty.</p><ul className="max-h-64 overflow-auto text-sm text-white/75" aria-label="Marki z Ovoko">{result.brands.map(brand => <li key={brand.id}>{brand.name} <span className="text-white/40">(ID {brand.id})</span></li>)}</ul></div>}
  </section>;
}
