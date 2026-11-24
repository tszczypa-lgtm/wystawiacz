"use client";

import { useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase";

export type OverrideResult = { message: string; token?: string; resolved?: boolean; kind?: "part" | "vehicle"; foundId?: string | null };
export function ManualOvokoOverride({ offerId, brandId, modelId, year, disabled, onBusyChange, onResolved }: {
  offerId: string; brandId: string; modelId: string; year: string; disabled: boolean;
  onBusyChange: (busy: boolean) => void; onResolved: (result: OverrideResult) => void;
}) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const lock = useRef(false);
  async function run(kind: "part" | "vehicle") {
    if (disabled || lock.current) return;
    if (!window.confirm(`Recznie odblokowac ${kind === "part" ? "te oferte" : "wybrane auto"}? Akceptujesz ryzyko duplikatu po niepewnej wysylce. Jesli znajdziemy istniejacy rekord, wykorzystamy go zamiast tworzyc drugi. Potem osobno kliknij Wystaw.`)) return;
    lock.current = true; setBusy(true); onBusyChange(true); setMessage("Sprawdzam i odblokowuje...");
    try {
      const { data } = await createSupabaseBrowserClient().auth.getSession();
      if (!data.session) throw new Error("Zaloguj sie ponownie.");
      const session = data.session;
      const request = async (body: unknown) => {
        const current = await createSupabaseBrowserClient().auth.getSession();
        if (current.data.session?.user.id !== session.user.id) throw new Error("Sesja zmienila sie. Otworz formularz ponownie.");
        const response = await fetch("/api/ovoko/manual-override", { method: "POST", cache: "no-store", headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const after = await createSupabaseBrowserClient().auth.getSession();
        if (after.data.session?.user.id !== session.user.id) throw new Error("Sesja zmienila sie. Sprawdz wynik po ponownym zalogowaniu.");
        const result = await response.json().catch(() => null) as OverrideResult | null;
        if (!response.ok || !result) throw new Error(result?.message || "Nie potwierdzono odblokowania. Nie wyslano czesci; sprawdz ponownie.");
        return result;
      };
      const preview = await request({ operation: "check", kind, offerId, brandId, modelId, year });
      const result = preview.resolved ? preview : preview.token ? await request({ operation: "confirm", token: preview.token, brandId, confirmManual: true }) : null;
      if (!result?.resolved) throw new Error("Nie potwierdzono odblokowania. Nie ponowiono wysylki.");
      setMessage(result.message); onResolved(result);
    } catch (e) { setMessage(e instanceof Error ? e.message : "Nie potwierdzono wyniku. Nie ponowiono wysylki."); }
    finally { lock.current = false; setBusy(false); onBusyChange(false); }
  }
  const button = "rounded border border-orange-300/40 px-3 py-1.5 text-xs disabled:opacity-40";
  return <div className="space-y-2 rounded border border-orange-300/25 p-3 text-sm">
    <p className="text-xs text-white/65">Problem z poprzednia proba? Reczne odblokowanie na Twoja odpowiedzialnosc. Trwajacych wysylek nie przerywamy.</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" className={button} disabled={disabled || busy} onClick={() => void run("part")}>{busy ? "Sprawdzam..." : "Odblokuj te oferte"}</button>
      <button type="button" className={button} disabled={disabled || busy || !brandId || !modelId || !year} onClick={() => void run("vehicle")}>Odblokuj wybrane auto</button>
    </div>
    {message && <p role="status" className="text-xs text-amber-200">{message}</p>}
  </div>;
}
