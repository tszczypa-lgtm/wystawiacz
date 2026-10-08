"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import { LogoutButton } from "./logout-button";

export function OriginalWystawiacz() {
  const frame = useRef<HTMLIFrameElement>(null);
  const [navigation, setNavigation] = useState<HTMLElement | null>(null);

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
    <main className="min-h-screen bg-[#f5f6f8]">
      {navigation && createPortal(<>
        <a href="/panel" target="_top" onClick={(event) => {
          if (!window.confirm("Wrócić do panelu konta? Przed wyjściem zapisz sesję w Wystawiaczu, aby nie stracić pracy.")) event.preventDefault();
        }}>Powrót do panelu konta</a>
        <LogoutButton />
      </>, navigation)}
      <iframe ref={frame} onLoad={() => setNavigation(frame.current?.contentDocument?.getElementById("accountNavigation") ?? null)} src="/wystawiacz/index.html" title="Wystawiacz Allegro" className="block h-screen w-full border-0" />
    </main>
  );
}
