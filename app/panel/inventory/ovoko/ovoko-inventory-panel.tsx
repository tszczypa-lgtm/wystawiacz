"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import type { OvokoReadResult, OvokoReadRow } from "@/lib/ovoko-read";

const button = "rounded-lg border border-white/20 px-3 py-2 text-sm font-bold hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40";
const field = "min-w-0 w-full rounded-lg border border-white/20 bg-[#0d1117] px-3 py-2 text-white";
const initial = { query: "", searchBy: "search", sort: "newest", limit: "50" };
type Connection = { allowed: boolean; connected: boolean };
async function request<T>(path: string, signal: AbortSignal, payload?: unknown): Promise<T> {
  const { data } = await createSupabaseBrowserClient().auth.getSession();
  if (!data.session) throw new Error("Zaloguj sie ponownie.");
  const response = await fetch(`/api/ovoko/${path}`, { method: payload ? "POST" : "GET", signal, cache: "no-store", headers: { Authorization: `Bearer ${data.session.access_token}`, ...(payload ? { "Content-Type": "application/json" } : {}) }, body: payload ? JSON.stringify(payload) : undefined });
  const body = await response.json().catch(() => null) as (T & { message?: string }) | null;
  if (!response.ok || !body) throw new Error(body?.message || "Nieprawidlowa odpowiedz serwera.");
  return body;
}
export function OvokoInventoryPanel() {
  const [connection, setConnection] = useState<Connection | null>(null), [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [result, setResult] = useState<OvokoReadResult | null>(null);
  const [draft, setDraft] = useState(initial), [filters, setFilters] = useState(initial);
  const [page, setPage] = useState(1), [jump, setJump] = useState("1"), [revision, setRevision] = useState(0);
  const [status, setStatus] = useState(""), [quality, setQuality] = useState(""), [category, setCategory] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dictionaries, setDictionaries] = useState<Record<string, OvokoReadRow[]>>({}), [dictionaryError, setDictionaryError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void request<Connection>("status", controller.signal).then(data => { if (!controller.signal.aborted) setConnection(data); })
      .catch(error => { if (!controller.signal.aborted) setError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setChecking(false); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!connection?.allowed || !connection.connected) return;
    const controller = new AbortController();
    void (async () => {
      try {
        for (const operation of ["statuses", "qualities", "categories"]) {
          const data = await request<OvokoReadResult>("read", controller.signal, { useSaved: true, operation });
          if (data.ok !== true || data.readOnly !== true || data.operation !== operation || !Array.isArray(data.rows)) throw new Error("Niepelny slownik Ovoko.");
          if (!controller.signal.aborted) setDictionaries(previous => ({ ...previous, [operation]: data.rows }));
        }
      } catch { if (!controller.signal.aborted) setDictionaryError("Nie odczytano wszystkich nazw ze slownikow. Pokazujemy dostepne nazwy lub ID; lista czesci pozostaje niezalezna."); }
    })();
    return () => controller.abort();
  }, [connection]);
  useEffect(() => {
    if (!connection?.allowed || !connection.connected) return;
    const controller = new AbortController();
    setBusy(true); setError(""); setResult(null); setSelected(new Set()); setJump(String(page));
    void request<OvokoReadResult>("read", controller.signal, { useSaved: true, operation: "inventory", page, limit: Number(filters.limit), sort: filters.sort, ...(filters.searchBy === "externalId" ? { externalId: filters.query } : { search: filters.query }) }).then(data => {
      if (data.ok !== true || data.code !== "R200" || data.operation !== "inventory" || data.readOnly !== true || !Array.isArray(data.rows) || !data.pagination || data.pagination.page !== page || data.pagination.limit !== Number(filters.limit) || !Number.isSafeInteger(data.pagination.total) || data.pagination.total < 0) throw new Error("Nie potwierdzono odczytu listy czesci Ovoko.");
      if (!controller.signal.aborted) setResult(data);
    }).catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Blad odczytu Ovoko."); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [connection, filters, page, revision]);
  const rows = result?.rows.filter(row => (!status || row.status === status) && (!quality || row.quality === quality) && (!category || row.categoryId === category)) || [];
  const pages = result ? Math.max(1, Math.ceil(result.pagination!.total / Number(filters.limit))) : 1;
  const label = (operation: string, id?: string) => dictionaries[operation]?.find(row => row.id === id)?.name || `ID ${id ?? "brak"}`;
  function toggle(id: string, checked: boolean) { setSelected(previous => { const next = new Set(previous); if (checked) next.add(id); else next.delete(id); return next; }); }
  function localFilterOptions(operation: string, ids: (string | undefined)[]) {
    const active = operation === "statuses" ? status : operation === "qualities" ? quality : category;
    return [...new Set([...ids, active || undefined].filter((id): id is string => id !== undefined))].map(id => <option key={id} value={id}>{label(operation, id)}</option>);
  }
  return <section className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-3xl font-black">Ovoko - czesci</h1><p className="mt-2 text-sm leading-6 text-white/65">Lista czesci polaczonego konta Ovoko, oddzielna od Allegro.</p></div><a href="/panel/ovoko" className={button}>Polaczenie Ovoko</a></div>
    <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-4 text-sm leading-6 text-emerald-100"><strong>Tylko odczyt, dla administratora.</strong> Nie zmieniamy cen, stanow ani ofert. Status Na stanie nie potwierdza widocznosci w sklepie. Samochody i miejsca skladowania nie sa czesciami i nie trafiaja do tej listy.</div>
    {checking && <p role="status">Sprawdzam zapisane polaczenie...</p>}
    {connection?.allowed && !connection.connected && <p role="status" className="rounded-xl border border-amber-400/30 p-4">Brak zapisanego polaczenia. Otworz Polaczenie Ovoko i polacz konto.</p>}
    {connection?.allowed && connection.connected && <form onSubmit={event => { event.preventDefault(); setPage(1); setSelected(new Set()); setFilters({ ...draft, query: draft.query.trim() }); }} className="grid gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 sm:grid-cols-2 xl:grid-cols-3">
      <label className="space-y-1 text-sm sm:col-span-2"><span>Szukaj czesci Ovoko</span><input type="search" className={field} maxLength={100} value={draft.query} onChange={event => setDraft({ ...draft, query: event.target.value })} placeholder="Nazwa lub numer czesci" /></label>
      <label className="space-y-1 text-sm"><span>Szukaj wedlug</span><select aria-label="Szukaj wedlug" className={field} value={draft.searchBy} onChange={event => setDraft({ ...draft, searchBy: event.target.value })}><option value="search">Nazwa / numer czesci</option><option value="externalId">Dokladne ID zewnetrzne</option></select></label>
      <label className="space-y-1 text-sm"><span>Sortowanie</span><select aria-label="Sortowanie" className={field} value={draft.sort} onChange={event => setDraft({ ...draft, sort: event.target.value })}><option value="newest">ID malejaco (najnowsze)</option><option value="oldest">ID rosnaco (najstarsze)</option></select></label>
      <label className="space-y-1 text-sm"><span>Czesci na stronie</span><select aria-label="Czesci na stronie" className={field} value={draft.limit} onChange={event => setDraft({ ...draft, limit: event.target.value })}>{[20, 50, 100].map(size => <option key={size} value={size}>{size}</option>)}</select></label>
      <div className="flex flex-wrap items-end gap-2"><button className="rounded-lg bg-[#ff5a00] px-4 py-2 font-bold" type="submit" disabled={busy}>Pokaz czesci</button><button className={button} type="button" disabled={busy} onClick={() => setRevision(value => value + 1)}>Odswiez</button><button className={button} type="button" disabled={busy} onClick={() => { setDraft(initial); setFilters({ ...initial }); setPage(1); setStatus(""); setQuality(""); setCategory(""); }}>Wyczysc filtry</button></div>
      <p className="text-xs leading-5 text-white/55 sm:col-span-2 xl:col-span-3">Wyszukiwanie i sortowanie obejmuje cale konto przez API. Ponizsze filtry statusu, jakosci i kategorii dotycza tylko biezacej strony, nie zmieniaja licznika API.</p>
      <label className="space-y-1 text-sm"><span>Status (na stronie)</span><select aria-label="Status (na stronie)" className={field} value={status} onChange={event => { setStatus(event.target.value); setSelected(new Set()); }}><option value="">Wszystkie</option>{localFilterOptions("statuses", result?.rows.map(row => row.status) || [])}</select></label>
      <label className="space-y-1 text-sm"><span>Jakosc (na stronie)</span><select aria-label="Jakosc (na stronie)" className={field} value={quality} onChange={event => { setQuality(event.target.value); setSelected(new Set()); }}><option value="">Wszystkie</option>{localFilterOptions("qualities", result?.rows.map(row => row.quality) || [])}</select></label>
      <label className="space-y-1 text-sm"><span>Kategoria (na stronie)</span><select aria-label="Kategoria (na stronie)" className={field} value={category} onChange={event => { setCategory(event.target.value); setSelected(new Set()); }}><option value="">Wszystkie</option>{localFilterOptions("categories", result?.rows.map(row => row.categoryId) || [])}</select></label>
    </form>}
    {dictionaryError && <p role="status" className="text-sm text-amber-200">{dictionaryError}</p>}
    {error && <div role="alert" className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-4"><p>{error}</p><p className="mt-2 text-sm">Blad odczytu nie oznacza pustego magazynu ani usuniecia ofert. Niczego nie zmieniono.</p>{connection?.connected && <button className={`${button} mt-3`} disabled={busy} onClick={() => setRevision(value => value + 1)}>Sprobuj ponownie</button>}</div>}
    {busy && <p role="status" className="py-8 text-center text-white/65">Pobieram strone czesci z Ovoko...</p>}
    {result && <>
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm"><p>Rekordow czesci wedlug API: <strong>{result.pagination!.total.toLocaleString("pl-PL")}</strong>. Widoczne na stronie: {rows.length} z {result.rows.length}. Zaznaczono: {selected.size}.</p><button className={button} disabled={!selected.size} onClick={() => setSelected(new Set())}>Odznacz</button></div>
      <div className="overflow-x-auto rounded-2xl border border-white/10"><table className="w-full min-w-[740px] text-left text-sm" aria-label="Rekordy czesci Ovoko"><thead className="bg-white/5 text-white/70"><tr><th className="p-3"><input type="checkbox" aria-label="Zaznacz widoczna strone Ovoko" checked={!!rows.length && rows.every(row => selected.has(row.id))} disabled={!rows.length} onChange={event => setSelected(event.target.checked ? new Set(rows.map(row => row.id)) : new Set())} /></th><th className="p-3">Czesc / numer</th><th className="p-3">Cena API</th><th className="p-3">Status / jakosc</th><th className="p-3">Kategoria / auto</th></tr></thead><tbody>{rows.map((row, index) => <tr key={row.id} className={`border-t border-white/10 ${selected.has(row.id) ? "bg-orange-500/10" : ""}`}>
        <td className="p-3 align-top"><label className="flex flex-col items-center gap-2"><span className="text-xs text-white/50">{(page - 1) * Number(filters.limit) + index + 1}</span><input type="checkbox" aria-label={`Zaznacz czesc ${row.id}`} checked={selected.has(row.id)} onChange={event => toggle(row.id, event.target.checked)} /></label></td>
        <td className="p-3 align-top"><div className="flex gap-3">{row.image ? <img src={row.image} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-16 w-16 shrink-0 rounded-lg bg-white/5 object-contain" /> : <span className="grid h-16 w-16 shrink-0 place-items-center rounded-lg bg-white/5 text-xs text-white/45">Brak zdjecia</span>}<div className="min-w-0 max-w-sm"><p className="font-bold">{row.name || "Brak nazwy"}</p><p className="mt-1">Numer: {row.manufacturerCode || "brak"}</p><p className="mt-1 text-xs text-white/55">Ovoko ID: {row.id}</p>{row.externalId && <p className="mt-1 break-all text-xs text-white/55">ID zewnetrzne: {row.externalId}</p>}</div></div></td>
        <td className="whitespace-nowrap p-3 align-top"><p className="font-bold">{row.price || "brak"}</p><p className="text-xs text-amber-200">Waluta niepotwierdzona</p></td><td className="p-3 align-top"><p>{label("statuses", row.status)}</p><p className="text-white/55">{label("qualities", row.quality)}</p></td><td className="p-3 align-top"><p>{label("categories", row.categoryId)}</p><p className="mt-1 text-xs text-white/55">Samochod-dawca ID: {row.carId}</p></td>
      </tr>)}</tbody></table>
      {!result.rows.length ? <p className="p-6 text-center text-white/65">Brak czesci na tej stronie dla wybranego wyszukiwania. Zmien filtry lub wroc na pierwsza strone.</p> : !rows.length && <p className="p-6 text-center text-white/65">Brak dopasowan na biezacej stronie. Wyczysc filtry strony lub przejdz dalej.</p>}</div>
      <div className="flex flex-wrap items-center gap-2 text-sm"><button className={button} disabled={busy || page === 1} onClick={() => setPage(1)}>Pierwsza</button><button className={button} disabled={busy || page === 1} onClick={() => setPage(value => value - 1)}>Poprzednia</button><span className="px-2">Strona {page} z {pages}</span><button className={button} disabled={busy || page >= pages} onClick={() => setPage(value => value + 1)}>Nastepna</button><form className="flex items-center gap-2" onSubmit={event => { event.preventDefault(); const value = Number(jump); if (Number.isSafeInteger(value) && value >= 1 && value <= pages && value <= 1000000) setPage(value); }}><label className="sr-only" htmlFor="ovoko-page">Numer strony Ovoko</label><input id="ovoko-page" className={`${field} !w-24`} type="number" min={1} max={Math.min(pages, 1000000)} required value={jump} onChange={event => setJump(event.target.value)} /><button className={button} disabled={busy}>Przejdz</button></form></div>
      <p className="text-xs leading-5 text-white/45">Odczyt: {new Date(result.checkedAt).toLocaleString("pl-PL")}. Jedna strona na zadanie; bez pobierania calego magazynu w tle. Zaznaczenia sa robocze, niczego nie usuwaja. Licznik czesci nie jest potwierdzona liczba aktywnych ofert.</p>
    </>}
  </section>;
}
