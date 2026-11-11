"use client";

import { useEffect, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase";

export function BetaWorkspace() {
  const frame = useRef<HTMLIFrameElement>(null);
  const [owner, setOwner] = useState("");
  const [message, setMessage] = useState("Sprawdzam dostep do bety...");
  useEffect(() => {
    let mounted = true;
    const client = createSupabaseBrowserClient();
    void client.auth.getSession().then(async ({ data }) => {
      if (!data.session) throw new Error("Zaloguj sie ponownie.");
      const response = await fetch("/api/beta/status", { headers: { Authorization: `Bearer ${data.session.access_token}` }, cache: "no-store" });
      const result = await response.json() as { owner?: string; allowed?: boolean; message?: string };
      if (!response.ok || !result.allowed || !result.owner || result.owner !== data.session.user.id) throw new Error(result.message || "Brak dostepu do bety.");
      if (mounted) setOwner(result.owner);
    }).catch(error => { if (mounted) setMessage(error.message); });
    async function receive(event: MessageEvent) {
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow || event.data?.type !== "wystawiacz-token-request" || typeof event.data.id !== "string") return;
      const source = frame.current.contentWindow;
      const { data } = await client.auth.getSession();
      source?.postMessage({ type: "wystawiacz-token", id: event.data.id, token: data.session?.user.id === owner ? data.session.access_token : null }, location.origin);
    }
    window.addEventListener("message", receive);
    return () => { mounted = false; window.removeEventListener("message", receive); };
  }, [owner]);
  if (!owner) return <main className="grid min-h-screen place-items-center bg-[#0d1117] p-6 text-white"><div><h1 className="text-2xl font-bold">{message}</h1><a href="/panel" className="mt-4 block text-orange-400">Wroc do panelu</a></div></main>;
  return <iframe ref={frame} src={`/wystawiacz-beta/index.html#owner=${encodeURIComponent(owner)}`} title="Wystawiacz Beta - przygotowanie aukcji" allow="microphone" className="block h-screen w-full border-0" />;
}
