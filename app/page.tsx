import {
  ArrowUpRight,
  BadgeCheck,
  Camera,
  CreditCard,
  LockKeyhole,
  PackageCheck,
  ShieldCheck,
  Store,
  Users,
} from "lucide-react";

const workflow = [
  "Dodajesz zdjęcia i numer części",
  "System podpowiada tytuł, kategorię i parametry",
  "Druga osoba uzupełnia cenę",
  "Oferta idzie na Allegro z poprawnymi szablonami",
];

const modules = [
  {
    icon: Users,
    title: "Konta pracowników",
    text: "Właściciel, osoba od przygotowania aukcji i osoba od wyceny mogą pracować na tej samej sesji.",
  },
  {
    icon: CreditCard,
    title: "Subskrypcja dostępu",
    text: "Dostęp do programu będzie zależny od aktywnego abonamentu, z miejscem na Stripe lub Przelewy24.",
  },
  {
    icon: Store,
    title: "Bezpieczne Allegro OAuth",
    text: "Tokeny Allegro zostają po stronie serwera, a użytkownik nie widzi sekretów aplikacji.",
  },
  {
    icon: Camera,
    title: "Zdjęcia i sesje",
    text: "Zdjęcia trafią do magazynu plików, a sesje aukcji zostaną przypisane do konta firmy.",
  },
];

const listingRows = [
  ["Panel klimatyzacji VW Golf 5G0907044G", "Volkswagen OE", "Gotowa", "89,00 zł"],
  ["Drzwi lewe przednie Citroen C3", "Citroen OE", "Do wyceny", "—"],
  ["Przełącznik szyb Alfa Romeo Stelvio", "Alfa Romeo OE", "Błąd parametrów", "200,00 zł"],
];

