"use client";

import { useEffect, useState } from "react";
import { accountRequest, type AccountInfo } from "@/lib/account-client";

export function InventoryViews({ active }: { active: "allegro" | "ovoko" }) {
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    let mounted = true;
    void accountRequest<AccountInfo>("/me").then(info => { if (mounted) setAdmin(info.isAdmin); }).catch(() => {});
    return () => { mounted = false; };
  }, []);
  const style = (selected: boolean) => `rounded-lg border px-4 py-2 text-sm font-bold ${selected ? "border-[#ff5a00] bg-[#ff5a00] text-white" : "border-white/20 text-white/70 hover:bg-white/10"}`;
  return <nav aria-label="Widok portalu" className="mb-5 flex flex-wrap gap-2">
    <a href="/panel/inventory" aria-current={active === "allegro" ? "page" : undefined} className={style(active === "allegro")}>Allegro</a>
    {admin && <a href="/panel/inventory/ovoko" aria-current={active === "ovoko" ? "page" : undefined} className={style(active === "ovoko")}>Ovoko - podglad</a>}
  </nav>;
}
