"use client";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { inventoryOperation, operationState, type InventoryJob } from "@/lib/inventory-operations-client";
export function ReservationsPanel() {
  const [rows, setRows] = useState<InventoryJob[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState(""), [plan, setPlan] = useState<InventoryJob>(), [now, setNow] = useState(0);
  const lock = useRef(false);
  const [remove, setRemove] = useState<InventoryJob>();
  const groups = useMemo(() => {
    const result = new Map<string, InventoryJob[]>();
    for (const row of rows) { const key = row.reservation?.groupId || row.id; result.set(key, [...(result.get(key) || []), row]); }
    return [...result.entries()];
  }, [rows]);
  const refresh = useCallback(async () => { try { setRows((await inventoryOperation<{ rows: InventoryJob[] }>({ operation: "list" })).rows); setNow(Date.now()); } catch (e) { setRows([]); setError((e as Error).message); } }, []);
  useEffect(() => {
    let active = true;
    void inventoryOperation<{ rows: InventoryJob[] }>({ operation: "list" }).then(value => { if (active) { setRows(value.rows); setNow(Date.now()); } }).catch(e => { if (active) { setRows([]); setError((e as Error).message); } });
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  async function run(operation: string, row: InventoryJob) {
    if (lock.current) return; lock.current = true; setBusy(true); setError("");
    try {
      const job = await inventoryOperation(operation === "prepare-restore" ? { operation, reservationId: row.id, requestId: crypto.randomUUID() } : { operation, jobId: row.id, ...(["execute", "cancel-plan", "archive"].includes(operation) ? { confirm: true } : {}) });
      if (operation === "archive") setRemove(undefined);
      if (operation === "prepare-restore" || row.kind === "restore") setPlan(job);
      await refresh();
    } catch (e) { setError((e as Error).message); } finally { lock.current = false; setBusy(false); }
  }
  return <section className="space-y-3"><h1 className="text-xl font-bold">Zarezerwowane</h1><p className="text-xs text-white/60">Po terminie zaznaczamy na czerwono. Przywracanie jest reczne i wymaga dostepnej sztuki; niczego nie wznawiamy po sprzedazy. Maks. 200 otwartych rezerwacji w tym widoku.</p><button className="rounded border border-white/20 px-2 py-1 text-xs" disabled={busy} onClick={() => void refresh()}>Odswiez rezerwacje</button>
    {error && <p role="alert" className="text-amber-200">{error}</p>}
    <div className="overflow-auto"><table className="w-full text-left text-xs" aria-label="Zarezerwowane czesci"><thead><tr><th className="p-2">Czesc</th><th>Klient / komentarz</th><th>Cena / zaliczka</th><th>Do kiedy</th><th>Wynik</th><th className="text-right">Opcje</th></tr></thead><tbody>{groups.map(([id, items]) => <Fragment key={id}><tr className="bg-white/5"><th colSpan={6} className="px-2 py-2 text-left">{items[0].reservation?.customer} · {items.length} czesci · {items[0].reservation?.comment}<a href="/panel/inventory" className="ml-3 font-normal text-orange-300 underline">Znajdz i dodaj kolejna czesc</a></th></tr>{items.map(row => <tr key={row.id} className={`border-t border-white/10 ${row.reservation && Date.parse(row.reservation.until) < now ? "bg-red-700/20 text-red-200" : ""}`}>
      <td className="p-2">{row.name}<p>A: {row.offerId || "-"}; O: {row.partId || "-"}</p></td>
      <td>{row.reservation?.customer}<p className="max-w-xs whitespace-pre-wrap text-white/60">{row.reservation?.comment}</p></td>
      <td>{row.reservation?.price} {row.reservation?.currency}<p>Zaliczka: {row.reservation?.deposit}</p></td>
      <td>{row.reservation ? new Date(row.reservation.until).toLocaleString("pl-PL", { timeZone: "Europe/Warsaw" }) : "-"}</td>
      <td><p>A: {operationState[row.allegro]}; O: {operationState[row.ovoko]}</p><div className="flex flex-wrap gap-2">
        <button className="underline" disabled={busy} onClick={() => void run("status", row)}>Sprawdz wynik</button>
        {row.state === "prepared" && <><button className="underline" disabled={busy} onClick={() => void run("execute", row)}>Potwierdz dokonczenie rezerwacji</button><button className="underline" disabled={busy} onClick={() => void run("cancel-plan", row)}>Anuluj nieuruchomiony plan</button></>}
      </div></td><td className="py-2 text-right"><div className="flex justify-end gap-2"><button className="rounded border border-emerald-400/30 px-2 py-1 text-emerald-200 disabled:opacity-40" disabled={busy || row.state !== "settled"} onClick={() => void run("prepare-restore", row)}>Przywroc</button><button className="rounded border border-red-400/30 px-2 py-1 text-red-200 disabled:opacity-40" disabled={busy || row.state !== "settled"} onClick={() => setRemove(row)}>Usun</button></div></td>
    </tr>)}</Fragment>)}</tbody></table>{!rows.length && <p className="py-4 text-xs text-white/50">Brak otwartych rezerwacji.</p>}</div>
    {remove && <dialog ref={e => { if (e && !e.open) e.showModal(); }} className="max-w-lg space-y-3 rounded border border-white/20 bg-[#11161d] p-4 text-sm text-white backdrop:bg-black/75" aria-label="Usun rezerwacje" onCancel={e => { if (busy) e.preventDefault(); else setRemove(undefined); }}><h2 className="font-bold">Usun czesc z rezerwacji?</h2><p>{remove.name}</p><p>Usuniemy ja z listy rezerwacji. Oferty pozostana wycofane. Nie kasujemy czesci z portali ani historii operacji. Zeby ponownie sprzedawac, wybierz Przywroc zamiast Usun.</p><button disabled={busy} className="mr-3 rounded bg-red-800 px-2 py-1" onClick={() => void run("archive", remove)}>Usun z rezerwacji bez wznawiania</button><button disabled={busy} onClick={() => setRemove(undefined)}>Anuluj</button></dialog>}
    {plan && <dialog ref={e => { if (e && !e.open) e.showModal(); }} className="max-w-lg space-y-3 rounded border border-white/20 bg-[#11161d] p-4 text-sm text-white backdrop:bg-black/75" aria-label="Przywroc rezerwacje" onCancel={e => { if (busy) e.preventDefault(); else setPlan(undefined); }}><h2 className="font-bold">Przywroc dostepnosc</h2><p>{plan.name}</p><p className="text-amber-200">Potwierdz, ze czesc nadal fizycznie jest dostepna. Sprawdzimy stock i statusy; nie zwiekszymy ilosci sprzedanej oferty.</p><p>Allegro: {operationState[plan.allegro]}; Ovoko: {operationState[plan.ovoko]}</p><div className="flex gap-2">{plan.state === "prepared" ? <button disabled={busy} className="rounded bg-orange-600 p-2" onClick={() => void run("execute", plan)}>Potwierdz dostepnosc i przywroc</button> : <button disabled={busy} className="underline" onClick={() => void run("status", plan)}>Sprawdz przywrocenie bez ponawiania</button>}<button disabled={busy} className="underline" onClick={() => setPlan(undefined)}>Zamknij</button></div></dialog>}
  </section>;
}