export default function Home() {
  return (
    <main className="min-h-screen bg-[#0d1117] text-white">
      <section className="relative overflow-hidden border-b border-white/10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_10%,rgba(255,91,0,.26),transparent_28%),radial-gradient(circle_at_75%_15%,rgba(44,123,229,.20),transparent_30%)]" />
        <div className="relative mx-auto flex w-full max-w-7xl flex-col gap-10 px-5 py-8 sm:px-8 lg:px-10">
          <nav className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-[#ff5a00] font-black">
                A
              </div>
              <div>
                <p className="text-lg font-black tracking-tight">Wystawiacz</p>
                <p className="text-sm text-white/55">SaaS do ofert Allegro</p>
              </div>
            </div>
            <div className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/70 sm:flex">
              <LockKeyhole className="h-4 w-4 text-[#ff8a3d]" />
              Dostęp przez abonament
            </div>
          </nav>

          <div className="grid gap-8 lg:grid-cols-[0.92fr_1.08fr] lg:items-center">
            <div className="max-w-2xl">
              <p className="mb-4 inline-flex rounded-full border border-[#ff5a00]/35 bg-[#ff5a00]/10 px-4 py-2 text-sm font-bold text-[#ffb38a]">
                Nowy start: wersja webowa pod sprzedaż dostępu
              </p>
              <h1 className="text-4xl font-black leading-[1.02] tracking-[-0.055em] sm:text-6xl">
                Program do wystawiania części jako normalna strona z logowaniem.
              </h1>
              <p className="mt-5 max-w-xl text-lg leading-8 text-white/68">
                To jest fundament produktu, który można sprzedawać klientom:
                konta użytkowników, abonamenty, panel pracy, integracja Allegro i
                przechowywanie sesji na serwerze.
              </p>
              <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                <a
                  href="#panel"
                  className="inline-flex items-center justify-center rounded-2xl bg-[#ff5a00] px-5 py-3 font-black text-white shadow-[0_16px_40px_rgba(255,90,0,.26)]"
                >
                  Zobacz panel produktu
                </a>
                <a
                  href="#architektura"
                  className="inline-flex items-center justify-center rounded-2xl border border-white/12 bg-white/6 px-5 py-3 font-bold text-white/80"
                >
                  Jak to będzie działać
                </a>
              </div>
            </div>

            <div id="panel" className="rounded-[2rem] border border-white/12 bg-white/[.07] p-4 shadow-2xl backdrop-blur">
              <div className="rounded-[1.5rem] bg-[#f6f7fb] p-4 text-[#172033]">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[.18em] text-[#ff5a00]">
                      Panel klienta
                    </p>
                    <h2 className="text-2xl font-black tracking-tight">Sesja: Październik 2026</h2>
                  </div>
                  <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-black text-emerald-700">
                    Pro aktywny
                  </span>
                </div>

                <div className="grid gap-3 sm:grid-cols-4">
                  {["48 aukcji", "11 do wyceny", "37 gotowych", "2 błędy"].map((item) => (
                    <div key={item} className="rounded-2xl bg-white p-3 shadow-sm">
                      <p className="text-sm font-black">{item}</p>
                      <p className="mt-1 text-xs text-slate-500">bieżąca sesja</p>
                    </div>
                  ))}
                </div>

                <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white">
                  {listingRows.map(([title, brand, status, price]) => (
                    <div
                      key={title}
                      className="grid gap-3 border-b border-slate-100 p-4 last:border-b-0 sm:grid-cols-[1fr_120px_120px_90px] sm:items-center"
                    >
                      <div>
                        <p className="font-black">{title}</p>
                        <p className="text-sm text-slate-500">numer oryginału zostaje osobno od tytułu</p>
                      </div>
                      <p className="text-sm font-bold text-slate-600">{brand}</p>
                      <p className="text-sm font-black text-[#ff5a00]">{status}</p>
                      <p className="text-sm font-black">{price}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="architektura" className="mx-auto grid w-full max-w-7xl gap-6 px-5 py-12 sm:px-8 lg:grid-cols-[.9fr_1.1fr] lg:px-10">
        <div>
          <p className="text-sm font-black uppercase tracking-[.18em] text-[#ff8a3d]">Fundament SaaS</p>
          <h2 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">
            Budujemy tak, żeby później nie przepisywać wszystkiego.
          </h2>
          <p className="mt-4 text-lg leading-8 text-white/62">
            Stary program zostaje prototypem roboczym. Nowa wersja od początku
            ma rozdzielone konto firmy, użytkowników, subskrypcję, zdjęcia,
            aukcje i połączenie Allegro.
          </p>
          <div className="mt-6 rounded-3xl border border-white/10 bg-white/[.04] p-5">
            {workflow.map((step, index) => (
              <div key={step} className="flex gap-4 border-b border-white/10 py-3 last:border-b-0">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#ff5a00] text-sm font-black">
                  {index + 1}
                </span>
                <p className="font-bold text-white/82">{step}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {modules.map(({ icon: Icon, title, text }) => (
            <article key={title} className="rounded-3xl border border-white/10 bg-white/[.055] p-5">
              <Icon className="h-7 w-7 text-[#ff8a3d]" />
              <h3 className="mt-4 text-xl font-black">{title}</h3>
              <p className="mt-2 leading-7 text-white/62">{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-5 pb-14 sm:px-8 lg:px-10">
        <div className="grid gap-4 rounded-[2rem] border border-white/10 bg-white/[.055] p-6 md:grid-cols-3">
          <div className="flex gap-3">
            <ShieldCheck className="h-6 w-6 shrink-0 text-emerald-300" />
            <p className="text-white/70">Sekrety Allegro i płatności nie trafią do przeglądarki.</p>
          </div>
          <div className="flex gap-3">
            <PackageCheck className="h-6 w-6 shrink-0 text-emerald-300" />
            <p className="text-white/70">Sesje ofert będą zapisywane na koncie firmy.</p>
          </div>
          <div className="flex gap-3">
            <BadgeCheck className="h-6 w-6 shrink-0 text-emerald-300" />
            <p className="text-white/70">Abonament odblokuje wystawianie i limity konta.</p>
          </div>
        </div>
        <a href="#panel" className="mt-6 inline-flex items-center gap-2 text-sm font-black text-[#ff8a3d]">
          Następny etap: realne logowanie i płatności
          <ArrowUpRight className="h-4 w-4" />
        </a>
      </section>
    </main>
  );
}
