"use client";
import { useEffect, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import type { reverseSyncControl } from "@/lib/reverse-sales-sync";

type Status = Awaited<ReturnType<typeof reverseSyncControl>>;
async function fetchStatus(operation: string) {
  const session = await createSupabaseBrowserClient().auth.getSession(); if (!session.data.session) throw new Error("Zaloguj sie ponownie.");
  const response = await fetch("/api/ovoko/reverse-sales-sync", { method: "POST", cache: "no-store", headers: { Authorization: `Bearer ${session.data.session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ operation, ...(operation === "enable" ? { confirm: true } : {}) }) });
  const value = await response.json() as Status & { message?: string }; if (!response.ok) throw new Error(value.message || "Nie potwierdzono synchronizacji Ovoko. Sprawdz migracje 018 i 022."); return value;
}
export function ReverseSyncPanel() {
  const [data, setData] = useState<Status>(), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const lock = useRef(false);
  async function request(operation: string) {
    if (lock.current) return; lock.current = true; setBusy(true); setError("");
    try { setData(await fetchStatus(operation)); }
    catch (e) { setError((e as Error).message); } finally { lock.current = false; setBusy(false); }
  }
  useEffect(() => {
    let active = true;
    void fetchStatus("status").then(value => { if (active) setData(value); }).catch(e => { if (active) setError((e as Error).message); });
    return () => { active = false; };
  }, []);
  return <section className="space-y-2 rounded border border-white/15 p-3 text-xs" aria-label="Synchronizacja Ovoko do Allegro">
    <h2 className="font-bold">Synchronizacja Ovoko → Allegro: {data ? data.enabled ? "wlaczona" : "wylaczona" : "status niepotwierdzony"}</h2>
    <p>Zakres: wszystkie powiazane czesci Allegro i Ovoko. Nowe przeniesienia dolaczaja automatycznie, bez ponownego wlaczania synchronizacji. Nie ma limitu 5 ani 499 czesci.</p>
    <p>Nowe zamowienie z Ovoko oraz potwierdzony status Sprzedano koncza dokladnie powiazana oferte Allegro po sprawdzeniu jej aktualnego stanu. Reczne wycofanie i sama zmiana statusu nie wystarczaja. Nie usuwamy i nie wznawiamy ofert.</p>
    <p className="text-amber-200">Obslugujemy potwierdzony status zamowienia NEW. Inne statusy i konflikty trafiaja do sprawdzenia. Dotychczasowe zamowienia pozostaja pominiete; nie wycofujemy ponownie historii. Czesc bez potwierdzonego powiazania nie moze automatycznie zakonczyc obcej aukcji.</p>
    {data && <p>Powiazania w rejestrze tych kont: <strong>{data.linkedCount ?? "niepotwierdzone"}</strong>. Niepotwierdzone przeniesienia: {data.blockedCount ?? "niepotwierdzone"}. Ostatnia kontrola: {data.lastChecked ? new Date(data.lastChecked).toLocaleString("pl-PL", { timeZone: "Europe/Warsaw" }) : "oczekuje"}.</p>}
    {(error || data?.lastError) && <p role="alert" className="text-amber-200">{error || data?.lastError}</p>}
    <div className="flex gap-2">
      <button disabled={busy} className="rounded border border-white/20 p-1 disabled:opacity-40" onClick={() => void request("status")}>Odswiez status Ovoko → Allegro</button>
      {data && <button disabled={busy || !data.configured && !data.enabled} className="rounded border border-white/20 p-1 disabled:opacity-40" onClick={() => void request(data.enabled ? "disable" : "enable")}>{data.enabled ? "Wylacz Ovoko → Allegro" : "Wlacz Ovoko → Allegro od teraz"}</button>}
      {!data && error && <button disabled={busy} className="rounded border border-white/20 p-1 disabled:opacity-40" onClick={() => void request("disable")}>Wylacz Ovoko → Allegro</button>}
    </div>
    <div className="max-h-48 overflow-auto">{data?.jobs.map(j => <p key={String(j.id)} className="border-t border-white/10 py-1">A: {String(j.offer_id)} / O: {String(j.part_id)} — {String(j.state)} {j.diagnostic ? `(${String(j.diagnostic)})` : ""}</p>)}</div>
  </section>;
}
