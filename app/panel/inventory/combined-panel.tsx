"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { combineInventory, emptyCombinedSnapshot, filterCombinedInventory, sortCombinedInventory, inventoryChannel, inventoryChannels, ovokoInStock, type InventoryChannel, type CombinedFilter, type CombinedPart, type CombinedSnapshot } from "@/lib/combined-inventory";
import { loadCombinedInventory } from "@/lib/combined-inventory-client";
import { suggestPartNumbers } from "@/lib/ovoko-suggestions";
import { OvokoBulkLauncher } from "./ovoko-bulk-launcher";
import { ManualWithdrawal } from "./manual-withdrawal";
import { BulkInventoryActions } from "./bulk-inventory-actions";
import { ManualOvokoLauncher } from "./manual-ovoko-launcher";

const initial: CombinedFilter = { allegro: true, ovoko: true, coverage: "all", query: "", priceFrom: "", priceTo: "", allStatuses: false, transfer: "all", lifecycle: "available" };
const field = "h-7 min-w-0 rounded border border-white/15 bg-[#0d1117] px-2 text-xs";
const button = "rounded border border-white/15 px-2 py-1 text-xs hover:bg-white/10 disabled:opacity-40";
export function CombinedInventoryPanel({ portal }: { portal?: "ovoko" }) {
  const [filter, setFilter] = useState({ ...initial, ...(portal ? { allegro: false } : {}) });
  const [snapshot, setSnapshot] = useState<CombinedSnapshot>(emptyCombinedSnapshot);
  const [busy, setBusy] = useState(true), [progress, setProgress] = useState("Pobieram czesci..."), [error, setError] = useState("");
  const [page, setPage] = useState(1), [limit, setLimit] = useState(100), [sort, setSort] = useState("source"), [selected, setSelected] = useState(new Set<string>());
  const [request, setRequest] = useState({ revision: 0, more: false });
  const current = useRef(snapshot);
  useEffect(() => { current.current = snapshot; }, [snapshot]);
  useEffect(() => {
    const controller = new AbortController();
    const previous = request.more ? current.current : undefined;
    void loadCombinedInventory(previous, controller.signal, setProgress, { force: request.revision > 0 && !request.more, partial: value => { if (!controller.signal.aborted) setSnapshot(value); } }).then(value => { if (!controller.signal.aborted) setSnapshot(value); }).catch(error => { if (!controller.signal.aborted) { setSnapshot(emptyCombinedSnapshot()); setError(error.message); } }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [request]);
  const parts = useMemo(() => combineInventory(snapshot), [snapshot]);
  const { rows, filterError } = useMemo(() => {
    try { return { rows: sortCombinedInventory(filterCombinedInventory(parts, filter, snapshot), sort), filterError: "" }; }
    catch (error) { return { rows: [] as CombinedPart[], filterError: (error as Error).message }; }
  }, [parts, filter, snapshot, sort]);
  const pages = Math.max(1, Math.ceil(rows.length / limit)), actualPage = Math.min(page, pages), visible = rows.slice((actualPage - 1) * limit, actualPage * limit);
  function change(patch: Partial<CombinedFilter>) { setFilter(value => ({ ...value, ...patch })); setPage(1); setSelected(new Set()); }
  function reload(more = false) {
    setBusy(true); setError(""); setSelected(new Set()); setPage(1);
    if (!more) setSnapshot(emptyCombinedSnapshot());
    setRequest(value => ({ revision: value.revision + 1, more }));
  }
  const refresh = () => reload();
  const complete = snapshot.allegroComplete && (!snapshot.admin || snapshot.ovokoComplete);
  const selectedRows = visible.filter(row => selected.has(row.key) && !row.conflict);
  const selectedOffers = selectedRows.flatMap(row => row.allegro?.status === "ACTIVE" ? [row.allegro] : []);
  return <section className="space-y-2" aria-label="Wspolna lista czesci">
    <div role="tablist" aria-label="Stan czesci" className="flex gap-1 border-b border-white/15 text-xs">{[["available", "Aktywne"], ["ended", "Zakonczone"], ["sold", "Sprzedane"]].map(([value, label]) => <button key={value} role="tab" aria-selected={filter.lifecycle === value} className={`px-3 py-1.5 ${filter.lifecycle === value ? "border-b-2 border-orange-500 text-orange-300" : "text-white/60"}`} onClick={() => change({ lifecycle: value as CombinedFilter["lifecycle"], allStatuses: value !== "available" })}>{label}</button>)}</div>
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-1.5 rounded border border-white/15 bg-[#11161d] p-2 text-xs" aria-label="Filtry czesci">
      <strong className="mr-1 text-sm">Moje czesci</strong>
      <select aria-label="Kanal sprzedazy" className={`${field} w-44`} value={inventoryChannel(filter)} onChange={event => change(inventoryChannels[event.target.value as InventoryChannel])}><option value="all">Wszystkie kanaly</option><option value="allegro">Allegro (takze na obu)</option><option value="ovoko">Ovoko (takze na obu)</option><option value="both">Na obu portalach</option><option value="only_allegro">Tylko Allegro</option><option value="only_ovoko">Tylko Ovoko</option></select>
      <input aria-label="Szukaj czesci" className={`${field} w-40 grow`} value={filter.query} onChange={event => change({ query: event.target.value })} placeholder="Tytul, numer czesci, ID..." maxLength={100} />
      <input aria-label="Cena Allegro od" title="Cena Allegro od (waluta oferty)" className={`${field} w-20`} inputMode="decimal" value={filter.priceFrom} onChange={event => change({ priceFrom: event.target.value })} placeholder="Cena A od" />
      <input aria-label="Cena Allegro do" title="Cena Allegro do (waluta oferty)" className={`${field} w-20`} inputMode="decimal" value={filter.priceTo} onChange={event => change({ priceTo: event.target.value })} placeholder="Cena A do" />
      <select aria-label="Czesci na stronie" className={field} value={limit} onChange={event => { setLimit(Number(event.target.value)); setPage(1); setSelected(new Set()); }}>{[20, 50, 100, 200].map(value => <option key={value} value={value}>{value} / str.</option>)}</select>
      <button className={button} disabled={busy} onClick={refresh}>Odswiez</button>
      <button className={button} onClick={() => change(initial)}>Wyczysc</button>
      <details className="relative"><summary className={`${button} cursor-pointer`}>Wiecej</summary>
        <div className="absolute right-0 z-20 mt-1 w-72 space-y-2 rounded border border-white/20 bg-[#11161d] p-3">
          <label className="block">Sortowanie<select aria-label="Sortowanie czesci" className={`${field} mt-1 w-full`} value={sort} onChange={event => { setSort(event.target.value); setPage(1); setSelected(new Set()); }}><option value="source">Kolejnosc API</option><option value="price">Cena A rosnaco</option><option value="-price">Cena A malejaco</option><option value="ovoko_price">Cena O rosnaco</option><option value="-ovoko_price">Cena O malejaco</option><option value="-age">Najnowsze (ID, osobno portale)</option><option value="age">Najstarsze (ID, osobno portale)</option><option value="name">Nazwa A–Z</option><option value="-name">Nazwa Z–A</option></select></label>
          {snapshot.admin && <label className="block">Historia przeniesienia do Ovoko<select aria-label="Historia przeniesienia do Ovoko" className={`${field} mt-1 w-full`} value={filter.transfer} onChange={event => change({ transfer: event.target.value })}><option value="all">Wszystkie</option><option value="not_transferred">Nieprzeniesione</option><option value="transferred">Przeniesione</option><option value="sending">W trakcie</option><option value="uncertain">Blad / do sprawdzenia</option></select></label>}
          <p>Zakres cen: Allegro. Sortowanie A/O osobno, bez przewalutowania; waluta Ovoko niepotwierdzona. Wiek wedlug ID wewnatrz portalu, nie data wznowienia. Brak ceny zawsze na koncu.</p>
          <p>Ovoko: status Na stanie z API nie potwierdza widocznosci w sklepie. Historia przeniesienia nie jest dowodem obecnosci.</p>
          <p>Odczyt do 2000 rekordow kazdego portalu w partii. Dalsze rekordy: Wczytaj dalsze czesci. Filtry dotycza wczytanych danych.</p>
          <a href="/panel/allegro" className="mr-3 underline">Polaczenie Allegro</a><a href="/panel/ovoko" className="underline">Polaczenie Ovoko</a>
        </div>
      </details>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-white/65"><span>Widoczne: <b>{rows.length}</b> / wczytane: {parts.length}. Allegro {snapshot.allegro.length}/{snapshot.allegroTotal}, Ovoko {snapshot.ovoko.length}/{snapshot.ovokoTotal}. Zaznaczono: {selected.size}. {!complete && <span className="text-amber-200">Odczyt niepelny; brak rekordu nie oznacza nieobecnosci.</span>}</span>{snapshot.admin && <div className="flex flex-wrap items-center gap-2 [&_button]:!px-2 [&_button]:!py-1 [&_button]:!text-xs"><BulkInventoryActions rows={selectedRows} onFinished={refresh} /><OvokoBulkLauncher offers={selectedOffers} onFinished={refresh} /></div>}</div>
    <p role="status" className="text-xs text-white/65">{busy ? progress : "Lista moze pochodzic z pamieci (do 5 minut). Odswiez pobiera aktualne stany."} Operacje zawsze sprawdzaja stany na portalach ponownie.</p>
    {(error || filterError) && <p role="alert" className="text-xs text-amber-200">{error || filterError}</p>}
    {snapshot.errors.map(message => <p role="status" className="text-xs text-amber-200" key={message}>{message} Nie uznajemy bledu za pusta liste.</p>)}
    {!busy && !complete && <button className={button} onClick={() => reload(true)}>Wczytaj dalsze czesci</button>}
    <div className="overflow-x-auto rounded border border-white/10"><table className="w-full min-w-[780px] table-fixed text-left text-xs" aria-label="Czesci Allegro i Ovoko"><thead className="bg-white/5 text-[11px] text-white/65"><tr><th className="w-8 p-1"><input type="checkbox" aria-label="Zaznacz widoczna strone" checked={!!visible.filter(row => !row.conflict).length && visible.filter(row => !row.conflict).every(row => selected.has(row.key))} onChange={event => setSelected(event.target.checked ? new Set(visible.filter(row => !row.conflict).map(row => row.key)) : new Set())} /></th><th className="w-10 p-1">Foto</th><th className="p-1">Czesc / numer</th><th className="w-40 p-1">Portale</th><th className="w-28 p-1">Cena Allegro</th><th className="w-28 p-1">Cena Ovoko*</th><th className="w-9 p-1">Szt.</th><th className="w-20 p-1">Opcje</th></tr></thead><tbody>{visible.map(row => <PartRow key={row.key} row={row} snapshot={snapshot} selected={selected.has(row.key)} onSelect={checked => setSelected(value => { const next = new Set(value); if (checked) next.add(row.key); else next.delete(row.key); return next; })} />)}</tbody></table>{!busy && !visible.length && <p className="p-4 text-center text-xs text-white/60">Brak pasujacych czesci w odczytanych danych. Sprawdz filtry lub komunikaty odczytu.</p>}</div>
    <div className="flex flex-wrap items-center gap-2 text-xs"><button className={button} disabled={busy || actualPage === 1} onClick={() => { setPage(1); setSelected(new Set()); }}>Pierwsza</button><button className={button} disabled={busy || actualPage === 1} onClick={() => { setPage(actualPage - 1); setSelected(new Set()); }}>Poprzednia</button><span>Strona {actualPage} / {pages}</span><button className={button} disabled={busy || actualPage >= pages} onClick={() => { setPage(actualPage + 1); setSelected(new Set()); }}>Nastepna</button><span className="ml-auto text-[10px] text-white/40">* Waluta Ovoko niepotwierdzona. Odczyt {snapshot.checkedAt ? new Date(snapshot.checkedAt).toLocaleTimeString("pl-PL") : "w toku"}. Bez synchronizacji stanow.</span></div>
  </section>;
}
function PartRow({ row, snapshot, selected, onSelect }: { row: CombinedPart; snapshot: CombinedSnapshot; selected: boolean; onSelect: (checked: boolean) => void }) {
  const a = row.allegro, o = row.ovoko, number = o?.manufacturerCode || (a ? suggestPartNumbers(a.name)[0]?.number : "") || "";
  const aActive = a?.status === "ACTIVE", oStock = ovokoInStock(o, snapshot.statuses);
  return <tr className={`border-t border-white/10 ${selected ? "bg-orange-500/10" : "hover:bg-white/[.025]"}`} data-part-key={row.key}>
    <td className="p-1 align-middle"><input type="checkbox" aria-label={`Zaznacz czesc ${row.key}`} checked={selected} disabled={row.conflict} onChange={event => onSelect(event.target.checked)} /></td>
    <td className="p-1">{row.image ? <img src={row.image} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-8 w-8 rounded object-contain" /> : <span className="text-[10px] text-white/30">Brak</span>}</td>
    <td className="px-1 py-1"><div className="truncate font-medium" title={row.name}>{a ? <a href={`https://allegro.pl/oferta/${a.id}`} target="_blank" rel="noopener noreferrer" className="hover:text-orange-300">{row.name}</a> : row.name || "Czesc Ovoko"}</div><div className="truncate text-[10px] text-white/45" title={`Numer: ${number || "brak"}; Allegro: ${a?.id || "brak"}; Ovoko: ${o?.id || "brak"}`}><span className="text-white/70">{number || "Bez numeru"}</span>{a && ` · A: ${a.id}`}{o && ` · O: ${o.id}`}{row.conflict && <span className="text-amber-200"> · Niejednoznaczne powiazanie, nie scalono</span>}</div></td>
    <td className="p-1"><div className="flex flex-nowrap gap-1"><span aria-label={`Allegro: ${a ? aActive ? "aktywna" : a.status : snapshot.allegroComplete ? "brak" : "nieustalone"}`} className={`max-w-[76px] shrink-0 truncate rounded px-1 py-0.5 text-[10px] ${aActive ? "bg-orange-500/15 text-orange-300" : "bg-white/5 text-white/40"}`} title={a ? `Oferta Allegro ${a.id}: ${a.status}` : "Brak w odczytanych danych"}>Allegro {a ? aActive ? "aktywna" : a.status : snapshot.allegroComplete ? "—" : "?"}</span><span aria-label={`Ovoko: ${o ? oStock ? "na stanie" : snapshot.statuses[o.status || ""] || "status nieustalony" : snapshot.ovokoComplete ? "brak" : "nieustalone"}`} className={`max-w-[72px] shrink-0 truncate rounded px-1 py-0.5 text-[10px] ${oStock ? "bg-cyan-500/15 text-cyan-300" : "bg-white/5 text-white/40"}`} title={o ? `Rekord Ovoko ${o.id}. ${snapshot.statuses[o.status || ""] || "Status nieustalony"}. Widocznosc w sklepie niepotwierdzona.` : "Brak w odczytanych danych; historia transferu nie potwierdza obecnosci"}>Ovoko {o ? oStock ? "na stanie" : snapshot.statuses[o.status || ""] || "?" : snapshot.ovokoComplete ? "—" : "?"}</span></div></td>
    <td className="p-1 font-medium">{a?.price ? `${a.price.amount} ${a.price.currency}` : "—"}</td><td className="p-1 font-medium">{o?.price ? `${o.price} *` : "—"}</td><td className="p-1 text-white/60">{a?.stock ?? "—"}</td>
    <td className="p-1">{a && snapshot.admin && <ManualOvokoLauncher offerId={a.id} />}{a && snapshot.admin && !row.conflict && <ManualWithdrawal offerId={a.id} partId={o?.id} name={row.name} />}</td>
  </tr>;
}
