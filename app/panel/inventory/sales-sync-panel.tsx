"use client";

import { useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import type { salesSyncControl } from "@/lib/sales-sync";

type Status = Awaited<ReturnType<typeof salesSyncControl>>;
const button = "rounded border border-white/20 px-2 py-1 text-xs disabled:opacity-40";
const states: Record<string, string> = { waiting: "Czeka na dane zamowienia", queued: "W kolejce", preflight: "Kontrola przed zapisem", running: "Zapis w toku lub niepotwierdzony", submitted: "Czeka na potwierdzenie Ovoko", done: "Wycofano - potwierdzone", review: "Do sprawdzenia recznie", uncertain: "Niepewny wynik - bez ponawiania" };
const reasons: Record<string, string> = { confirmed_withdrawn: "Status Wycofany odczytany z Ovoko.", cancelled_no_relist: "Anulowano zakup. Nie wznawiamy oferty automatycznie.", target_sold_reserved_or_unknown: "Ovoko: sprzedano, zarezerwowano lub nieznany status.", publication_changed: "Powiazanie lub generacja publikacji zmienily sie.", multiple_purchases_or_missing_order: "Kilka zakupow albo brak numeru zamowienia.", order_cancelled_or_unknown: "Zamowienie anulowane lub niepotwierdzony status.", purchase_not_confirmed: "Nie potwierdzono zakupu tej pojedynczej sztuki.", not_last_single_unit: "Nie potwierdzono ostatniej pojedynczej sztuki Allegro.", target_changed_before_write: "Status Ovoko zmienil sie przed zapisem.", preflight_or_readback_failed: "Nie potwierdzono danych lub odczytu wyniku.", write_not_confirmed_no_retry: "Sprawdz Ovoko. Automat nie powtorzy zapisu.", awaiting_readback: "Zapis przyjety; czeka na odczyt statusu." };
export function SalesSyncPanel() {
  const [status, setStatus] = useState<Status>(), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [receivedAt, setReceivedAt] = useState(0);
  const lock = useRef(false);
  async function request(operation: "status" | "enable" | "disable") {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const { data } = await createSupabaseBrowserClient().auth.getSession();
      if (!data.session) throw new Error("Zaloguj sie do Wystawiacza.");
      const response = await fetch("/api/ovoko/sales-sync", { method: "POST", cache: "no-store", headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ operation, ...(operation === "enable" ? { confirm: true } : {}) }) });
      const body = await response.json() as Status & { message?: string };
      if (!response.ok) throw new Error(body.message || "Nie potwierdzono ustawien automatu.");
      if (body.direction !== "allegro_to_ovoko" || !Array.isArray(body.jobs)) throw new Error("Nieprawidlowy status synchronizacji.");
      setStatus(body);
      setReceivedAt(Date.now());
    } catch (e) { setError(e instanceof Error ? e.message : "Nie potwierdzono ustawien."); }
    finally { lock.current = false; setBusy(false); }
  }
  const fresh = status?.lastChecked && receivedAt - Date.parse(status.lastChecked) < 180000;
  return <details open className="rounded border border-white/15 p-2 text-xs" onToggle={event => { if (event.currentTarget.open && !status && !lock.current) void request("status"); }}>
    <summary className="cursor-pointer font-semibold">Synchronizacja Allegro → Ovoko{status ? `: ${status.enabled && status.configured ? fresh && status.caughtUp && !status.lastError ? "ostatnia kontrola OK" : "wlaczona - sprawdz wynik" : "wylaczona"}` : ""}</summary>
    <div className="mt-2 space-y-2">
      <p>Po wlaczeniu: nowe zakupy ostatniej pojedynczej sztuki Allegro wycofuja dokladnie powiazana czesc Ovoko. Bez usuwania zdjec, bez wznawiania po anulowaniu. Dziala w tle; to nie jest gwarancja natychmiastowej ochrony przed jednoczesnym zakupem.</p>
      <p className="text-amber-200">Reczne wycofanie nie oznacza sprzedazy. Kazdy kierunek ma osobna zgode. Przy obu wlaczonych kierunkach kontrole sa naprzemienne, zwykle co ok. 2 minuty dla jednego konta; kolejki i bledy wydluzaja czas.</p>
      {status && <p>Ostatni odczyt: {status.lastChecked ? new Date(status.lastChecked).toLocaleString("pl-PL", { timeZone: "Europe/Warsaw" }) : "jeszcze nie wykonano kontroli w tle"}. {!status.caughtUp && status.enabled && "Odczyt zaleglych zdarzen - zapisy wstrzymane."}</p>}
      {status && !status.configured && <p className="text-amber-200">Wymagana migracja 016, SALES_SYNC_ENABLED=true i harmonogram Cloudflare co minute.</p>}
      {status?.lastError && <p role="alert" className="text-amber-200">{status.lastError}</p>}
      {error && <p role="alert" className="text-amber-200">{error}</p>}
      <div className="flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={() => void request("status")}>Odswiez status Allegro → Ovoko</button>{status && <button className={button} disabled={busy || !status.enabled && !status.configured} onClick={() => void request(status.enabled ? "disable" : "enable")}>{status.enabled ? "Wylacz Allegro → Ovoko" : "Wlacz Allegro → Ovoko od teraz"}</button>}</div>
      {busy && <p role="status">Sprawdzam ustawienia...</p>}
      {!!status?.jobs.length && <div className="max-h-48 overflow-auto"><table className="w-full text-left text-xs" aria-label="Dziennik automatu"><tbody>{status.jobs.map(job => <tr className="border-t border-white/10" key={String(job.id)}><td className="p-1">Allegro {String(job.offer_id)} / Ovoko {String(job.part_id)}</td><td className="p-1">{states[String(job.state)] || "Nieznany wynik"}</td><td className="p-1">{reasons[String(job.diagnostic)] || ""}</td></tr>)}</tbody></table></div>}
    </div>
  </details>;
}
