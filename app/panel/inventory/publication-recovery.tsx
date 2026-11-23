"use client";
import { useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase";
type Result = { message: string; token?: string; partId?: string | null; resolved?: boolean };
export function PublicationRecovery({ offerId }: { offerId: string }) {
  const [busy, setBusy] = useState(false), [result, setResult] = useState<Result>(), [error, setError] = useState(""), [checked, setChecked] = useState(false);
  const lock = useRef(false);
  async function run(operation: "check" | "confirm") {
    if (lock.current) return; lock.current = true; setBusy(true); setError("");
    if (operation === "check") { setResult(undefined); setChecked(false); }
    try {
      const { data } = await createSupabaseBrowserClient().auth.getSession(); if (!data.session) throw new Error("Zaloguj sie ponownie.");
      const response = await fetch("/api/ovoko/publication-recovery", { method: "POST", cache: "no-store", headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ operation, offerId, ...(operation === "confirm" ? { token: result?.token, confirmAbsent: checked } : {}) }) });
      const payload = await response.json() as Result;
      if (!response.ok) throw new Error(payload.message || "Nie potwierdzono kontroli blokady.");
      setResult(payload);
    } catch (error) { setError(error instanceof Error ? error.message : "Nie potwierdzono wyniku."); }
    finally { lock.current = false; setBusy(false); }
  }
  const button = "rounded border border-white/20 px-3 py-1.5 text-xs disabled:opacity-40";
  return <details className="rounded border border-amber-300/25 p-3 text-sm"><summary className="cursor-pointer font-semibold">Rozwiaz stara blokade publikacji (np. Land Rover)</summary>
    <div className="mt-2 space-y-2"><p className="text-xs text-white/60">Tylko dla niepewnej proby starszej niz 30 minut. Sprawdzamy powiazanie i kompletny magazyn do 2000 czesci. To nie jest ponowna wysylka ani usuwanie czesci.</p>
      <button className={button} disabled={busy} onClick={() => void run("check")}>Sprawdz blokade w Ovoko</button>
      {error && <p role="alert" className="text-amber-200">{error}</p>}
      {result && <p role="status">{result.message}</p>}
      {result?.token && !result.resolved && <>
        {!result.partId && <label className="flex items-start gap-2 text-xs"><input type="checkbox" disabled={busy} checked={checked} onChange={event => setChecked(event.target.checked)} />Sprawdzilem recznie wszystkie statusy Ovoko. Tej fizycznej czesci nie ma; chce zwolnic stara blokade.</label>}
        <button className={button} disabled={busy || !result.partId && !checked} onClick={() => void run("confirm")}>{result.partId ? "Napraw powiazanie, bez wystawiania" : "Potwierdz zwolnienie starej blokady"}</button>
      </>}
      {result?.resolved && <button className={button} onClick={() => window.location.reload()}>Odswiez podglad po rozstrzygnieciu</button>}
    </div>
  </details>;
}
