"use client";
import { useRef, useState } from "react";
import { inventoryOperation, operationState, type InventoryJob } from "@/lib/inventory-operations-client";
import type { CombinedPart } from "@/lib/combined-inventory";

const button = "rounded border border-white/20 px-2 py-1 text-xs disabled:opacity-40";
type Item = { requestId: string; row: CombinedPart; job?: InventoryJob; error?: string; attempted?: boolean };
export function BulkInventoryActions({ rows, onFinished }: { rows: CombinedPart[]; onFinished: () => void }) {
  const [kind, setKind] = useState<"withdraw" | "reserve">(), [scope, setScope] = useState("both"), [items, setItems] = useState<Item[]>([]), [busy, setBusy] = useState(false), [started, setStarted] = useState(false);
  const [customer, setCustomer] = useState(""), [price, setPrice] = useState(""), [deposit, setDeposit] = useState("0"), [currency, setCurrency] = useState("PLN"), [until, setUntil] = useState(""), [comment, setComment] = useState("");
  const lock = useRef(false), stop = useRef(false);
  function open(value: "withdraw" | "reserve") { setKind(value); setItems(rows.map(row => ({ row, requestId: crypto.randomUUID() }))); setStarted(false); stop.current = false; }
  const update = (id: string, patch: Partial<Item>) => setItems(values => values.map(value => value.requestId === id ? { ...value, ...patch } : value));
  async function run() {
    if (lock.current || started || !kind) return;
    lock.current = true; setBusy(true); setStarted(true);
    try {
      for (const item of items) {
        if (stop.current) break;
        try {
          const { row } = item;
          const targets = [...(row.allegro && (kind === "reserve" || scope !== "ovoko") ? ["allegro"] : []), ...(row.ovoko && (kind === "reserve" || scope !== "allegro") ? ["ovoko"] : [])];
          if (!targets.length) throw new Error("Brak wybranego kanalu dla tej pozycji.");
          if (kind === "reserve" && (!until || !Number.isFinite(new Date(until).getTime()))) throw new Error("Wpisz prawidlowy termin rezerwacji.");
          const job = await inventoryOperation({ operation: "prepare", requestId: item.requestId, kind, offerId: row.allegro?.id ?? null, partId: row.ovoko?.id ?? null, targets,
            ...(kind === "reserve" ? { reservation: { customer, price: price || row.allegro?.price?.amount || "0", deposit, currency, until: new Date(until).toISOString(), comment } } : {}) });
          update(item.requestId, { job, attempted: true });
          const result = await inventoryOperation({ operation: "execute", jobId: job.id, confirm: true });
          update(item.requestId, { job: result });
        } catch (e) { update(item.requestId, { error: e instanceof Error ? e.message : "Nie potwierdzono wyniku." }); }
        if (items.indexOf(item) < items.length - 1 && !stop.current) await new Promise(resolve => setTimeout(resolve, 6250));
      }
    } finally { lock.current = false; setBusy(false); onFinished(); }
  }
  async function status(item: Item) {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try { update(item.requestId, { job: await inventoryOperation({ operation: "status", jobId: item.job?.id || item.requestId }), error: undefined }); }
    catch (e) { update(item.requestId, { error: (e as Error).message }); }
    finally { lock.current = false; setBusy(false); }
  }
  return <>
    <button className={button} disabled={!rows.length || rows.length > 200} onClick={() => open("withdraw")}>Wycofaj zaznaczone</button>
    <button className={button} disabled={!rows.length || rows.length > 200} onClick={() => open("reserve")}>Zarezerwuj zaznaczone</button>
    {kind && <dialog ref={e => { if (e && !e.open) e.showModal(); }} className="w-[calc(100%_-_2rem)] max-w-4xl space-y-3 rounded border border-white/20 bg-[#11161d] p-4 text-sm text-white backdrop:bg-black/75" aria-label={kind === "reserve" ? "Rezerwacja zaznaczonych czesci" : "Zbiorcze wycofanie"} onCancel={e => { if (busy) e.preventDefault(); else setKind(undefined); }}>
      <h2 className="font-bold">{kind === "reserve" ? "Rezerwacja" : "Wycofanie"}: {items.length} czesci</h2>
      <p className="text-xs text-white/65">Nie usuwamy rekordow ani zdjec. Wynik kazdego kanalu jest oddzielny. Kolejno, maks. 10 czesci/min; zostaw to okno otwarte. Niepewnych zapisow nie ponawiamy.</p>
      {!started && (kind === "withdraw" ? <label className="block text-xs">Zakres <select aria-label="Kanaly wycofania zbiorczego" className="rounded border border-white/20 bg-[#0d1117] p-1" value={scope} onChange={e => setScope(e.target.value)}><option value="both">Wszystkie wskazane kanaly</option><option value="allegro">Tylko Allegro</option><option value="ovoko">Tylko Ovoko</option></select></label> : <div className="grid gap-2 text-xs sm:grid-cols-3">
        <label>Klient<input aria-label="Klient rezerwacji" className="w-full rounded bg-white/5 p-2" value={customer} maxLength={200} onChange={e => setCustomer(e.target.value)} /></label>
        <label>Cena za kazda czesc<input aria-label="Cena rezerwacji" className="w-full rounded bg-white/5 p-2" value={price} placeholder="Puste = cena Allegro" onChange={e => setPrice(e.target.value.replace(",", "."))} /></label>
        <label>Zaliczka za kazda czesc<input aria-label="Zaliczka" className="w-full rounded bg-white/5 p-2" value={deposit} onChange={e => setDeposit(e.target.value.replace(",", "."))} /></label>
        <label>Waluta<select aria-label="Waluta rezerwacji" className="w-full rounded bg-[#11161d] p-2" value={currency} onChange={e => setCurrency(e.target.value)}><option>PLN</option><option>EUR</option></select></label>
        <label>Do kiedy<input aria-label="Termin rezerwacji" type="datetime-local" className="w-full rounded bg-white/5 p-2" value={until} onChange={e => setUntil(e.target.value)} /></label>
        <label>Komentarz<textarea aria-label="Komentarz rezerwacji" className="w-full rounded bg-white/5 p-2" maxLength={2000} value={comment} onChange={e => setComment(e.target.value)} /></label>
        <p className="sm:col-span-3 text-amber-200">Wstrzymamy wszystkie wskazane kanaly. Termin powoduje czerwone oznaczenie, nie automatyczne wznowienie.</p>
      </div>)}
      <div className="max-h-[45vh] overflow-auto">{items.map(item => <div key={item.requestId} className="border-t border-white/10 py-1 text-xs"><p className="truncate">{item.row.name}</p>{item.job ? <p>Allegro: {operationState[item.job.allegro]} / Ovoko: {operationState[item.job.ovoko]}</p> : <p className="text-white/50">Oczekuje</p>}{item.error && <p role="alert" className="text-amber-200">{item.error}</p>}{started && <button className={button} disabled={busy} onClick={() => void status(item)}>Sprawdz wynik bez ponawiania</button>}</div>)}</div>
      <div className="flex gap-2">{!started && <button className={`${button} bg-orange-600`} disabled={busy || kind === "reserve" && (!customer.trim() || !until)} onClick={() => void run()}>Potwierdz {kind === "reserve" ? "rezerwacje" : "wycofanie"} zaznaczonych</button>}{busy && <button className={button} onClick={() => { stop.current = true; }}>Zatrzymaj po biezacej</button>}<button className={button} disabled={busy} onClick={() => setKind(undefined)}>Zamknij</button></div>
    </dialog>}
  </>;
}
