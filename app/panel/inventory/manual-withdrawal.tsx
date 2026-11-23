"use client";
import { useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import type { WithdrawalScope } from "@/lib/sales-coordination";

type Job = { id: string; offerId: string; partId: string | null; scope: WithdrawalScope; state: string; allegro: string; ovoko: string };
const button = "rounded border border-white/20 px-3 py-1.5 text-xs disabled:opacity-40";
const labels: Record<string, string> = { pending: "Przygotowane", submitted: "Wyslano; potrzebny odczyt potwierdzenia", done: "Potwierdzone wycofanie", uncertain: "Niepewny wynik: sprawdz portal, nie ponawiaj", not_requested: "Bez zmian" };
export function ManualWithdrawal({ offerId, partId, name }: { offerId: string; partId?: string; name: string }) {
  const [open, setOpen] = useState(false), [scope, setScope] = useState<WithdrawalScope>("allegro"), [busy, setBusy] = useState(false), [job, setJob] = useState<Job>(), [error, setError] = useState(""), [attempted, setAttempted] = useState(false);
  const lock = useRef(false);
  async function run(operation: "prepare" | "execute" | "status") {
    if (lock.current || operation === "execute" && attempted) return;
    lock.current = true; setBusy(true); setError("");
    if (operation === "execute") setAttempted(true);
    try {
      const { data } = await createSupabaseBrowserClient().auth.getSession();
      if (!data.session) throw new Error("Zaloguj sie ponownie.");
      const body = operation === "prepare" ? { operation, offerId, ...(scope !== "allegro" ? { partId } : {}), scope } : { operation, jobId: job?.id, ...(operation === "execute" ? { confirm: true } : {}) };
      const response = await fetch("/api/allegro/inventory-withdrawal", { method: "POST", cache: "no-store", headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json() as Job & { message?: string };
      if (!response.ok) throw new Error(result.message || "Nie potwierdzono wyniku. Sprawdz portale.");
      if (!result.id || result.offerId !== offerId) throw new Error("Nieprawidlowe potwierdzenie operacji.");
      setJob(result);
    } catch (error) { setError(error instanceof Error ? error.message : "Nie potwierdzono wyniku."); }
    finally { lock.current = false; setBusy(false); }
  }
  return <>
    <button className="ml-2 text-[11px] text-white/60 underline" onClick={() => setOpen(true)}>Wycofaj</button>
    {open && <dialog ref={element => { if (element && !element.open) element.showModal(); }} className="w-[calc(100%_-_2rem)] max-w-lg space-y-3 rounded-lg border border-white/20 bg-[#11161d] p-4 text-sm text-white backdrop:bg-black/75" aria-labelledby={`withdraw-${offerId}`} onCancel={event => { if (busy) event.preventDefault(); else setOpen(false); }}>
      <h2 id={`withdraw-${offerId}`} className="font-bold">Wycofaj ze sprzedazy</h2><p>{name}</p>
      <p className="text-xs text-white/65">Nie usuwamy zdjec ani rekordow. Allegro: zakonczona oferta. Ovoko: Wycofany. Bez automatycznego wznowienia.</p>
      <select aria-label="Zakres wycofania" className="w-full rounded border border-white/20 bg-[#0d1117] p-2" value={scope} disabled={busy || attempted} onChange={event => { setScope(event.target.value as WithdrawalScope); setJob(undefined); setError(""); }}><option value="allegro">Tylko Allegro; Ovoko bez zmian</option><option value="ovoko" disabled={!partId}>Tylko Ovoko; Allegro bez zmian</option><option value="both" disabled={!partId}>Oba portale</option></select>
      <p className="text-xs">Allegro ID: {offerId}{scope !== "allegro" && `; Ovoko ID: ${partId}`}. {scope === "both" && "Dwie niezalezne operacje: jeden portal moze sie powiesc, a drugi wymagac sprawdzenia."}</p>
      {job && <div className="rounded border border-white/15 p-2 text-xs"><p>Allegro: {labels[job.allegro] || job.allegro}</p><p>Ovoko: {labels[job.ovoko] || job.ovoko}</p></div>}
      {error && <p role="alert" className="text-xs text-amber-200">{error}</p>}
      <div className="flex flex-wrap gap-2">
        {!job && !attempted && <button className={button} disabled={busy} onClick={() => void run("prepare")}>Sprawdz i przygotuj</button>}
        {job?.state === "prepared" && !attempted && <button className={`${button} border-orange-400 bg-orange-500/15`} disabled={busy} onClick={() => void run("execute")}>Potwierdz wycofanie: {scope === "both" ? "oba portale" : scope === "allegro" ? "tylko Allegro" : "tylko Ovoko"}</button>}
        {job && attempted && <button className={button} disabled={busy} onClick={() => void run("status")}>Sprawdz wynik (bez ponawiania)</button>}
        <button className={button} disabled={busy} onClick={() => setOpen(false)}>Zamknij</button>
      </div>
    </dialog>}
  </>;
}
