"use client";

import { useEffect, useState } from "react";
import { accountDate, accountRequest } from "@/lib/account-client";
import type { CompanyDetails } from "@/lib/account-validation";

type Customer = { owner_id: string; email: string; company: Partial<CompanyDetails>; isAdmin: boolean; suspended: boolean; access_mode: string; free_until: string | null; subscription_status: string; paid_until: string | null };
type Audit = { id: number; actor_id: string; target_id: string; action: string; reason: string; created_at: string };
const actions = { suspend: "Zawieś konto", resume: "Odwieś konto", grant_free: "Nadaj darmowy dostęp", revoke_free: "Cofnij darmowy dostęp" };

export function AdminPanel() {
  const [accounts, setAccounts] = useState<Customer[] | null>(null);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Customer | null>(null);
  const [action, setAction] = useState<keyof typeof actions>("grant_free");
  const [reason, setReason] = useState("");
  const [expiry, setExpiry] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function load(page: number) {
    const result = await accountRequest<{ accounts: Customer[] }>(`/admin/accounts?offset=${page}`);
    setAccounts(result.accounts); setOffset(page);
    const history = await accountRequest<{ entries: Audit[] }>("/admin/audit");
    setAudit(history.entries);
  }
  useEffect(() => {
    let mounted = true;
    void accountRequest<{ accounts: Customer[] }>("/admin/accounts").then(result => {
      if (mounted) setAccounts(result.accounts);
    }).catch(error => { if (mounted) setMessage(error.message); });
    void accountRequest<{ entries: Audit[] }>("/admin/audit").then(result => {
      if (mounted) setAudit(result.entries);
    }).catch(() => {});
    return () => { mounted = false; };
  }, []);
  async function apply(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || !window.confirm(`${actions[action]}: ${selected.email}? Zmiana nie anuluje płatnego abonamentu u operatora.`)) return;
    setBusy(true); setMessage("");
    try {
      await accountRequest("/admin/action", "POST", { target: selected.owner_id, action, reason, freeUntil: action === "grant_free" && expiry ? new Date(`${expiry}T23:59:59`).toISOString() : null });
      await load(offset); setSelected(null); setReason(""); setExpiry(""); setMessage("Zmiana zapisana w historii administratora.");
    } catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  }
  return <div className="grid gap-5">
    <header><p className="text-sm font-bold uppercase text-[#ff8a3d]">Tylko administrator</p><h1 className="mt-2 text-3xl font-black">Konta klientów</h1><p className="mt-3 text-white/60">Zawieszenie blokuje Wystawiacza i operacje Allegro. Nie kasuje produktów, nie usuwa konta i nie anuluje opłat w Stripe.</p></header>
    {message && <p role="status" className="rounded-xl border border-amber-300/20 bg-amber-300/10 p-4 text-amber-100">{message}</p>}
    {accounts ? <>
      <div className="grid gap-3">{accounts.map(customer => <article key={customer.owner_id} className="rounded-2xl border border-white/10 bg-white/5 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><h2 className="break-all font-bold">{customer.email}</h2><p className="mt-1 text-sm text-white/60">{customer.company.name || "Brak danych firmy"}{customer.company.nip && ` · NIP ${customer.company.nip}`}</p><p className="mt-2 text-sm text-white/60">{customer.suspended ? "Zawieszone" : "Niezawieszone"} · {customer.isAdmin ? "Administrator" : customer.access_mode === "free" ? `Darmowe do: ${accountDate(customer.free_until)}` : "Dostęp standardowy"} · Abonament: {customer.subscription_status}</p></div>
          {!customer.isAdmin && <button disabled={busy} onClick={() => { setSelected(customer); setReason(""); setExpiry(""); setAction(customer.suspended ? "resume" : "grant_free"); }} className="rounded-xl border border-[#ff8a3d]/40 px-4 py-2 text-[#ff8a3d] disabled:opacity-50">Zarządzaj</button>}
        </div>
      </article>)}</div>
      <div className="flex items-center gap-3">
        <button disabled={busy || offset === 0} className="rounded-xl border border-white/20 px-4 py-2 disabled:opacity-40" onClick={async () => { setBusy(true); try { await load(offset - 25); } catch (error) { setMessage((error as Error).message); } finally { setBusy(false); } }}>Poprzednia</button>
        <span className="text-sm text-white/60">Strona {offset / 25 + 1}</span>
        <button disabled={busy || accounts.length < 25} className="rounded-xl border border-white/20 px-4 py-2 disabled:opacity-40" onClick={async () => { setBusy(true); try { await load(offset + 25); } catch (error) { setMessage((error as Error).message); } finally { setBusy(false); } }}>Następna</button>
      </div>
    </> : <p className="text-white/60">{message ? "Panel wymaga nadania uprawnień administratora w bazie." : "Sprawdzam uprawnienia…"}</p>}
    {selected && <form onSubmit={apply} className="grid gap-4 rounded-3xl border border-[#ff8a3d]/40 bg-white/5 p-6">
      <h2 className="break-all text-xl font-bold">{selected.email}</h2>
      <label className="grid gap-2">Działanie<select value={action} disabled={busy} onChange={event => setAction(event.target.value as keyof typeof actions)} className="rounded-xl bg-[#182033] p-3">{Object.entries(actions).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      {action === "grant_free" && <label className="grid gap-2">Do kiedy? Puste pole oznacza bezterminowo.<input type="date" disabled={busy} value={expiry} onChange={event => setExpiry(event.target.value)} className="rounded-xl border border-white/20 bg-transparent p-3" /></label>}
      <label className="grid gap-2">Powód zmiany<textarea required minLength={3} maxLength={500} disabled={busy} value={reason} onChange={event => setReason(event.target.value)} className="rounded-xl border border-white/20 bg-transparent p-3" /></label>
      <div className="flex gap-3"><button disabled={busy} className="rounded-xl bg-[#ff5a00] px-5 py-3 font-bold disabled:opacity-50">Zapisz zmianę</button><button type="button" disabled={busy} onClick={() => setSelected(null)} className="px-4 py-3">Anuluj</button></div>
    </form>}
    {audit.length > 0 && <section className="rounded-3xl border border-white/10 p-6"><h2 className="text-xl font-bold">Historia zmian (ostatnie 100)</h2><div className="mt-4 grid gap-3">{audit.map(entry => <div key={entry.id} className="border-b border-white/10 pb-3 text-sm"><p>{new Date(entry.created_at).toLocaleString("pl-PL", { timeZone: "Europe/Warsaw" })} · {actions[entry.action as keyof typeof actions] || entry.action}</p><p className="mt-1 text-white/60">{accounts?.find(customer => customer.owner_id === entry.target_id)?.email || entry.target_id} · {entry.reason}</p></div>)}</div></section>}
  </div>;
}
