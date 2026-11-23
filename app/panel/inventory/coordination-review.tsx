"use client";

import { useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import { withdrawalPlan, type WithdrawalScope } from "@/lib/sales-coordination";
import type { reviewCoordination } from "@/lib/coordination-review";

type Review = Awaited<ReturnType<typeof reviewCoordination>>;
const button = "rounded border border-white/20 px-2 py-1 text-xs disabled:opacity-40";
export function CoordinationReview({ offerIds }: { offerIds: string[] }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [data, setData] = useState<Review>(), [error, setError] = useState("");
  const lock = useRef(false);
  const [errorCode, setErrorCode] = useState("");
  async function review() {
    if (lock.current || !offerIds.length || offerIds.length > 5) return;
    lock.current = true; setBusy(true); setOpen(true); setError(""); setErrorCode(""); setData(undefined);
    try {
      const { data } = await createSupabaseBrowserClient().auth.getSession();
      if (!data.session) throw new Error("Zaloguj sie ponownie.");
      const response = await fetch("/api/ovoko/coordination-review", { method: "POST", cache: "no-store", headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ offerIds }) });
      const result = await response.json() as Partial<Review> & { message?: string; code?: string };
      if (!response.ok) { setErrorCode(typeof result.code === "string" ? result.code : ""); throw new Error(result.message || "Nie potwierdzono odczytu. Niczego nie zmieniono."); }
      if (result.readOnly !== true || result.automatic !== false || !Array.isArray(result.rows)) throw new Error("Nieprawidlowy wynik kontroli.");
      setData(result as Review);
    } catch (error) { setError(error instanceof Error ? error.message : "Nie udalo sie sprawdzic danych."); }
    finally { lock.current = false; setBusy(false); }
  }
  return <>
    <button className={button} disabled={busy || !offerIds.length || offerIds.length > 5} title="Zaznacz od 1 do 5 ofert. Kontrola bez wycofywania." onClick={() => void review()}>Koordynacja: sprawdz (1-5)</button>
    {open && <dialog ref={element => { if (element && !element.open) element.showModal(); }} className="fixed inset-0 z-50 m-0 flex h-full max-h-none w-full max-w-none items-start justify-center overflow-y-auto bg-black/75 p-4 sm:p-8" aria-labelledby="coordination-title" onCancel={event => { if (busy) event.preventDefault(); else setOpen(false); }}>
      <section className="w-full max-w-4xl space-y-3 rounded-lg border border-white/20 bg-[#11161d] p-4 text-sm text-white">
        <div className="flex items-center justify-between gap-4"><h2 id="coordination-title" className="font-bold">Koordynacja sprzedazy: tryb kontrolny</h2><button className={button} disabled={busy} onClick={() => setOpen(false)}>Zamknij</button></div>
        <p className="rounded border border-amber-300/25 bg-amber-300/5 p-2 text-xs text-amber-100">Automatyczne wycofywanie NIE jest wlaczone. Ten podglad niczego nie konczy, nie usuwa i nie zmienia stanow. Nie zapewnia jeszcze ochrony przed podwojna sprzedaza.</p>
        {busy && <p role="status">Sprawdzam aktualne konta, powiazania, statusy i zdarzenia sprzedazy...</p>}
        {error && <div role="alert" className="space-y-2 text-amber-200"><p>{error}</p>{errorCode && <p className="text-xs">Kod diagnostyczny: <code>{errorCode}</code></p>}<button className={button} disabled={busy} onClick={() => void review()}>Ponow odczyt</button>{/^coordination_(?:(?:seller|offers|events)_http_(?:401|403)|token_(?:400|401|409))$/.test(errorCode) && <a href="/panel/allegro" className="ml-2 inline-block rounded border border-white/20 px-3 py-1.5 text-xs underline">Polaczenie Allegro: ponowna autoryzacja</a>}</div>}
        {data && <><p className="text-xs text-white/60">{data.scope} Odczytano zdarzen: {data.eventsRead}. {data.partial && "Osiagnieto limit odczytu; historia jest niepelna."}</p>
          {data.rows.map(row => <div key={row.offerId} className="space-y-2 rounded border border-white/15 p-2">
            <div className="font-semibold">{row.name || `Allegro ${row.offerId}`}</div>
            <p className="text-xs text-white/60">Allegro {row.offerId}: {row.allegroStatus}, sztuk: {row.stock ?? "?"}. Ovoko {row.partId || "niepotwierdzone"}: {row.ovokoStatus}.</p>
            <p className={`text-xs ${row.decision.status === "ready" ? "text-cyan-200" : "text-amber-100"}`}><b>{row.decision.status === "ready" ? "Proponowana decyzja (niewykonana)" : row.decision.status === "review" ? "Do sprawdzenia" : "Bez operacji"}:</b> {row.decision.reason}</p>
            {row.note && <p className="text-xs text-amber-200">{row.note}</p>}
            <WithdrawalPreview available={{ allegro: row.withdrawal.allegro, ovoko: row.withdrawal.ovoko, conflict: false }} />
          </div>)}
        </>}
        <details className="text-xs text-white/65"><summary className="cursor-pointer">Zasady wycofywania i usuwania</summary><p className="mt-2">Tylko Allegro: zakoncz oferte, Ovoko pozostaje bez zmian. Tylko Ovoko: status Wycofany, bez kasowania zdjec; Allegro pozostaje bez zmian. Oba: dwie osobne operacje z oddzielnym wynikiem. Trwalego usuwania nie laczymy z wycofaniem: Ovoko moze wtedy usunac zdjecia i oferte eBay.</p><p className="mt-2">Sprzedaz ostatniej sztuki ma blokowac drugi kanal. Sama zmiana statusu, usuniecie lub blad odczytu nie oznaczaja sprzedazy. Anulowanie i zwrot nigdy nie wznawiaja automatycznie oferty.</p></details>
      </section>
    </dialog>}
  </>;
}
function WithdrawalPreview({ available }: { available: { allegro: boolean; ovoko: boolean; conflict: boolean } }) {
  const [scope, setScope] = useState<WithdrawalScope>();
  const plan = scope ? withdrawalPlan(scope, available) : [];
  return <div className="space-y-1 text-xs"><div className="flex flex-wrap items-center gap-2"><span className="text-white/50">Podglad wycofania:</span>{(["allegro", "ovoko", "both"] as const).map(value => <button key={value} className={`${button} ${scope === value ? "border-cyan-300 text-cyan-200" : ""}`} disabled={value === "both" ? !available.allegro || !available.ovoko : !available[value]} onClick={() => setScope(value)}>{value === "both" ? "Oba portale" : `Tylko ${value === "allegro" ? "Allegro" : "Ovoko"}`}</button>)}</div>{scope && <p className="text-white/60">Plan: {plan.map(item => `${item.target === "allegro" ? "Allegro: zakoncz oferte" : "Ovoko: ustaw Wycofany"}`).join("; ")}. Podglad, niczego nie wykonano. Zdjecia i historia pozostaja.</p>}</div>;
}
