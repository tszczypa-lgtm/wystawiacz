"use client";

import { useEffect, useRef } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import { LogoutButton } from "./logout-button";

export function OriginalWystawiacz() {
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const client = createSupabaseBrowserClient();
    async function receive(event: MessageEvent) {
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow || event.data?.type !== "wystawiacz-token-request" || typeof event.data.id !== "string") return;
      const source = frame.current.contentWindow;
      const { data } = await client.auth.getSession();
      source?.postMessage({ type: "wystawiacz-token", id: event.data.id, token: data.session?.access_token ?? null }, location.origin);
    }
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);

  return (
    <main className="min-h-screen bg-[#0d1117]">
      <div className="flex items-center justify-between gap-4 border-b border-white/10 px-5 pb-3 text-white">
        <a href="/panel" onClick={(event) => {
          if (!window.confirm("Wrócić do panelu konta? Przed wyjściem zapisz sesję w Wystawiaczu, aby nie stracić pracy.")) event.preventDefault();
        }} className="text-sm text-[#ff8a3d]">Powrót do panelu konta</a>
        <div className="w-36"><LogoutButton /></div>
      </div>
      <iframe ref={frame} src="/wystawiacz/index.html" title="Wystawiacz Allegro" className="block h-[calc(100vh-72px)] min-h-[600px] w-full border-0" />
    </main>
  );
}
