"use client";

import { useEffect, useState } from "react";
import { accountRequest, type AccountInfo } from "@/lib/account-client";

export function OffersAccess({ children }: { children: React.ReactNode }) {
  const [access, setAccess] = useState<{ allowed: boolean; reason: string } | null>(null);
  const [error, setError] = useState("");
  const [opened, setOpened] = useState(false);
  useEffect(() => {
    let mounted = true;
    async function check() {
      try { const info = await accountRequest<AccountInfo>("/me"); if (mounted) { setAccess(info.access); if (info.access.allowed) setOpened(true); setError(""); } }
      catch (error) { if (mounted) setError((error as Error).message); }
    }
    void check();
    const timer = setInterval(check, 30000);
    return () => { mounted = false; clearInterval(timer); };
  }, []);
  // An already-open workspace stays mounted so a transient error cannot erase files.
  return <>
    {opened && children}
    {(!access || !access.allowed || error) && <section className={`${opened ? "fixed inset-0 z-50 bg-[#0d1117]/95" : "min-h-screen bg-[#0d1117]"} grid place-items-center px-5 text-white`}>
      <div className="max-w-xl rounded-3xl border border-white/10 p-8">
        <h1 className="text-2xl font-black">{error || access?.reason || "Sprawdzam dostęp do Wystawiacza…"}</h1>
        <p className="mt-4 text-white/60">Panel konta i rozliczenia pozostają dostępne.</p>
        <a href="/panel/billing" className="mt-5 inline-block rounded-xl bg-[#ff5a00] px-5 py-3 font-bold">Abonament i rozliczenia</a>
        <a href="/panel" className="ml-4 inline-block text-[#ff8a3d]">Panel konta</a>
      </div>
    </section>}
  </>;
}
