import { AccountShell } from "../account-shell";

export default function AllegroPage() {
  return <AccountShell active="/panel/allegro"><section className="rounded-3xl border border-white/10 bg-white/5 p-6">
    <h1 className="text-3xl font-black">Połączenie Allegro</h1>
    <p className="mt-4 leading-7 text-white/65">Połączenie wykonasz przyciskiem „Połącz z Allegro” w Wystawiaczu. Integracja wymaga aktywnej aplikacji Allegro i konfiguracji administratora. Bez połączenia nie pobierzemy kategorii, parametrów ani szablonów sprzedaży.</p>
    <p className="mt-4 text-white/65">Nie potrzebujesz własnych kluczy aplikacji. Dane konta i aktualny status połączenia zobaczysz w Wystawiaczu.</p>
    <a href="/panel/offers" className="mt-6 inline-block rounded-xl bg-[#ff5a00] px-5 py-3 font-bold">Otwórz Wystawiacza</a>
  </section></AccountShell>;
}
