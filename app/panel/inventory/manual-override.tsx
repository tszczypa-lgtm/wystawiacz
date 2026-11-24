"use client";

import { useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase";

export type OverrideResult = { message: string; token?: string; resolved?: boolean; kind?: "part" | "vehicle"; foundId?: string | null };
export function ManualOvokoOverride({ offerId, brandId, modelId, year, disabled, onBusyChange, onResolved }: {
  offerId: string; brandId: string; modelId: string; year: string; disabled: boolean;
  onBusyChange: (busy: boolean) => void; onResolved: (result: OverrideResult) => void;
}) {
  const [kind, setKind] = useState("part"), [busy, setBusy] = useState(false), [result, setResult] = useState<OverrideResult>();
  const [checked, setChecked] = useState(false), [risk, setRisk] = useState(false), [typed, setTyped] = useState(""), [reason, setReason] = useState(""), [error, setError] = useState("");
  const lock = useRef(false);
  async function run(operation: "check" | "confirm") {
    if (disabled || lock.current) return;
    lock.current = true; setBusy(true); onBusyChange(true); setError("");
    if (operation === "check") { setResult(undefined); setChecked(false); setRisk(false); setTyped(""); }
    try {
      const { data } = await createSupabaseBrowserClient().auth.getSession();
      if (!data.session) throw new Error("Zaloguj sie ponownie.");
      const response = await fetch("/api/ovoko/manual-override", { method: "POST", cache: "no-store", headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify(operation === "check" ? { operation, kind, offerId, brandId, modelId, year } : { operation, token: result?.token, brandId, checkedOvoko: checked, confirmRisk: risk, typedOfferId: typed, reason }) });
      const current = await createSupabaseBrowserClient().auth.getSession();
      if (current.data.session?.user.id !== data.session.user.id) throw new Error("Sesja zmienila sie. Sprawdz wynik po ponownym zalogowaniu.");
      const payload = await response.json().catch(() => null) as OverrideResult | null;
      if (!response.ok || !payload) throw new Error(payload?.message || "Nie potwierdzono decyzji. Niczego nie wyslano; sprawdz blokade ponownie.");
      setResult(payload);
      if (payload.resolved) onResolved(payload);
    } catch (e) { setError(e instanceof Error ? e.message : "Nie potwierdzono wyniku. Nie ponowiono wysylki."); }
    finally { lock.current = false; setBusy(false); onBusyChange(false); }
  }
  const button = "rounded border border-white/20 px-3 py-1.5 text-xs disabled:opacity-40";
  const field = "rounded border border-white/20 bg-[#0d1117] px-2 py-1";
  return <details className="rounded border border-red-300/30 p-3 text-sm"><summary className="cursor-pointer font-semibold">Reczne odblokowanie na moja odpowiedzialnosc</summary>
    <fieldset disabled={disabled || busy} className="mt-2 space-y-2">
      <p className="text-xs text-amber-200">Tylko stare proby (minimum 30 minut). Najpierw wylacz oba kierunki synchronizacji. To rozstrzygniecie rejestru, nie automatyczna wysylka. Nie omija uprawnien ani blokady innego aktywnego konta.</p>
      <label className="block">Rodzaj blokady <select aria-label="Rodzaj blokady" className={field} value={kind} onChange={e => { setKind(e.target.value); setResult(undefined); }}><option value="part">Wysylka czesci</option><option value="vehicle">Tworzenie auta (wybrany model i rok)</option></select></label>
      <button type="button" className={button} disabled={kind === "vehicle" && (!brandId || !modelId || !year)} onClick={() => void run("check")}>Sprawdz stara blokade</button>
      {result && <p role="status">{result.message}</p>}
      {result?.token && !result.resolved && <>
        <label className="flex gap-2 text-xs"><input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} />Sprawdzilem recznie wszystkie statusy czesci / auta w Ovoko.</label>
        <label className="flex gap-2 text-xs"><input type="checkbox" checked={risk} onChange={e => setRisk(e.target.checked)} />Akceptuje ryzyko duplikatu i zlecam rozstrzygniecie starej blokady na moja odpowiedzialnosc.</label>
        <label className="block text-xs">Przepisz ID aukcji: {offerId} <input aria-label="Potwierdz ID aukcji" className={field} value={typed} onChange={e => setTyped(e.target.value)} /></label>
        <label className="block text-xs">Powod (minimum 10 znakow) <input aria-label="Powod odblokowania" className={`${field} w-full`} value={reason} maxLength={1000} onChange={e => setReason(e.target.value)} /></label>
        <button type="button" className={button} disabled={!checked || !risk || typed !== offerId || reason.trim().length < 10} onClick={() => void run("confirm")}>{result.foundId ? "Napraw rejestr istniejacego rekordu" : "Potwierdz reczne odblokowanie"}</button>
      </>}
      {error && <p role="alert" className="text-amber-200">{error}</p>}
    </fieldset>
  </details>;
}
