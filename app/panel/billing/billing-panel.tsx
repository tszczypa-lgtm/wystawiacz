"use client";

import { useEffect, useState } from "react";
import { CompanyFields } from "@/components/company-fields";
import { emptyCompany, validateCompany, companyForForm } from "@/lib/account-validation";
import { accountDate, accountRequest, type AccountInfo } from "@/lib/account-client";

export function BillingPanel() {
  const [info, setInfo] = useState<AccountInfo | null>(null);
  const [company, setCompany] = useState({ ...emptyCompany });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  async function refresh() {
    const result = await accountRequest<AccountInfo>("/me");
    setInfo(result);
    setCompany(companyForForm(result.account.company));
    return result;
  }
  useEffect(() => {
    let mounted = true;
    void accountRequest<AccountInfo>("/me").then(result => {
      if (mounted) { setInfo(result); setCompany(companyForForm(result.account.company)); }
    }).catch(error => { if (mounted) setMessage(error.message); });
    return () => { mounted = false; };
  }, []);
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try { const valid = validateCompany(company); await accountRequest("/company", "PUT", { company: valid }); setCompany(valid); setMessage("Dane firmy zapisane. Zmiany dotyczą przyszłych rozliczeń, nie już wystawionych dokumentów."); }
    catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  }
  async function payment(path: "/checkout" | "/portal") {
    setBusy(true); setMessage("");
    try {
      const result = await accountRequest<{ url: string }>(path, "POST");
      const url = new URL(result.url);
      const host = path === "/checkout" ? "checkout.stripe.com" : "billing.stripe.com";
      if (url.protocol !== "https:" || url.hostname !== host) throw new Error("Nieprawidłowy adres operatora płatności.");
      window.location.assign(url.href);
    } catch (error) { setMessage((error as Error).message); setBusy(false); }
  }
  return <div className="grid gap-5">
    <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
      <h1 className="text-3xl font-black">Abonament i rozliczenia</h1>
      {info ? <>
        <p className={`mt-4 font-bold ${info.access.allowed ? "text-emerald-300" : "text-amber-200"}`}>{info.access.reason}</p>
        <dl className="mt-5 grid gap-3 text-white/70">
          <div><dt>Stan abonamentu</dt><dd className="font-bold text-white">{({ none: "Brak abonamentu", active: "Aktywny", past_due: "Zaległa płatność", canceled: "Anulowany", incomplete: "Płatność niedokończona", unpaid: "Nieopłacony", trialing: "Okres próbny", paused: "Wstrzymany", incomplete_expired: "Płatność wygasła" } as Record<string, string>)[info.account.subscription_status] || info.account.subscription_status}</dd></div>
          {info.account.paid_until && <div><dt>Opłacony dostęp do</dt><dd>{accountDate(info.account.paid_until)}</dd></div>}
          {info.account.access_mode === "free" && <div><dt>Darmowy dostęp do</dt><dd>{accountDate(info.account.free_until)}</dd></div>}
        </dl>
        {info.account.cancel_at_period_end && <p className="mt-4 text-amber-200">Abonament nie odnowi się po końcu opłaconego okresu.</p>}
        {info.price && <p className="mt-5 text-2xl font-bold">{new Intl.NumberFormat("pl-PL", { style: "currency", currency: info.price.currency }).format(info.price.amount / 100)} / miesiąc</p>}
        {!info.billingEnabled && <p className="mt-4 text-white/60">{info.billingIssue ? "Zakup chwilowo niedostępny. Administrator musi sprawdzić konfigurację płatności." : "Zakup abonamentu nie jest jeszcze uruchomiony. Nie pobieramy opłaty za rejestrację."}</p>}
        <div className="mt-5 flex flex-wrap gap-3">
          {info.billingEnabled && !info.account.suspended && !info.isAdmin && info.account.access_mode !== "free" && info.account.subscription_status === "none" && <button disabled={busy} onClick={() => payment("/checkout")} className="rounded-xl bg-[#ff5a00] px-5 py-3 font-bold disabled:opacity-50">Kup abonament</button>}
          {info.billingEnabled && !info.account.suspended && ["canceled", "incomplete_expired"].includes(info.account.subscription_status) && <button disabled={busy} onClick={() => payment("/checkout")} className="rounded-xl bg-[#ff5a00] px-5 py-3 font-bold disabled:opacity-50">Wznów abonament</button>}
          {info.hasCustomer && <button disabled={busy} onClick={() => payment("/portal")} className="rounded-xl border border-white/20 px-5 py-3 font-bold disabled:opacity-50">Płatności, dokumenty i anulowanie</button>}
          <button disabled={checking || busy} onClick={async () => { setChecking(true); try { await refresh(); setMessage("Status odświeżony. Dostęp zmienia się dopiero po potwierdzeniu płatności przez operatora."); } catch (error) { setMessage((error as Error).message); } finally { setChecking(false); } }} className="rounded-xl border border-white/20 px-5 py-3 disabled:opacity-50">Sprawdź status</button>
        </div>
        <p className="mt-4 text-sm text-white/50">Powrót z płatności nie oznacza jeszcze aktywacji. Darmowy dostęp lub zawieszenie konta nie anuluje automatycznie istniejącego abonamentu.</p>
      </> : <p className="mt-4 text-white/60">Ładowanie konta…</p>}
    </section>
    {message && <p role="status" className="rounded-xl border border-amber-300/20 bg-amber-300/10 p-4 text-amber-100">{message}</p>}
    {info && <form onSubmit={save} className="rounded-3xl border border-white/10 bg-white/5 p-6">
      <CompanyFields value={company} onChange={setCompany} disabled={busy} />
      <button disabled={busy} className="mt-5 rounded-xl bg-[#ff5a00] px-5 py-3 font-bold disabled:opacity-50">Zapisz dane firmy</button>
    </form>}
  </div>;
}
