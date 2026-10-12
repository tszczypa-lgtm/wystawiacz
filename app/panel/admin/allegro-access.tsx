"use client";
import { useState } from "react";
import { accountRequest } from "@/lib/account-client";

export function AllegroAccess({ owner }: { owner: string }) {
  const [open, setOpen] = useState(false), [limit, setLimit] = useState(1), [remove, setRemove] = useState("");
  const [sellers, setSellers] = useState<{ seller_id: string }[]>([]), [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  async function load() {
    setBusy(true); setMessage("");
    try {
      const result = await accountRequest<{ sellers: { seller_id: string }[]; accounts: { allegro_account_limit: number }[] }>(`/admin/allegro?target=${owner}`);
      setSellers(result.sellers); setLimit(result.accounts[0]?.allegro_account_limit || 1); setOpen(true);
    } catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  }
  return <div className="mt-3">
    <button disabled={busy} onClick={() => void load()} className="rounded-xl border border-white/20 px-4 py-2">Konta Allegro</button>
    {message && <p role="status" className="mt-2 text-sm text-amber-200">{message}</p>}
    {open && <form className="mt-3 grid gap-3" onSubmit={async event => {
      event.preventDefault();
      if (remove && !window.confirm("Zwolnic powiazanie i odlaczyc obecne polaczenie Allegro tej firmy? Aukcje pozostana bez zmian.")) return;
      setBusy(true);
      try { await accountRequest("/admin/allegro", "POST", { target: owner, limit, remove: remove || null, reason }); setOpen(false); setRemove(""); setReason(""); setMessage("Zapisano limit i historie zmiany."); }
      catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
    }}>
      <label>Dozwolona liczba kont Allegro<input className="ml-3 rounded bg-[#182033] p-2" type="number" min={1} max={10} value={limit} disabled={busy} onChange={event => setLimit(Number(event.target.value))} /></label>
      <label>Zwolnij konto do zastapienia<select className="ml-3 rounded bg-[#182033] p-2" value={remove} disabled={busy} onChange={event => setRemove(event.target.value)}><option value="">Nie zwalniaj zadnego</option>{sellers.map(seller => <option key={seller.seller_id} value={seller.seller_id}>ID {seller.seller_id}</option>)}</select></label>
      <label>Powod zmiany<input required minLength={3} maxLength={500} className="ml-3 rounded bg-[#182033] p-2" value={reason} disabled={busy} onChange={event => setReason(event.target.value)} /></label>
      <div className="flex gap-3"><button disabled={busy} className="rounded bg-[#ff5a00] px-4 py-2">Zapisz</button><button type="button" onClick={() => setOpen(false)}>Zamknij</button></div>
    </form>}
  </div>;
}
