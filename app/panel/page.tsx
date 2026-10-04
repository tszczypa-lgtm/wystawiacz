import { AccountShell } from "./account-shell";
import { AccountDetails } from "./account-details";
import { AccessSummary } from "./access-summary";

export default function PanelPage() {
  return <AccountShell active="/panel">
    <section className="rounded-3xl border border-white/10 bg-white/5 p-6 md:p-8">
      <p className="text-sm font-bold uppercase tracking-widest text-[#ff8a3d]">Panel klienta</p>
      <h1 className="mt-3 text-3xl font-black">Twoje konto i narzędzia</h1>
      <AccountDetails />
      <a href="/panel/offers" className="mt-6 inline-block rounded-xl bg-[#ff5a00] px-6 py-4 font-bold">Otwórz Wystawiacza</a>
      <p className="mt-4 text-sm text-white/55">Zdjęcia, produkty, wycena i sesje w dotychczasowym układzie.</p>
    </section>
    <div className="mt-5 grid gap-5 lg:grid-cols-2">
      <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
        <h2 className="text-xl font-bold">Abonament</h2>
        <AccessSummary />
        <a href="/panel/billing" className="mt-5 inline-block font-bold text-[#ff8a3d]">Przejdź do abonamentu</a>
      </section>
      <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
        <h2 className="text-xl font-bold">Połączenie Allegro</h2>
        <p className="mt-3 text-white/65">Kategorie, parametry i szablony wymagają połączenia konta Allegro. Przygotowanie zdjęć, opisu i listy produktów działa bez niego.</p>
        <a href="/panel/allegro" className="mt-5 inline-block font-bold text-[#ff8a3d]">Informacje o połączeniu</a>
      </section>
    </div>
  </AccountShell>;
}
