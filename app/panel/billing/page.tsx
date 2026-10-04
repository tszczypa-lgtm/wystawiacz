import { AccountShell } from "../account-shell";

export default function BillingPage() {
  return <AccountShell active="/panel/billing"><section className="rounded-3xl border border-white/10 bg-white/5 p-6">
    <h1 className="text-3xl font-black">Abonament</h1>
    <p className="mt-4 leading-7 text-white/65">Płatności nie są jeszcze uruchomione. Ta wersja robocza nie pobiera opłat.</p>
    <dl className="mt-6 grid gap-4 rounded-2xl bg-black/20 p-5">
      <div><dt className="text-white/50">Dostęp</dt><dd className="mt-1 font-bold">Wersja robocza</dd></div>
      <div><dt className="text-white/50">Płatny abonament</dt><dd className="mt-1">Nieaktywny</dd></div>
      <div><dt className="text-white/50">Płatności i faktury</dt><dd className="mt-1">Jeszcze niedostępne. Nie zapisujemy danych karty.</dd></div>
    </dl>
  </section></AccountShell>;
}
