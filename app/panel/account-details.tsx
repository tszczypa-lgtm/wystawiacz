"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase";

export function AccountDetails() {
  const [email, setEmail] = useState("");
  useEffect(() => {
    let mounted = true;
    void createSupabaseBrowserClient().auth.getUser().then(({ data }) => {
      if (mounted) setEmail(data.user?.email || "");
    });
    return () => { mounted = false; };
  }, []);
  return <p className="mt-3 break-all text-white/65">{email ? `Zalogowany jako: ${email}` : "Twoje konto Wystawiacza"}</p>;
}
