"use client";

import { useRef, useState } from "react";
import { resolveManualOvokoOverride, type OverrideResult } from "@/lib/ovoko-manual-client";

export type { OverrideResult } from "@/lib/ovoko-manual-client";
export function ManualOvokoOverride({ offerId, brandId, modelId, year, disabled, continueTransfer = false, onBusyChange, onResolved }: {
  offerId: string; brandId: string; modelId: string; year: string; disabled: boolean;
  continueTransfer?: boolean;
  onBusyChange: (busy: boolean) => void; onResolved: (result: OverrideResult) => void;
}) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const lock = useRef(false);
  async function run(kind: "part" | "vehicle") {
    if (disabled || lock.current) return;
    if (!window.confirm(`Recznie odblokowac ${kind === "part" ? "te oferte" : "wybrane auto"}? Akceptujesz ryzyko duplikatu po niepewnej wysylce. Jesli znajdziemy istniejacy rekord, wykorzystamy go zamiast tworzyc drugi. ${continueTransfer ? "Po odblokowaniu ponowimy tylko te pozycje z zachowana cena." : "Potem osobno kliknij Wystaw."}`)) return;
    lock.current = true; setBusy(true); onBusyChange(true); setMessage("Sprawdzam i odblokowuje...");
    let resolved: OverrideResult | undefined;
    try {
      const result = await resolveManualOvokoOverride({ kind, offerId, brandId, modelId, year });
      setMessage(result.message); resolved = result;
    } catch (e) { setMessage(e instanceof Error ? e.message : "Nie potwierdzono wyniku. Nie ponowiono wysylki."); }
    finally { lock.current = false; setBusy(false); onBusyChange(false); }
    if (resolved) onResolved(resolved);
  }
  const button = "rounded border border-orange-300/40 px-3 py-1.5 text-xs disabled:opacity-40";
  return <div className="space-y-2 rounded border border-orange-300/25 p-3 text-sm">
    <p className="text-xs text-white/65">Problem z poprzednia proba? Reczne odblokowanie na Twoja odpowiedzialnosc. Trwajacych wysylek nie przerywamy.</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" className={button} disabled={disabled || busy} onClick={() => void run("part")}>{busy ? "Sprawdzam..." : continueTransfer ? "Odblokuj i przenies te oferte" : "Odblokuj te oferte"}</button>
      <button type="button" className={button} disabled={disabled || busy || !brandId || !modelId || !year} onClick={() => void run("vehicle")}>{continueTransfer ? "Odblokuj auto i przenies te oferte" : "Odblokuj wybrane auto"}</button>
    </div>
    {message && <p role="status" className="text-xs text-amber-200">{message}</p>}
  </div>;
}
