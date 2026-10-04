"use client";

import { useEffect, useState } from "react";
import { accountRequest, type AccountInfo } from "@/lib/account-client";

export function AdminLink() {
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    let mounted = true;
    void accountRequest<AccountInfo>("/me").then(info => { if (mounted) setAdmin(info.isAdmin); }).catch(() => {});
    return () => { mounted = false; };
  }, []);
  return admin ? <a href="/panel/admin" className="rounded-xl border border-[#ff8a3d]/40 px-4 py-3 font-bold text-[#ff8a3d]">Administrator</a> : null;
}
