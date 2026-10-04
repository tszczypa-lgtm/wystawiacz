"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let isMounted = true;
    const supabase = createSupabaseBrowserClient();

    supabase.auth.getSession().then(({ data, error }) => {
      if (!isMounted) {
        return;
      }

      if (error) {
        setError(error.message);
        return;
      }
      if (!data.session) {
        window.location.replace("/login");
        return;
      }

      setIsReady(true);
    }).catch((error) => {
      if (isMounted) setError(error instanceof Error ? error.message : "Nie udało się sprawdzić logowania.");
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        window.location.replace("/login");
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  if (!isReady) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#0d1117] px-5 text-center text-white">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.24em] text-[#ff8a3d]">
            Sprawdzam dostep
          </p>
          <p className="mt-3 text-2xl font-black">{error || "Ładuję panel..."}</p>
        </div>
      </div>
    );
  }

  return children;
}
