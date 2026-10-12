"use client";

import { useEffect, useState } from "react";
import { accountRequest, type AccountInfo } from "@/lib/account-client";

export function OffersAccess({ children }: { children: React.ReactNode }) {
  const [access, setAccess] = useState<{ allowed: boolean; reason: string } | null>(null);
  const [error, setError] = useState("");
  const [opened, setOpened] = useState(false);
  const [suspended, setSuspended] = useState(false);
  const [trialUntil, setTrialUntil] = useState<string | null>(null);
  useEffect(() => {
    let mounted = true;
    async function check() {
      try { const info = await accountRequest<AccountInfo>("/me"); if (mounted) { setAccess(info.access); setSuspended(info.account.suspended); setTrialUntil(info.account.trial_until || null); if (!info.account.suspended) setOpened(true); setError(""); } }
      catch (error) { if (mounted) setError((error as Error).message); }
    }
    void check();
    const timer = setInterval(check, 30000);
    return () => { mounted = false; clearInterval(timer); };
  }, []);
  // An already-open workspace stays mounted so a transient error cannot erase files.
  return <>
    {access && !access.allowed && !suspended && <div className="bg-amber-100 px-5 py-3 text-sm text-amber-950">{access.reason} Mozesz przygotowac i zapisac sesje, ale publikacja wymaga aktywnego dostepu. <a href="/panel/billing" className="underline">Abonament</a></div>}
    {trialUntil && Date.parse(trialUntil) > Date.now() && Date.parse(trialUntil) - Date.now() <= 3 * 86400000 && <div className="bg-amber-100 px-5 py-3 text-sm text-amber-950">Okres probny konczy sie w ciagu 3 dni. Sesje i aukcje pozostana bez zmian.</div>}
    {opened && children}
    {(!access || suspended || error) && <section className={`${opened ? "fixed inset-0 z-50 bg-[#0d1117]/95" : "min-h-screen bg-[#0d1117]"} grid place-items-center px-5 text-white`}>
      <div className="max-w-xl rounded-3xl border border-white/10 p-8">
        <h1 className="text-2xl font-black">{error || access?.reason || "Sprawdzam dostęp do Wystawiacza…"}</h1>
        <p className="mt-4 text-white/60">Panel konta i rozliczenia pozostają dostępne.</p>
        <a href="/panel/billing" className="mt-5 inline-block rounded-xl bg-[#ff5a00] px-5 py-3 font-bold">Abonament i rozliczenia</a>
        <a href="/panel" className="ml-4 inline-block text-[#ff8a3d]">Panel konta</a>
      </div>
    </section>}
  </>;
}
