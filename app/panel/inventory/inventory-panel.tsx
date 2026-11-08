"use client";

import { useEffect, useRef, useState } from "react";
import { allegroRequest } from "@/lib/allegro-client";

type Offer = { id: string; name: string; image: string; externalId: string; status: string; stock: number | null; shippingRateId: string | null; price: { amount: string; currency: string } | null };
type Inventory = { offers: Offer[]; totalCount: number; count: number; limit: number; offset: number; fetchedAt: string };
type Rate = { id: string; name: string };
const statuses: Record<string, string> = { ACTIVE: "Aktywna", ENDED: "Zakonczona", INACTIVE: "Nieaktywna", ACTIVATING: "Aktywowana" };
const initial = { query: "", searchBy: "name", status: "ACTIVE", shippingRate: "", sort: "", limit: "50" };
const field = "min-w-0 w-full rounded-lg border border-white/20 bg-[#0d1117] px-3 py-2 text-white";
const button = "rounded-lg border border-white/20 px-3 py-2 text-sm font-bold hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40";

export function InventoryPanel() {
  const [draft, setDraft] = useState(initial);
  const [filters, setFilters] = useState(initial);
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<Inventory | null>(null);
  const [rates, setRates] = useState<Rate[]>([]);
  const [ratesError, setRatesError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [jump, setJump] = useState("1");
  const requestId = useRef(0);
  useEffect(() => {
    const controller = new AbortController();
    setRatesError("");
    void allegroRequest<{ shippingRates: Rate[] }>("/shipping-rates", { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) {
        if (!Array.isArray(data.shippingRates)) throw new Error("Niepelna odpowiedz cennikow.");
        setRates(data.shippingRates);
      }
    }).catch(() => { if (!controller.signal.aborted) { setRates([]); setRatesError("Nie udalo sie pobrac nazw cennikow. Pokazujemy ich ID; odswiez liste, aby sprobowac ponownie."); } });
    return () => controller.abort();
  }, [revision]);
  useEffect(() => {
    const controller = new AbortController();
    const id = ++requestId.current;
    setBusy(true); setError(""); setResult(null); setSelected(new Set());
    setJump(String(Math.floor(offset / Number(filters.limit)) + 1));
    const query = new URLSearchParams({ ...filters, offset: String(offset) });
    void allegroRequest<Inventory>(`/inventory?${query}`, { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted && id === requestId.current) setResult(data);
    }).catch(error => { if (!controller.signal.aborted && id === requestId.current) setError(error.message); })
      .finally(() => { if (!controller.signal.aborted && id === requestId.current) setBusy(false); });
    return () => controller.abort();
  }, [filters, offset, revision]);
  const pageSize = Number(filters.limit);
  const page = Math.floor(offset / pageSize) + 1;
  const pages = result ? Math.max(1, Math.ceil(Math.min(result.totalCount, 10000000) / pageSize)) : 1;
  function toggle(id: string, checked: boolean) {
    setSelected(previous => { const next = new Set(previous); if (checked) next.add(id); else next.delete(id); return next; });
  }
  function rateName(id: string | null) { return !id ? "Brak cennika" : rates.find(rate => rate.id === id)?.name || `ID: ${id}`; }
  return <section className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><h1 className="text-3xl font-black">Moje oferty</h1><p className="mt-2 text-sm leading-6 text-white/65">Oferty polaczonego konta Allegro. To osobna lista, nie kolejka przygotowywanych aukcji.</p></div>
      <a href="/panel/allegro" className={button}>Polaczenie Allegro</a>
    </div>
    <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-4 text-sm leading-6 text-emerald-100"><strong>Tylko podglad.</strong> Nie zmieniamy cen, stanow ani nie konczymy ofert. Ovoko nie jest jeszcze podlaczone. Zaznaczenia sa robocze i znikaja po zmianie strony lub odswiezeniu.</div>
    <form onSubmit={event => { event.preventDefault(); setOffset(0); setFilters({ ...draft, query: draft.query.trim() }); }} className="grid gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 sm:grid-cols-2 xl:grid-cols-3">
      <label className="space-y-1 text-sm sm:col-span-2"><span>Szukaj ofert</span><input className={field} maxLength={100} value={draft.query} onChange={event => setDraft({ ...draft, query: event.target.value })} placeholder="Tytul lub numer wystepujacy w tytule" /></label>
      <label className="space-y-1 text-sm"><span>Szukaj wedlug</span><select className={field} value={draft.searchBy} onChange={event => setDraft({ ...draft, searchBy: event.target.value })}><option value="name">Tytul / numer czesci w tytule</option><option value="offerId">Numer oferty Allegro</option><option value="externalId">Identyfikator zewnetrzny</option></select></label>
      <label className="space-y-1 text-sm"><span>Status</span><select className={field} value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value })}><option value="">Wszystkie</option>{Object.entries(statuses).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <label className="space-y-1 text-sm"><span>Cennik wysylki Allegro</span><select className={field} value={draft.shippingRate} onChange={event => setDraft({ ...draft, shippingRate: event.target.value })}><option value="">Wszystkie cenniki</option><option value="none">Bez cennika</option>{rates.map(rate => <option key={rate.id} value={rate.id}>{rate.name}</option>)}</select></label>
      <label className="space-y-1 text-sm"><span>Sortowanie</span><select className={field} value={draft.sort} onChange={event => setDraft({ ...draft, sort: event.target.value })}><option value="">Najnowsze</option><option value="sellingMode.price.amount">Cena rosnaco</option><option value="-sellingMode.price.amount">Cena malejaco</option><option value="stock.available">Liczba sztuk rosnaco</option><option value="-stock.available">Liczba sztuk malejaco</option></select></label>
      <label className="space-y-1 text-sm"><span>Ofert na stronie</span><select className={field} value={draft.limit} onChange={event => setDraft({ ...draft, limit: event.target.value })}>{[20, 50, 100].map(size => <option key={size} value={size}>{size}</option>)}</select></label>
      <div className="flex flex-wrap items-end gap-2 sm:col-span-2"><button className="rounded-lg bg-[#ff5a00] px-4 py-2 font-bold" type="submit">Pokaz oferty</button><button className={button} type="button" disabled={busy} onClick={() => setRevision(value => value + 1)}>Odswiez</button><button className={button} type="button" onClick={() => { setDraft(initial); setFilters({ ...initial }); setOffset(0); }}>Wyczysc filtry</button></div>
    </form>
    {ratesError && <p role="status" className="text-sm text-amber-200">{ratesError}</p>}
    {error && <div role="alert" className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-4"><p>{error}</p><p className="mt-2 text-sm">To blad odczytu, nie informacja o usunieciu ofert. Niczego nie zmieniono.</p><button className={`${button} mt-3`} onClick={() => setRevision(value => value + 1)}>Sprobuj ponownie</button> <a href="/panel/allegro" className="text-sm underline">Sprawdz polaczenie</a></div>}
    {busy && <p role="status" className="py-8 text-center text-white/65">Pobieram jedna strone ofert z Allegro...</p>}
    {result && <>
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm"><p><strong>{result.totalCount.toLocaleString("pl-PL")}</strong> ofert wedlug zastosowanych filtrow. Zaznaczono na tej stronie: <strong>{selected.size}</strong>.</p><button className={button} disabled={!selected.size} onClick={() => setSelected(new Set())}>Odznacz</button></div>
      <div className="overflow-x-auto rounded-2xl border border-white/10" aria-busy={busy}>
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-white/5 text-white/70"><tr><th className="p-3"><input type="checkbox" aria-label="Zaznacz widoczna strone" disabled={!result.offers.length} checked={!!result.offers.length && selected.size === result.offers.length} onChange={event => setSelected(event.target.checked ? new Set(result.offers.map(offer => offer.id)) : new Set())} /></th><th className="p-3">Oferta</th><th className="p-3">Cena</th><th className="p-3">Szt.</th><th className="p-3">Status</th><th className="p-3">Cennik wysylki</th></tr></thead>
          <tbody>{result.offers.map((offer, index) => <tr key={offer.id} className={`border-t border-white/10 ${selected.has(offer.id) ? "bg-orange-500/10" : ""}`}>
            <td className="p-3 align-top"><label className="flex flex-col items-center gap-2"><span className="text-xs text-white/50">{offset + index + 1}</span><input type="checkbox" aria-label={`Zaznacz oferte ${offer.id}`} checked={selected.has(offer.id)} onChange={event => toggle(offer.id, event.target.checked)} /></label></td>
            <td className="p-3 align-top"><div className="flex gap-3">{offer.image ? <img src={offer.image} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-16 w-16 shrink-0 rounded-lg bg-white/5 object-contain" /> : <span className="grid h-16 w-16 shrink-0 place-items-center rounded-lg bg-white/5 text-xs text-white/45">Brak zdjecia</span>}<div className="min-w-0 max-w-sm"><a href={`https://allegro.pl/oferta/${offer.id}`} target="_blank" rel="noopener noreferrer" className="font-bold text-white hover:text-[#ff8a3d]">{offer.name || "Oferta bez tytulu"}</a><p className="mt-1 text-xs text-white/50">Allegro: {offer.id}</p>{offer.externalId && <p className="mt-1 break-all text-xs text-white/50">ID zewnetrzne: {offer.externalId}</p>}</div></div></td>
            <td className="whitespace-nowrap p-3 align-top font-bold">{offer.price ? `${Number(offer.price.amount).toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${offer.price.currency}` : "Brak danych"}</td>
            <td className="p-3 align-top">{offer.stock ?? "Brak danych"}</td><td className="p-3 align-top"><span className={offer.status === "ACTIVE" ? "text-emerald-300" : "text-white/60"}>{statuses[offer.status] || offer.status}</span></td><td className="max-w-48 break-words p-3 align-top text-white/75">{rateName(offer.shippingRateId)}</td>
          </tr>)}</tbody>
        </table>
        {!result.offers.length && <p className="p-8 text-center text-white/60">Brak ofert na tej stronie. Zmien filtry lub wroc na pierwsza strone.</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button className={button} disabled={!offset} onClick={() => setOffset(0)}>Pierwsza</button><button className={button} disabled={!offset} onClick={() => setOffset(Math.max(0, offset - pageSize))}>Poprzednia</button><span className="px-2">Strona {page} z {pages}</span><button className={button} disabled={offset + pageSize >= Math.min(result.totalCount, 10000000)} onClick={() => setOffset(offset + pageSize)}>Nastepna</button>
        <form className="flex items-center gap-2" onSubmit={event => { event.preventDefault(); const number = Number(jump); if (Number.isInteger(number) && number >= 1 && number <= pages) setOffset((number - 1) * pageSize); }}><label className="sr-only" htmlFor="inventory-page">Numer strony</label><input id="inventory-page" className={`${field} !w-24`} type="number" min={1} max={pages} required value={jump} onChange={event => setJump(event.target.value)} /><button className={button}>Przejdz</button></form>
      </div>
      <p className="text-xs leading-5 text-white/45">Odczyt: {new Date(result.fetchedAt).toLocaleString("pl-PL")}. Lista nie odswieza sie w tle. Zmiany na Allegro moga przesuwac wyniki miedzy stronami. ID zewnetrzne nie musi byc numerem czesci ani numerem magazynowym.</p>
    </>}
  </section>;
}
