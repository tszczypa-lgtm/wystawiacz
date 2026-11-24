"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase";
type Row = { id: string; name: string; years?: string };
export type FallbackVehicle = { brandId: string; modelId: string; year?: string };
async function read(operation: "brands" | "models", signal: AbortSignal, brandId?: string): Promise<Row[]> {
  const { data } = await createSupabaseBrowserClient().auth.getSession();
  if (!data.session) throw new Error("Zaloguj sie ponownie.");
  const response = await fetch(operation === "brands" ? "/api/ovoko/test" : "/api/ovoko/read", { method: "POST", signal, cache: "no-store", headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ useSaved: true, ...(operation === "models" ? { operation, brandId } : {}) }) });
  const result = await response.json() as { ok?: boolean; readOnly?: boolean; message?: string; brands?: Row[]; rows?: Row[] };
  const rows = operation === "brands" ? result.brands : result.rows;
  if (!response.ok || !result.ok || !result.readOnly || !Array.isArray(rows)) throw new Error(result.message || "Nie odczytano modeli Ovoko.");
  return rows;
}
export function OvokoFallbackVehicle({ disabled, onChange, knownBrandId = "", knownModelId = "", requireYear = false, initiallyOpen = false, title = "Model pomocniczy dla ofert bez rozpoznanego modelu (opcjonalnie)" }: { disabled: boolean; onChange: (value: FallbackVehicle | undefined) => void; knownBrandId?: string; knownModelId?: string; requireYear?: boolean; initiallyOpen?: boolean; title?: string }) {
  const [opened, setOpened] = useState(initiallyOpen), [brands, setBrands] = useState<Row[]>([]), [models, setModels] = useState<Row[]>([]);
  const [brandId, setBrandId] = useState(knownBrandId), [modelId, setModelId] = useState(knownModelId), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [year, setYear] = useState("");
  useEffect(() => {
    if (!opened || knownBrandId) return;
    const controller = new AbortController();
    void Promise.resolve().then(async () => { if (controller.signal.aborted) return; setBusy(true); setError(""); const rows = await read("brands", controller.signal); if (!controller.signal.aborted) setBrands(rows); }).catch(error => { if (!controller.signal.aborted) setError(error.message); }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [opened, knownBrandId]);
  useEffect(() => {
    if (!brandId) return;
    const controller = new AbortController();
    void Promise.resolve().then(async () => { if (controller.signal.aborted) return; setBusy(true); setError(""); const rows = await read("models", controller.signal, brandId); if (!controller.signal.aborted) setModels(rows); }).catch(error => { if (!controller.signal.aborted) setError(error.message); }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [brandId]);
  const field = "w-full rounded-lg border border-white/20 bg-[#0d1117] px-3 py-2 disabled:opacity-40";
  return <details className="rounded-lg border border-white/10 p-3 text-sm" open={opened} onToggle={event => setOpened(event.currentTarget.open)}>
    <summary className="cursor-pointer font-bold">{title}</summary>
    <p className="my-2 text-xs text-white/65">Wybrany model zostanie uzyty przy poprawianiu tej pozycji. Marka musi pasowac do oferty.</p>
    <div className="grid gap-3 sm:grid-cols-2">{!knownBrandId && <label>Marka pomocnicza<select aria-label="Marka pomocnicza" className={field} value={brandId} disabled={disabled || busy} onChange={event => { setBrandId(event.target.value); setModelId(""); setModels([]); onChange(undefined); }}><option value="">Bez modelu pomocniczego</option>{brands.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>}<label>Model pomocniczy<select aria-label="Model pomocniczy" className={field} value={modelId} disabled={disabled || busy || !models.length} onChange={event => { setModelId(event.target.value); onChange(event.target.value ? { brandId, modelId: event.target.value, ...(year ? { year } : {}) } : undefined); }}><option value="">Wybierz model</option>{models.map(row => <option key={row.id} value={row.id}>{row.name} {row.years}</option>)}</select></label></div>
    {busy && <p role="status">Pobieram slownik Ovoko...</p>}{error && <p role="status" className="text-amber-200">{error}</p>}
    {requireYear && <label className="mt-2 block">Rok rekordu auta<input aria-label="Rok rekordu auta" className={field} inputMode="numeric" maxLength={4} value={year} disabled={disabled} onChange={event => { setYear(event.target.value); onChange(modelId ? { brandId, modelId, ...(event.target.value ? { year: event.target.value } : {}) } : undefined); }} /></label>}
  </details>;
}
