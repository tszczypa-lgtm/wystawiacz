"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import { OvokoFallbackVehicle, type FallbackVehicle } from "./ovoko-fallback-vehicle";
import type { OvokoRepairHint } from "@/lib/ovoko-read";

export type OvokoCorrections = { categoryId?: string; manufacturerCode?: string };
export function OvokoJobRepair({ id, disabled, hint, onTransfer }: { id: string; disabled: boolean; hint?: OvokoRepairHint; onTransfer: (vehicle: FallbackVehicle | undefined, corrections: OvokoCorrections) => void }) {
  const [opened, setOpened] = useState(false), [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [vehicle, setVehicle] = useState<FallbackVehicle>(), [categoryId, setCategoryId] = useState(""), [number, setNumber] = useState(""), [error, setError] = useState("");
  useEffect(() => {
    if (!opened || hint && !hint.needsCategory) return;
    const controller = new AbortController();
    void (async () => {
      const { data } = await createSupabaseBrowserClient().auth.getSession();
      if (!data.session) throw new Error("Zaloguj sie ponownie.");
      const response = await fetch("/api/ovoko/read", { method: "POST", signal: controller.signal, cache: "no-store", headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ useSaved: true, operation: "categories" }) });
      const result = await response.json() as { ok?: boolean; readOnly?: boolean; message?: string; rows?: { id: string; name: string; parentId?: string; level: string }[] };
      if (!response.ok || !result.ok || !result.readOnly || !Array.isArray(result.rows)) throw new Error(result.message || "Nie odczytano kategorii.");
      const byId = new Map<string, { id: string; name: string; parentId?: string }>(result.rows.map((row: { id: string; name: string; parentId?: string }) => [row.id, row]));
      if (!controller.signal.aborted) setCategories(result.rows.filter((row: { level: string }) => row.level === "3").map((row: { id: string; name: string; parentId?: string }) => ({ id: row.id, name: [byId.get(byId.get(row.parentId || "")?.parentId || "")?.name, byId.get(row.parentId || "")?.name, row.name].filter(Boolean).join(" / ") })).sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "pl")));
    })().catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [opened, hint]);
  const field = "w-full min-w-0 rounded border border-white/20 bg-[#0d1117] px-2 py-1.5";
  return <details className="mt-1 text-xs" open={opened} onToggle={event => setOpened(event.currentTarget.open)}>
    <summary className="cursor-pointer text-orange-300">Uzupelnij i przenies</summary>
    {opened && <form aria-label={`Popraw oferte ${id}`} className="mt-2 space-y-2 rounded border border-white/10 p-2" onSubmit={event => { event.preventDefault(); onTransfer(vehicle, { ...((categoryId || hint?.categoryId) ? { categoryId: categoryId || hint?.categoryId } : {}), ...(number.trim() ? { manufacturerCode: number.trim().toUpperCase().replace(/[ .]/g, "") } : {}) }); }}>
      {(!hint || hint.needsVehicle) && <OvokoFallbackVehicle disabled={disabled} onChange={setVehicle} knownBrandId={hint?.brandId} initiallyOpen title="Wybierz brakujacy model" />}
      <div className="flex flex-wrap items-end gap-2">{(!hint || hint.needsCategory) && <label>Kategoria Ovoko<select aria-label="Kategoria Ovoko" className={field} value={categoryId} disabled={disabled} onChange={event => setCategoryId(event.target.value)}><option value="">Automatycznie</option>{categories.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>}{!hint && <label>Numer czesci<input className={field} value={number} maxLength={60} disabled={disabled} onChange={event => setNumber(event.target.value)} placeholder="Puste: automat / bez numeru" /></label>}<button className="rounded bg-[#ff5a00] px-3 py-2 font-bold disabled:opacity-40" disabled={disabled || !!hint?.needsVehicle && !vehicle || !!hint?.needsCategory && !categoryId}>Przenies te pozycje</button></div>
      {error && <p role="status" className="text-amber-200">{error}</p>}
    </form>}
  </details>;
}
