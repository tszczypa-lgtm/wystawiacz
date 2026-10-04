"use client";

import { useEffect, useState } from "react";
import { accountRequest, type AccountInfo } from "@/lib/account-client";

export function AccessSummary() {
  const [info, setInfo] = useState<AccountInfo | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let mounted = true;
    void accountRequest<AccountInfo>("/me").then(result => { if (mounted) setInfo(result); }).catch(error => { if (mounted) setError(error.message); });
    return () => { mounted = false; };
  }, []);
  return <><p className="mt-3 text-white/65">{error || info?.access.reason || "Sprawdzam stan dostępu…"}</p>{info?.isAdmin && <a href="/panel/admin" className="mt-3 inline-block font-bold text-[#ff8a3d]">Zarządzaj kontami klientów</a>}</>;
}
