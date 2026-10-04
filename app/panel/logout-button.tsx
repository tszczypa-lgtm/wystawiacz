"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase";

export function LogoutButton() {
  const [isLoading, setIsLoading] = useState(false);

  async function logout() {
    setIsLoading(true);
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    window.location.replace("/login");
  }

  return (
    <button
      className="mt-3 w-full rounded-2xl border border-white/10 px-4 py-3 text-sm font-black text-white/70 hover:bg-white/10 hover:text-white disabled:cursor-wait disabled:opacity-60"
      disabled={isLoading}
      onClick={logout}
      type="button"
    >
      {isLoading ? "Wylogowuje..." : "Wyloguj"}
    </button>
  );
}
