"use client";

import { useEffect, useRef, useState } from "react";
import type { BulkOffer } from "./ovoko-bulk-panel";

export function OvokoBulkLauncher({ offers, onFinished }: { offers: BulkOffer[]; onFinished: () => void }) {
  const popup = useRef<Window | null>(null), cleanup = useRef<(() => void) | null>(null), finished = useRef(onFinished);
  const [opened, setOpened] = useState(false), [error, setError] = useState("");
  finished.current = onFinished;
  useEffect(() => () => { cleanup.current?.(); }, []);
  function open() {
    if (popup.current && !popup.current.closed) { popup.current.focus(); return; }
    if (!offers.length || offers.length > 100) return;
    const snapshot = offers.map(offer => ({ id: offer.id, name: offer.name, price: offer.price ? { amount: offer.price.amount, currency: offer.price.currency } : null }));
    const child = window.open("/panel/inventory/transfer-ovoko", "_blank", "popup,width=1150,height=900,scrollbars=yes,resizable=yes");
    if (!child) { setError("Przegladarka zablokowala nowe okno. Zezwol na wyskakujace okna dla Wystawiacza i kliknij ponownie."); return; }
    setError(""); setOpened(true); popup.current = child;
    let delivered = false;
    const release = () => { window.removeEventListener("message", receive); window.clearInterval(timer); popup.current = null; cleanup.current = null; setOpened(false); };
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== child) return;
      if (event.data?.type === "ovoko-bulk-ready" && !delivered) { delivered = true; child.postMessage({ type: "ovoko-bulk-selection", offers: snapshot }, window.location.origin); }
      if (event.data?.type === "ovoko-bulk-finished" && delivered) { release(); finished.current(); }
    };
    window.addEventListener("message", receive);
    const timer = window.setInterval(() => { if (child.closed) { release(); finished.current(); } }, 500);
    cleanup.current = () => { window.removeEventListener("message", receive); window.clearInterval(timer); };
  }
  return <div className="space-y-2">
    <button className="rounded-lg bg-[#ff5a00] px-4 py-2 font-bold disabled:opacity-40" disabled={!opened && (!offers.length || offers.length > 100)} onClick={open}>{opened ? "Pokaz okno przenoszenia" : "Przenies zaznaczone do Ovoko"}</button>
    {error && <p role="alert" className="text-sm text-amber-200">{error}</p>}
  </div>;
}
