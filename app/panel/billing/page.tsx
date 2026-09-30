import { CheckCircle2, CreditCard, LockKeyhole } from "lucide-react";

const plans = [
  {
    name: "Starter",
    price: "99 zł / mies.",
    description: "Dla jednej osoby, która przygotowuje i wystawia oferty.",
    features: ["1 konto Allegro", "do 300 aktywnych aukcji", "5 GB zdjęć"],
  },
  {
    name: "Pro",
    price: "249 zł / mies.",
    description: "Dla zespołu: przygotowanie aukcji osobno od wyceny.",
    features: ["3 użytkowników", "do 1500 aktywnych aukcji", "25 GB zdjęć"],
  },
  {
    name: "Warsztat+",
    price: "indywidualnie",
    description: "Dla większych sprzedawców z wieloma kontami i większym ruchem.",
    features: ["wiele kont Allegro", "limity ustalane ręcznie", "priorytetowe wsparcie"],
  },
];

export default function BillingPage() {
  return (
    <div className="grid gap-5">
      <header className="rounded-[1.7rem] border border-white/10 bg-white/[.055] p-6">
        <p className="text-sm font-black uppercase tracking-[.18em] text-[#ff8a3d]">
          Abonament
        </p>
        <h1 className="mt-2 text-3xl font-black tracking-tight md:text-4xl">
          Dostęp do programu ma zależeć od aktywnej subskrypcji.
        </h1>
        <p className="mt-2 max-w-3xl text-white/60">
          To będzie sprawdzane po stronie serwera. UI może pokazywać plan, ale
          decyzja o wystawianiu aukcji nie może zależeć od przeglądarki.
        </p>
      </header>

      <section className="grid gap-4 lg:grid-cols-3">
        {plans.map((plan) => (
          <article
            key={plan.name}
            className="rounded-[1.7rem] border border-white/10 bg-white/[.055] p-6"
          >
            <CreditCard className="h-6 w-6 text-[#ff8a3d]" />
            <h2 className="mt-4 text-2xl font-black">{plan.name}</h2>
            <p className="mt-1 text-3xl font-black text-[#ff8a3d]">{plan.price}</p>
            <p className="mt-3 min-h-16 leading-7 text-white/60">{plan.description}</p>
            <div className="mt-5 grid gap-3">
              {plan.features.map((feature) => (
                <p key={feature} className="flex gap-2 text-sm text-white/70">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-300" />
                  {feature}
                </p>
              ))}
            </div>
          </article>
        ))}
      </section>

      <section className="rounded-[1.7rem] border border-white/10 bg-white/[.055] p-6">
        <div className="flex gap-3">
          <LockKeyhole className="h-6 w-6 shrink-0 text-emerald-300" />
          <div>
            <h2 className="text-xl font-black">Bezpieczna zasada</h2>
            <p className="mt-2 leading-7 text-white/60">
              Nawet jeśli ktoś zmieni coś w przeglądarce, serwer przy publikacji
              jeszcze raz sprawdzi: organizację, użytkownika, status abonamentu,
              połączenie Allegro i limity planu.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
