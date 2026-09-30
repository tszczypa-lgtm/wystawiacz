import { AlertTriangle, Camera, CheckCircle2, Clock3, Plus, UploadCloud } from "lucide-react";

const stats = [
  ["48", "aukcji w sesji"],
  ["11", "czeka na cenę"],
  ["37", "gotowych"],
  ["2", "wymaga poprawy"],
];

const listings = [
  {
    title: "Panel klimatyzacji Volkswagen Golf 5G0907044G",
    brand: "Volkswagen OE",
    status: "Gotowa",
    price: "89,00 zł",
    icon: CheckCircle2,
  },
  {
    title: "Drzwi lewe przednie Citroen C3",
    brand: "Citroen OE",
    status: "Do wyceny",
    price: "brak",
    icon: Clock3,
  },
  {
    title: "Przełącznik szyb Alfa Romeo Stelvio",
    brand: "Alfa Romeo OE",
    status: "Błąd parametrów",
    price: "200,00 zł",
    icon: AlertTriangle,
  },
];

export default function PanelPage() {
  return (
    <div className="grid gap-5">
      <header className="rounded-[1.7rem] border border-white/10 bg-white/[.055] p-6">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div>
            <p className="text-sm font-black uppercase tracking-[.18em] text-[#ff8a3d]">
              Panel pracy
            </p>
            <h1 className="mt-2 text-3xl font-black tracking-tight md:text-4xl">
              Sesja Październik 2026
            </h1>
            <p className="mt-2 max-w-2xl text-white/60">
              Tu wróci workflow ze starego programu: zdjęcia, tytuł, kategorie,
              parametry, opis, wycena i wystawianie.
            </p>
          </div>
          <button className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#ff5a00] px-5 py-3 font-black">
            <Plus className="h-4 w-4" />
            Nowa aukcja
          </button>
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-4">
        {stats.map(([value, label]) => (
          <div key={label} className="rounded-[1.4rem] border border-white/10 bg-white/[.055] p-5">
            <p className="text-3xl font-black">{value}</p>
            <p className="mt-1 text-sm text-white/55">{label}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <div className="overflow-hidden rounded-[1.7rem] border border-white/10 bg-white/[.055]">
          <div className="border-b border-white/10 p-5">
            <h2 className="text-xl font-black">Produkty do wystawienia</h2>
          </div>
          <div className="divide-y divide-white/10">
            {listings.map(({ title, brand, status, price, icon: Icon }) => (
              <article key={title} className="grid gap-4 p-5 md:grid-cols-[1fr_130px_130px_120px] md:items-center">
                <div>
                  <p className="font-black">{title}</p>
                  <p className="mt-1 text-sm text-white/50">
                    numer oryginału osobno, numer katalogowy części zgodnie z regułami Allegro
                  </p>
                </div>
                <p className="text-sm font-bold text-white/62">{brand}</p>
                <p className="flex items-center gap-2 text-sm font-black text-[#ff8a3d]">
                  <Icon className="h-4 w-4" />
                  {status}
                </p>
                <p className="font-black">{price}</p>
              </article>
            ))}
          </div>
        </div>

        <aside className="grid gap-4">
          <div className="rounded-[1.7rem] border border-white/10 bg-white/[.055] p-5">
            <Camera className="h-6 w-6 text-[#ff8a3d]" />
            <h3 className="mt-4 text-xl font-black">Zdjęcia</h3>
            <p className="mt-2 text-sm leading-6 text-white/58">
              W wersji webowej zdjęcia trafią do magazynu plików, żeby druga
              osoba mogła je widzieć przy wycenie.
            </p>
          </div>
          <div className="rounded-[1.7rem] border border-white/10 bg-white/[.055] p-5">
            <UploadCloud className="h-6 w-6 text-[#ff8a3d]" />
            <h3 className="mt-4 text-xl font-black">Wystawianie</h3>
            <p className="mt-2 text-sm leading-6 text-white/58">
              Serwer sprawdzi abonament, połączenie Allegro, cenę i wymagane
              parametry przed publikacją.
            </p>
          </div>
        </aside>
      </section>
    </div>
  );
}
