"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase";
type Row = { id: string; name: string; years?: string };
export type FallbackVehicle = { brandId: string; modelId: string };
async function read(operation: "brands" | "models", signal: AbortSignal, brandId?: string): Promise<Row[]> {
  const { data } = await createSupabaseBrowserClient().auth.getSession();
  if (!data.session) throw new Error("Zaloguj sie ponownie.");
  const response = await fetch(operation === "brands" ? "/api/ovoko/test" : "/api/ovoko/read", { method: "POST", signal, cache: "no-store", headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ useSaved: true, ...(operation === "models" ? { operation, brandId } : {}) }) });
  const result = await response.json() as { ok?: boolean; readOnly?: boolean; message?: string; brands?: Row[]; rows?: Row[] };
  const rows = operation === "brands" ? result.brands : result.rows;
  if (!response.ok || !result.ok || !result.readOnly || !Array.isArray(rows)) throw new Error(result.message || "Nie odczytano modeli Ovoko.");
  return rows;
}
export function OvokoFallbackVehicle({ disabled, onChange }: { disabled: boolean; onChange: (value: FallbackVehicle | undefined) => void }) {
  const [opened, setOpened] = useState(false), [brands, setBrands] = useState<Row[]>([]), [models, setModels] = useState<Row[]>([]);
  const [brandId, setBrandId] = useState(""), [modelId, setModelId] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    if (!opened) return;
    const controller = new AbortController(); setBusy(true); setError("");
    void read("brands", controller.signal).then(rows => { if (!controller.signal.aborted) setBrands(rows); }).catch(error => { if (!controller.signal.aborted) setError(error.message); }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [opened]);
  useEffect(() => {
    if (!brandId) return;
    const controller = new AbortController(); setBusy(true); setError("");
    void read("models", controller.signal, brandId).then(rows => { if (!controller.signal.aborted) setModels(rows); }).catch(error => { if (!controller.signal.aborted) setError(error.message); }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [brandId]);
  const field = "w-full rounded-lg border border-white/20 bg-[#0d1117] px-3 py-2 disabled:opacity-40";
  return <details className="rounded-lg border border-white/10 p-3 text-sm" open={opened} onToggle={event => setOpened(event.currentTarget.open)}>
    <summary className="cursor-pointer font-bold">Model pomocniczy dla ofert bez rozpoznanego modelu (opcjonalnie)</summary>
    <p className="my-3 text-white/65">Np. gdy tytuly zawieraja tylko Citroen / Peugeot / Opel. Wybierz sprawdzony przez Ciebie model. Automat uzyje go tylko przy zgodnej marce i braku modelu w danych oferty. To nie jest potwierdzenie kompatybilnosci po numerze czesci.</p>
    <div className="grid gap-3 sm:grid-cols-2"><label>Marka pomocnicza<select aria-label="Marka pomocnicza" className={field} value={brandId} disabled={disabled || busy} onChange={event => { setBrandId(event.target.value); setModelId(""); setModels([]); onChange(undefined); }}><option value="">Bez modelu pomocniczego</option>{brands.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><label>Model pomocniczy<select aria-label="Model pomocniczy" className={field} value={modelId} disabled={disabled || busy || !models.length} onChange={event => { setModelId(event.target.value); onChange(event.target.value ? { brandId, modelId: event.target.value } : undefined); }}><option value="">Wybierz model</option>{models.map(row => <option key={row.id} value={row.id}>{row.name} {row.years}</option>)}</select></label></div>
    {busy && <p role="status">Pobieram slownik Ovoko...</p>}{error && <p role="status" className="text-amber-200">{error}</p>}
  </details>;
}
