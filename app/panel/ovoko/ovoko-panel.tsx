"use client";

import { useEffect, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import type { OvokoReadOperation, OvokoReadResult } from "@/lib/ovoko-read";

type Probe = { ok: boolean; code: string; checkedAt: string; credentialsStored?: boolean; brands: { id: string; name: string }[] };
const field = "mt-1 w-full rounded-lg border border-white/20 bg-[#0d1117] px-3 py-2 text-white";
const operations = { brands: "Marki aut - test polaczenia", models: "Slownik modeli (nie auta-dawcy)", categories: "Kategorie czesci", statuses: "Statusy magazynowe", qualities: "Stan czesci (jakosc)", parts: "Rekordy czesci - nie lista ofert w sprzedazy (20)" };
export function OvokoPanel() {
  const [allowed, setAllowed] = useState(false), [checking, setChecking] = useState(true), [busy, setBusy] = useState(false);
  const [username, setUsername] = useState(""), [password, setPassword] = useState(""), [token, setToken] = useState("");
  const [error, setError] = useState(""), [result, setResult] = useState<Probe | null>(null);
  const [operation, setOperation] = useState<"brands" | OvokoReadOperation>("brands"), [brandId, setBrandId] = useState("");
  const [brands, setBrands] = useState<Probe["brands"]>([]), [readResult, setReadResult] = useState<OvokoReadResult | null>(null);
  const [connected, setConnected] = useState(false), [storageReady, setStorageReady] = useState(false), [remember, setRemember] = useState(false), [editing, setEditing] = useState(false);
  const useSaved = connected && !editing;
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
    void request<{ allowed: boolean; connected?: boolean; storageReady?: boolean }>("status", check.signal).then(data => { if (!check.signal.aborted) { setAllowed(data.allowed === true); setConnected(data.connected === true); setStorageReady(data.storageReady === true); setRemember(data.storageReady === true); } }).catch(error => { if (!check.signal.aborted) setError(error.message); }).finally(() => { if (!check.signal.aborted) setChecking(false); });
    return () => { check.abort(); controller.current?.abort(); };
  }, []);
  async function test(event: React.FormEvent) {
    event.preventDefault(); if (busy || !allowed) return;
    setBusy(true); setError(""); setResult(null); setReadResult(null);
    const active = new AbortController(); controller.current = active;
    try {
      const credentials = useSaved ? { useSaved: true } : { username, password, user_token: token };
      const saving = !useSaved && remember;
      if (operation === "brands" || saving) {
        const data = await request<Probe>(saving ? "connect" : "test", active.signal, credentials);
        if (!data.ok || data.code !== "R200" || !Array.isArray(data.brands)) throw new Error("Nie potwierdzono poprawnego odczytu Ovoko.");
        if (saving && data.credentialsStored !== true) throw new Error("Nie potwierdzono zapisu polaczenia. Odswiez panel, aby sprawdzic jego stan.");
        setResult(data); setBrands(data.brands); setBrandId("");
        if (saving) { setConnected(true); setEditing(false); setOperation("brands"); setUsername(""); }
      } else {
        const data = await request<OvokoReadResult>("read", active.signal, { ...credentials, operation, ...(operation === "models" ? { brandId } : {}) });
        if (!data.ok || data.code !== "R200" || data.operation !== operation || !Array.isArray(data.rows)) throw new Error("Nie potwierdzono poprawnego odczytu Ovoko.");
        setReadResult(data);
      }
    } catch (error) { setError(error instanceof Error && error.name === "AbortError" ? !useSaved && remember ? "Przerwano oczekiwanie. Zapis polaczenia mogl zakonczyc sie na serwerze; odswiez panel, aby sprawdzic stan. Ofert nie zmieniono." : "Przerwano oczekiwanie. Test nie zmienia ofert." : error instanceof Error ? error.message : "Blad testu."); }
    finally { setPassword(""); setToken(""); setBusy(false); controller.current = null; }
  }
  async function disconnect() {
    if (busy || !window.confirm("Usunac tylko zapisane polaczenie Ovoko? Czesci, oferty i samochody pozostana bez zmian.")) return;
    setBusy(true); setError("");
    const active = new AbortController(); controller.current = active;
    try {
      const data = await request<{ ok: boolean; connected: boolean }>("disconnect", active.signal, {});
      if (data.ok !== true || data.connected !== false) throw new Error("Nie potwierdzono rozlaczenia. Odswiez panel, aby sprawdzic stan.");
      setConnected(false); setEditing(false); setResult(null); setReadResult(null); setBrands([]); setBrandId(""); setUsername(""); setPassword(""); setToken(""); setOperation("brands");
    } catch (error) { setError(error instanceof Error ? error.message : "Nie udalo sie rozlaczyc."); }
    finally { setBusy(false); controller.current = null; }
  }
  return <section className="max-w-3xl space-y-5">
    <h1 className="text-3xl font-black">Ovoko - test odczytu</h1>
    <p className="rounded-xl border border-white/15 p-4 text-sm leading-6">Rozdzielamy: rekord czesci w magazynie, miejsce skladowania, samochod-dawce oraz oferte widoczna na portalu. To nie sa zamienne rzeczy. Ten panel nie odczytuje miejsc skladowania ani aut-dawcow, a slownik modeli nie jest lista Twoich samochodow. Rekord czesci i jego status nie potwierdzaja widocznosci oferty w sprzedazy.</p>
    <p className="rounded-xl border border-emerald-400/25 bg-emerald-400/10 p-4 text-sm leading-6 text-emerald-100">Tylko odczyt dla administratora: slowniki i podglad pierwszych 20 czesci magazynu. Kazdy przycisk wykonuje jeden odczyt. Nie importujemy czesci, nie zmieniamy cen ani stanow, nie konczymy ofert i nie uruchamiamy synchronizacji.</p>
    {checking && <p role="status">Sprawdzam uprawnienia...</p>}
    {error && <p role="alert" className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm">{error}</p>}
    {allowed && connected && <div className="rounded-xl border border-emerald-400/25 p-4"><p role="status">Polaczenie Ovoko zapisane. Dane API pozostaja zaszyfrowane na serwerze; nie sa wysylane z powrotem do przegladarki. To nie wlacza synchronizacji ani nie potwierdza widocznosci ofert.</p><div className="mt-3 flex gap-3"><button type="button" disabled={busy} onClick={() => { setEditing(!editing); setPassword(""); setToken(""); setError(""); }} className="rounded-lg border border-white/20 px-3 py-2">{editing ? "Uzyj zapisanego polaczenia" : "Zmien dane polaczenia"}</button><button type="button" disabled={busy} onClick={() => void disconnect()} className="rounded-lg border border-white/20 px-3 py-2">Rozlacz Ovoko</button></div></div>}
    {allowed && <form onSubmit={test} autoComplete="off" className="space-y-4 rounded-2xl border border-white/10 bg-white/5 p-5">
      {!useSaved && <p className="text-sm text-white/70">Wpisz trzy wartosci otrzymane od Ovoko, nie link 1Password. Zapisane polaczenie jest szyfrowane na serwerze i przypisane do Twojego konta Wystawiacza. Nie zapisujemy kluczy w przegladarce. Pola hasla i tokena sa czyszczone po probie. Zapis nastepuje tylko po poprawnym tescie odczytu marek.</p>}
      {!useSaved && <label className="flex gap-2 text-sm"><input type="checkbox" checked={remember} disabled={busy || !storageReady} onChange={event => setRemember(event.target.checked)} />Zapamietaj polaczenie na serwerze</label>}
      {!useSaved && !storageReady && <p className="text-sm text-amber-200">Zapis polaczenia wymaga konfiguracji szyfrowania serwera. Dostepny jest odczyt jednorazowy.</p>}
      <label className="block text-sm">Co odczytac<select className={field} value={!useSaved && remember ? "brands" : operation} disabled={busy || (!useSaved && remember)} onChange={event => { setOperation(event.target.value as typeof operation); setResult(null); setReadResult(null); setError(""); }}>{Object.entries(operations).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {operation === "models" && !(!useSaved && remember) && <label className="block text-sm">Marka auta<select className={field} value={brandId} required disabled={busy || !brands.length} onChange={event => setBrandId(event.target.value)}><option value="">{brands.length ? "Wybierz marke" : "Najpierw wykonaj odczyt marek aut"}</option>{brands.map(brand => <option key={brand.id} value={brand.id}>{brand.name} (ID {brand.id})</option>)}</select></label>}
      {!useSaved && <><label className="block text-sm">Login API<input className={field} autoComplete="off" value={username} onChange={event => setUsername(event.target.value)} maxLength={256} required disabled={busy} /></label>
      <label className="block text-sm">Haslo API<input className={field} type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} maxLength={1024} required disabled={busy} /></label>
      <label className="block text-sm">Token API (user_token)<input className={field} type="password" autoComplete="new-password" value={token} onChange={event => setToken(event.target.value)} maxLength={2048} required disabled={busy} /></label></>}
      {operation === "parts" && <p className="text-sm text-amber-200">Podglad jednej strony, nie pelna kopia magazynu. Nie pobieramy zamowien ani danych kupujacych. Cene pokazujemy jako wartosc API bez zgadywania waluty.</p>}
      <div className="flex flex-wrap gap-3"><button type="submit" disabled={busy || (operation === "models" && !brandId && !(!useSaved && remember))} className="rounded-lg bg-[#ff5a00] px-4 py-2 font-bold disabled:opacity-40">{busy ? "Sprawdzam odczyt..." : !useSaved && remember ? "Polacz i zapamietaj Ovoko" : operation === "brands" ? "Testuj odczyt Ovoko" : "Pobierz wybrany podglad"}</button>{busy && <button type="button" onClick={() => controller.current?.abort()} className="rounded-lg border border-white/20 px-4 py-2">Anuluj oczekiwanie</button>}</div>
    </form>}
    {result && <div role="status" className="space-y-3 rounded-xl border border-emerald-400/25 p-4"><h2 className="font-bold text-emerald-300">Odczyt dziala: {result.code}</h2><p className="text-sm">Pobrano marek: {result.brands.length}. Test: {new Date(result.checkedAt).toLocaleString("pl-PL")}. {result.credentialsStored ? "Uzyto polaczenia zapisanego na serwerze." : "Odczyt jednorazowy, bez zapisu danych dostepowych."}</p><p className="text-sm text-white/65">Ten wynik potwierdza uwierzytelnienie i odczyt slownika, nie uprawnienia do publikacji, wlasnosc magazynu ani gotowosc synchronizacji. Nie zmieniono zadnej oferty.</p><ul className="max-h-64 overflow-auto text-sm text-white/75" aria-label="Marki z Ovoko">{result.brands.map(brand => <li key={brand.id}>{brand.name} <span className="text-white/40">(ID {brand.id})</span></li>)}</ul></div>}
    {readResult && <div className="space-y-3 rounded-xl border border-emerald-400/25 p-4">
      <h2 className="font-bold text-emerald-300">{readResult.operation === "cars" ? "Moje samochody Ovoko" : operations[readResult.operation]}: R200</h2>
      <p role="status" className="text-sm">Pobrano rekordow: {readResult.rows.length}. {readResult.pagination && `Strona 1, limit 20; lacznie rekordow czesci wedlug API: ${readResult.pagination.total} (nie liczba ofert w sprzedazy).`} Odczyt: {new Date(readResult.checkedAt).toLocaleString("pl-PL")}. Nie zmieniono ofert. {readResult.credentialsStored ? "Uzyto zapisanego polaczenia." : "Odczyt jednorazowy."}</p>
      {readResult.operation === "categories" && <p className="text-sm text-white/65">Do czesci przypisuje sie kategorie poziomu 3. Na tym etapie niczego nie przypisujemy.</p>}
      {readResult.operation === "parts" && <p className="text-sm text-white/65">Status i jakosc to identyfikatory ze slownikow, nie interpretujemy ich automatycznie. Brak powiazan z Allegro; niczego nie synchronizujemy. Pusty wynik nie oznacza potwierdzonej wlasnosci magazynu.</p>}
      <div className="max-h-80 overflow-auto"><table className="w-full text-left text-sm" aria-label="Wynik odczytu Ovoko"><thead><tr><th className="p-2">ID</th><th className="p-2">Nazwa</th><th className="p-2">Dane z API</th></tr></thead><tbody>{readResult.rows.map(row => <tr key={row.id} className="border-t border-white/10"><td className="p-2 align-top">{row.id}</td><td className="p-2 align-top">{row.name || "Brak nazwy"}</td><td className="p-2 align-top break-words">
        {row.years !== undefined && <p>Lata: {row.years}</p>}
        {row.level !== undefined && <p>Poziom: {row.level}; rodzic ID: {row.parentId}</p>}
        {row.carId !== undefined && <><p>Samochod-dawca ID: {row.carId}; kategoria ID: {row.categoryId}</p><p>Numer: {row.manufacturerCode || "brak"}; zewnetrzne ID: {row.externalId || "brak"}</p><p>Cena API: {row.price || "brak"} (waluta niepotwierdzona)</p><p>Status rekordu czesci ID: {row.status}; jakosc ID: {row.quality}</p><p>Widocznosc w sprzedazy: niepotwierdzona; miejsce skladowania: nieodczytane</p></>}
      </td></tr>)}</tbody></table></div>
      {!readResult.rows.length && <p>Brak czesci w odpowiedzi tej strony API.</p>}
    </div>}
  </section>;
}
