"use client";

import { useEffect, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import type { OvokoReadResult } from "@/lib/ovoko-read";

const button = "rounded-lg border border-white/20 px-3 py-2 text-sm font-bold hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40";
type Connection = { allowed: boolean; connected: boolean };
export function OvokoInventoryPanel() {
  const [connection, setConnection] = useState<Connection | null>(null), [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [result, setResult] = useState<OvokoReadResult | null>(null), [query, setQuery] = useState("");
  const controller = useRef<AbortController | null>(null);
  async function request<T>(path: string, signal: AbortSignal, payload?: unknown): Promise<T> {
    const { data } = await createSupabaseBrowserClient().auth.getSession();
    if (!data.session) throw new Error("Zaloguj sie ponownie.");
    const response = await fetch(`/api/ovoko/${path}`, { method: payload ? "POST" : "GET", signal, cache: "no-store", headers: { Authorization: `Bearer ${data.session.access_token}`, ...(payload ? { "Content-Type": "application/json" } : {}) }, body: payload ? JSON.stringify(payload) : undefined });
    const body = await response.json().catch(() => null) as (T & { message?: string }) | null;
    if (!response.ok || !body) throw new Error(body?.message || "Nieprawidlowa odpowiedz serwera.");
    return body;
  }
  useEffect(() => {
    const check = new AbortController();
    void request<Connection>("status", check.signal).then(data => { if (!check.signal.aborted) setConnection(data); })
      .catch(error => { if (!check.signal.aborted) setError(error.message); })
      .finally(() => { if (!check.signal.aborted) setChecking(false); });
    return () => { check.abort(); controller.current?.abort(); };
  }, []);
  async function load() {
    if (busy || !connection?.allowed || !connection.connected) return;
    const active = new AbortController(); controller.current = active;
    setBusy(true); setError(""); setResult(null); setQuery("");
    try {
      const data = await request<OvokoReadResult>("read", active.signal, { useSaved: true, operation: "parts" });
      if (data.ok !== true || data.code !== "R200" || data.operation !== "parts" || data.readOnly !== true || !Array.isArray(data.rows) || !data.pagination || data.pagination.page !== 1 || data.pagination.limit !== 20) throw new Error("Nie potwierdzono odczytu rekordow czesci.");
      if (!active.signal.aborted) setResult(data);
    } catch (error) {
      if (!active.signal.aborted) setError(error instanceof Error ? error.message : "Blad odczytu Ovoko.");
    } finally { if (controller.current === active) { setBusy(false); controller.current = null; } }
  }
  const search = query.trim().toLocaleLowerCase("pl-PL");
  const rows = result?.rows.filter(row => [row.id, row.name, row.manufacturerCode, row.externalId].some(value => value?.toLocaleLowerCase("pl-PL").includes(search))) || [];
  return <section className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-3xl font-black">Ovoko - czesci</h1><p className="mt-2 text-sm leading-6 text-white/65">Oddzielny podglad rekordow czesci z API. Nie jest to lista potwierdzonych ofert widocznych w sprzedazy.</p></div><a href="/panel/ovoko" className={button}>Polaczenie Ovoko</a></div>
    <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-4 text-sm leading-6 text-emerald-100"><strong>Tylko odczyt, na razie dla administratora.</strong> Nie importujemy ani nie wystawiamy czesci. Nie zmieniamy cen, stanow, samochodow ani ofert. Nie ma powiazan z Allegro ani automatycznej synchronizacji.</div>
    <div className="grid gap-3 text-sm sm:grid-cols-3">
      <div className="rounded-xl border border-white/10 p-4"><h2 className="font-bold">Rekordy czesci</h2><p className="mt-2 text-white/65">Pierwsza strona API, maksymalnie 20 rekordow. Licznik nie oznacza liczby aktywnych ofert.</p></div>
      <div className="rounded-xl border border-white/10 p-4"><h2 className="font-bold">Sprzedaz na portalu</h2><p className="mt-2 text-amber-200">Widocznosc niepotwierdzona. Sama cena lub status magazynowy nie wystarczaja do jej potwierdzenia.</p></div>
      <div className="rounded-xl border border-white/10 p-4"><h2 className="font-bold">Dawcy i skladowanie</h2><p className="mt-2 text-white/65">Auto-dawca jest osobnym rekordem. Nie pobieramy tu listy aut ani miejsc skladowania.</p></div>
    </div>
    {checking && <p role="status">Sprawdzam zapisane polaczenie...</p>}
    {connection?.allowed && !connection.connected && <p role="status" className="rounded-xl border border-amber-400/30 p-4">Brak zapisanego polaczenia. Otworz Polaczenie Ovoko i polacz konto. Kluczy nie wpisujesz w tej liscie.</p>}
    {connection?.allowed && connection.connected && <div className="flex flex-wrap items-center gap-3"><button type="button" className={button} disabled={busy} onClick={() => void load()}>{busy ? "Pobieram rekordy..." : "Pobierz pierwsze 20 czesci"}</button><p className="text-sm text-white/55">Polaczenie zapisane. Brak pobierania w tle. Limit API: 3 odczyty/minute.</p></div>}
    {error && <div role="alert" className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-4"><p>{error}</p><p className="mt-2 text-sm">Blad odczytu nie oznacza pustego magazynu ani usuniecia ofert. Niczego nie zmieniono.</p></div>}
    {result && <>
      <p role="status" className="text-sm">Rekordow czesci wedlug API: <strong>{result.pagination!.total}</strong> (nie liczba ofert w sprzedazy). Pobrano: {result.rows.length}. Strona 1, limit 20.</p>
      <label className="block space-y-2 text-sm"><span>Filtruj tylko pobrane rekordy (nazwa, numer czesci lub ID)</span><input type="search" maxLength={100} value={query} onChange={event => setQuery(event.target.value)} className="w-full rounded-lg border border-white/20 bg-[#0d1117] px-3 py-2" /></label>
      <p className="text-xs text-white/55">Widoczne po filtrze: {rows.length} z {result.rows.length} pobranych. Filtr nie przeszukuje reszty magazynu.</p>
      <div className="overflow-x-auto rounded-2xl border border-white/10"><table className="w-full min-w-[740px] text-left text-sm" aria-label="Rekordy czesci Ovoko"><thead className="bg-white/5 text-white/70"><tr><th className="p-3">Czesc / ID Ovoko</th><th className="p-3">Cena API</th><th className="p-3">Status rekordu</th><th className="p-3">Widocznosc w sprzedazy</th><th className="p-3">Dawca / kategoria</th></tr></thead><tbody>{rows.map(row => <tr key={row.id} className="border-t border-white/10"><td className="p-3 align-top"><p className="font-bold">{row.name || "Brak nazwy"}</p><p className="mt-1 text-white/55">Czesc ID: {row.id}</p><p>Numer: {row.manufacturerCode || "brak"}</p><p className="break-all text-white/55">Zewnetrzne ID: {row.externalId || "brak"}</p></td><td className="p-3 align-top"><p>{row.price || "brak"}</p><p className="text-xs text-amber-200">Waluta niepotwierdzona</p></td><td className="p-3 align-top">Status ID: {row.status}<p className="text-white/55">Jakosc ID: {row.quality}</p></td><td className="p-3 align-top text-amber-200">Niepotwierdzona</td><td className="p-3 align-top">Samochod-dawca ID: {row.carId}<p>Kategoria ID: {row.categoryId}</p><p className="mt-1 text-xs text-white/55">Miejsce skladowania nieodczytane</p></td></tr>)}</tbody></table>
      {!result.rows.length ? <p className="p-6 text-center text-white/65">API zwrocilo 0 rekordow czesci. To nie jest wynik importu ani informacja o liczbie samochodow czy miejsc skladowania.</p> : !rows.length && <p className="p-6 text-center text-white/65">Brak dopasowan wsrod pobranych rekordow. Reszta magazynu nie zostala przeszukana.</p>}</div>
      <p className="text-xs text-white/45">Odczyt: {new Date(result.checkedAt).toLocaleString("pl-PL")}. To nie jest pelna kopia magazynu. Nie dopasowujemy czesci do Allegro po samym numerze katalogowym.</p>
    </>}
  </section>;
}
