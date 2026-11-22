"use client";

import { useEffect, useState } from "react";
import { accountRequest, type AccountInfo } from "@/lib/account-client";
import { OvokoBulkPanel, type BulkOffer } from "../ovoko-bulk-panel";

function selection(input: unknown): BulkOffer[] | null {
  if (!Array.isArray(input) || !input.length || input.length > 200) return null;
  const ids = new Set<string>();
  const output: BulkOffer[] = [];
  for (const row of input) {
    if (!row || typeof row.id !== "string" || !/^\d{1,30}$/.test(row.id) || ids.has(row.id) || typeof row.name !== "string" || row.name.length > 500) return null;
    if (row.price !== null && (!row.price || typeof row.price.amount !== "string" || !/^\d{1,10}(\.\d{1,2})?$/.test(row.price.amount) || typeof row.price.currency !== "string" || !/^[A-Z]{3}$/.test(row.price.currency))) return null;
    ids.add(row.id); output.push({ id: row.id, name: row.name, price: row.price === null ? null : { amount: row.price.amount, currency: row.price.currency } });
  }
  return output;
}

export function OvokoTransferWindow() {
  const [offers, setOffers] = useState<BulkOffer[] | null>(null), [allowed, setAllowed] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    let mounted = true;
    void accountRequest<AccountInfo>("/me").then(info => { if (mounted) { if (info.isAdmin) setAllowed(true); else setError("Przenoszenie Ovoko jest dostepne tylko dla administratora."); } }).catch(error => { if (mounted) setError(error.message); });
    return () => { mounted = false; };
  }, []);
  useEffect(() => {
    const parent = window.opener;
    if (!parent) { setError("Otworz to okno przyciskiem Przenies zaznaczone na liscie ofert."); return; }
    let received = false;
    const receive = (event: MessageEvent) => {
      if (received || event.origin !== window.location.origin || event.source !== parent || event.data?.type !== "ovoko-bulk-selection") return;
      const rows = selection(event.data.offers);
      if (!rows) { setError("Nieprawidlowe zaznaczenie. Zamknij okno i wybierz oferty ponownie."); return; }
      received = true; setOffers(rows); window.clearInterval(timer); window.clearTimeout(timeout);
    };
    window.addEventListener("message", receive);
    const ready = () => { if (!received && !parent.closed) parent.postMessage({ type: "ovoko-bulk-ready" }, window.location.origin); };
    const timer = window.setInterval(ready, 500);
    const timeout = window.setTimeout(() => { if (!received) { window.clearInterval(timer); setError("Nie odebrano zaznaczenia. Zamknij okno i otworz je ponownie z listy ofert."); } }, 15000);
    ready();
    return () => { window.removeEventListener("message", receive); window.clearInterval(timer); window.clearTimeout(timeout); };
  }, []);
  return <main className="min-h-screen bg-[#0d1117] p-3 text-white"><div className="mx-auto max-w-[1600px] space-y-3">
    <div className="flex items-center justify-between gap-3"><h1 className="text-2xl font-black">Przenoszenie do Ovoko</h1><button className="rounded-lg border border-white/20 px-3 py-2" onClick={() => window.close()}>Zamknij okno</button></div>
    {error ? <p role="alert" className="text-amber-200">{error}</p> : allowed && offers ? <OvokoBulkPanel offers={offers} onFinished={() => { if (window.opener && !window.opener.closed) window.opener.postMessage({ type: "ovoko-bulk-finished" }, window.location.origin); }} /> : <p role="status">Odbieram zaznaczone oferty i sprawdzam uprawnienia...</p>}
  </div></main>;
}
