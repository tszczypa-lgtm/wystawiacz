import { Building2, MapPin, Users } from "lucide-react";
import { getSupabasePublicConfig } from "@/lib/supabase";

export default function SettingsPage() {
  const supabase = getSupabasePublicConfig();

  return (
    <div className="grid gap-5">
      <header className="rounded-[1.7rem] border border-white/10 bg-white/[.055] p-6">
        <p className="text-sm font-black uppercase tracking-[.18em] text-[#ff8a3d]">
          Ustawienia firmy
        </p>
        <h1 className="mt-2 text-3xl font-black tracking-tight md:text-4xl">
          Dane wspólne dla całego konta.
        </h1>
        <p className="mt-2 max-w-3xl text-white/60">
          Tu trafią ustawienia lokalizacji, użytkowników, domyślnych opisów,
          modeli aut i zasad wystawiania.
        </p>
      </header>

      <section className="grid gap-4 lg:grid-cols-3">
        {[
          [Building2, "Firma", "Nazwa, dane konta i właściciel organizacji."],
          [Users, "Pracownicy", "Zaproszenia, role i dostęp do wyceny."],
          [MapPin, "Lokalizacja", "Domyślne miasto, kod pocztowy i województwo do ofert."],
        ].map(([Icon, title, text]) => {
          const DisplayIcon = Icon as typeof Building2;
          return (
            <article key={title as string} className="rounded-[1.7rem] border border-white/10 bg-white/[.055] p-6">
              <DisplayIcon className="h-6 w-6 text-[#ff8a3d]" />
              <h2 className="mt-4 text-xl font-black">{title as string}</h2>
              <p className="mt-2 leading-7 text-white/60">{text as string}</p>
            </article>
          );
        })}
      </section>

      <section className="rounded-[1.7rem] border border-white/10 bg-white/[.055] p-6">
        <h2 className="text-xl font-black">Backend Supabase</h2>
        <p className="mt-2 leading-7 text-white/60">
          Publiczna konfiguracja jest już przygotowana. Sekrety serwerowe
          dodamy dopiero w panelu hostingu/env, nie do kodu.
        </p>
        <div className="mt-4 grid gap-3 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm">
          <p>
            <span className="font-black text-white">Status: </span>
            <span className={supabase.isConfigured ? "text-emerald-300" : "text-red-300"}>
              {supabase.isConfigured ? "skonfigurowany" : "brak konfiguracji"}
            </span>
          </p>
          <p className="break-all text-white/60">
            <span className="font-black text-white">URL: </span>
            {supabase.url || "brak"}
          </p>
        </div>
      </section>
    </div>
  );
}
