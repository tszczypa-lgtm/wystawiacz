import { KeyRound, PlugZap, RefreshCcw, ShieldCheck } from "lucide-react";

const checks = [
  "Client Secret zostaje na serwerze",
  "Tokeny Allegro są szyfrowane",
  "Każda firma ma osobne połączenie",
  "Zakresy uprawnień są kontrolowane przed wystawianiem",
];

export default function AllegroPage() {
  return (
    <div className="grid gap-5">
      <header className="rounded-[1.7rem] border border-white/10 bg-white/[.055] p-6">
        <p className="text-sm font-black uppercase tracking-[.18em] text-[#ff8a3d]">
          Integracja Allegro
        </p>
        <h1 className="mt-2 text-3xl font-black tracking-tight md:text-4xl">
          Konto Allegro łączymy przez backend, nie przez lokalny program.
        </h1>
        <p className="mt-2 max-w-3xl text-white/60">
          To jest główna różnica względem wersji EXE. Użytkownik loguje się do
          Allegro, ale sekret aplikacji i tokeny nie są dostępne w przeglądarce.
        </p>
      </header>

      <section className="grid gap-5 lg:grid-cols-[1fr_380px]">
        <div className="rounded-[1.7rem] border border-white/10 bg-white/[.055] p-6">
          <PlugZap className="h-7 w-7 text-[#ff8a3d]" />
          <h2 className="mt-4 text-2xl font-black">Połącz konto sprzedawcy</h2>
          <p className="mt-2 leading-7 text-white/60">
            Docelowo przycisk rozpocznie OAuth Allegro. Po połączeniu serwer
            pobierze kategorie, parametry obowiązkowe, szablony dostawy, zwroty,
            reklamacje, gwarancje i producentów odpowiedzialnych.
          </p>
          <button className="mt-6 rounded-2xl bg-[#ff5a00] px-5 py-3 font-black">
            Rozpocznij połączenie Allegro
          </button>
        </div>

        <aside className="rounded-[1.7rem] border border-white/10 bg-white/[.055] p-6">
          <ShieldCheck className="h-7 w-7 text-emerald-300" />
          <h2 className="mt-4 text-xl font-black">Zasady bezpieczeństwa</h2>
          <div className="mt-5 grid gap-3">
            {checks.map((check) => (
              <p key={check} className="flex gap-2 text-sm text-white/70">
                <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-emerald-300" />
                {check}
              </p>
            ))}
          </div>
        </aside>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-[1.7rem] border border-white/10 bg-white/[.055] p-5">
          <KeyRound className="h-6 w-6 text-[#ff8a3d]" />
          <h3 className="mt-4 text-xl font-black">Tokeny</h3>
          <p className="mt-2 leading-7 text-white/60">
            W bazie trzymamy tylko zaszyfrowane tokeny i datę wygaśnięcia. Przy
            odświeżaniu serwer używa refresh tokenu, bez udziału użytkownika.
          </p>
        </div>
        <div className="rounded-[1.7rem] border border-white/10 bg-white/[.055] p-5">
          <RefreshCcw className="h-6 w-6 text-[#ff8a3d]" />
          <h3 className="mt-4 text-xl font-black">Dane konta</h3>
          <p className="mt-2 leading-7 text-white/60">
            Po połączeniu będziemy synchronizować profile wysyłki, zwroty,
            reklamacje, gwarancje i słowniki parametrów.
          </p>
        </div>
      </section>
    </div>
  );
}
