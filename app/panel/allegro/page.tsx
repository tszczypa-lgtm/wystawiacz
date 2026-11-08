import { AccountShell } from "../account-shell";
import { AllegroConnection } from "./allegro-connection";

export default function AllegroPage() {
  return <AccountShell active="/panel/allegro"><section className="rounded-3xl border border-white/10 bg-white/5 p-6">
    <h1 className="text-3xl font-black">Połączenie Allegro</h1>
    <p className="mt-4 leading-7 text-white/65">Polacz konto, aby pobierac swoje oferty, cenniki wysylki i dane do wystawiania. Jezeli konto jest juz polaczone w Wystawiaczu, nie musisz laczyc go ponownie.</p>
    <AllegroConnection />
  </section></AccountShell>;
}
