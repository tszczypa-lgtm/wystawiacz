"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase";

type Draft = { id: string; title: string; part_number: string; manufacturer: string; description: string; price_cents: number | null; stock: number };
const empty = { title: "", part_number: "", manufacturer: "", description: "", price: "", stock: "1" };
const inputClass = "w-full rounded-xl border border-white/20 bg-[#172033] p-3 text-white";
function errorMessage(error: { code?: string; message: string }) {
  return error.code === "PGRST205" || error.code === "42P01"
    ? "Zapis nie jest jeszcze skonfigurowany: uruchom plik 001_listing_drafts.sql w SQL Editor w Supabase."
    : error.message;
}

export function DraftList() {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    async function read() {
      try {
        const { data, error } = await createSupabaseBrowserClient().from("listing_drafts").select("id,title,part_number,manufacturer,description,price_cents,stock").order("created_at", { ascending: false });
        if (!active) return;
        if (error) setMessage(errorMessage(error));
        else setDrafts(data ?? []);
      } catch (error) {
        if (active) setMessage(error instanceof Error ? error.message : "Nie udało się pobrać listy.");
      } finally { if (active) setBusy(false); }
    }
    void read();
    return () => { active = false; };
  }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const priceText = form.price.trim().replace(",", ".");
    const price = priceText ? Number(priceText) : null;
    const stock = Number(form.stock);
    if (!form.title.trim() || !Number.isInteger(stock) || stock < 1 || (price !== null && (!Number.isFinite(price) || price <= 0))) {
      setMessage("Podaj tytuł, poprawną liczbę sztuk i dodatnią cenę lub zostaw cenę pustą.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const client = createSupabaseBrowserClient();
      const values = {
        title: form.title.trim(), part_number: form.part_number.trim(), manufacturer: form.manufacturer.trim(),
        description: form.description || form.title.trim() + "\n\nCzęść używana, sprawna, stan jak na zdjęciach.",
        price_cents: price === null ? null : Math.round(price * 100), stock,
      };
      const query = editing ? client.from("listing_drafts").update(values).eq("id", editing) : client.from("listing_drafts").insert(values);
      const { data, error } = await query.select("id,title,part_number,manufacturer,description,price_cents,stock").single();
      if (error) { setMessage(errorMessage(error)); return; }
      setDrafts(current => editing ? current.map(item => item.id === editing ? data : item) : [data, ...current]);
      setOpen(false);
      setEditing(null);
      setForm(empty);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Zapis się nie udał."); }
    finally { setBusy(false); }
  }

  return (
    <div className="grid gap-5">
      <header className="rounded-3xl border border-white/10 bg-white/5 p-6">
        <h1 className="text-3xl font-black">Produkty do wystawienia</h1>
        <p className="mt-2 text-white/60">Zapisz produkt bez ceny. Wycenę możesz uzupełnić później przez Edytuj.</p>
        <button disabled={busy} onClick={() => { setEditing(null); setForm(empty); setOpen(true); }} className="mt-5 rounded-xl bg-[#ff5a00] px-5 py-3 font-bold disabled:opacity-50">Nowy produkt</button>
      </header>
      {message && <p role="alert" className="rounded-xl bg-amber-500/15 p-4 text-amber-200">{message}</p>}
      {open && <form onSubmit={save} className="grid gap-4 rounded-3xl border border-white/10 bg-white/5 p-6">
        <h2 className="text-xl font-bold">{editing ? "Edytuj produkt" : "Nowy produkt"}</h2>
        <label>Tytuł<input required maxLength={200} className={inputClass} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
        <label>Numer oryginału<input className={inputClass} value={form.part_number} onChange={e => setForm({ ...form, part_number: e.target.value })} /></label>
        <label>Producent części<input className={inputClass} value={form.manufacturer} onChange={e => setForm({ ...form, manufacturer: e.target.value })} /></label>
        <label>Opis<textarea rows={5} className={inputClass} placeholder="Puste pole: tytuł i informacja o stanie części" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></label>
        <label>Liczba sztuk<input type="number" min={1} step={1} required className={inputClass} value={form.stock} onChange={e => setForm({ ...form, stock: e.target.value })} /></label>
        <label>Cena PLN (opcjonalna)<input inputMode="decimal" className={inputClass} value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} /></label>
        <div className="flex gap-3"><button disabled={busy} className="rounded-xl bg-[#ff5a00] px-5 py-3 font-bold disabled:opacity-50">{busy ? "Zapisuję..." : "Zapisz produkt"}</button><button type="button" disabled={busy} onClick={() => setOpen(false)} className="rounded-xl border border-white/20 px-5 py-3">Anuluj</button></div>
      </form>}
      <p className="text-sm text-white/60">{drafts.length} produktów · {drafts.filter(item => item.price_cents === null).length} do wyceny</p>
      {!busy && !message && !drafts.length && <p className="p-6 text-white/60">Lista jest pusta. Dodaj pierwszy produkt.</p>}
      {drafts.map(item => <article key={item.id} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/5 p-5">
        <div><h2 className="font-bold">{item.title}</h2><p className="text-sm text-white/60">{item.manufacturer} · {item.part_number} · {item.stock} szt.</p></div>
        <p>{item.price_cents === null ? "Do wyceny" : (item.price_cents / 100).toFixed(2).replace(".", ",") + " zł"}</p>
        <button disabled={busy} className="rounded-xl border border-white/20 px-4 py-2" onClick={() => { setEditing(item.id); setForm({ title: item.title, part_number: item.part_number, manufacturer: item.manufacturer, description: item.description, stock: String(item.stock), price: item.price_cents === null ? "" : String(item.price_cents / 100) }); setOpen(true); }}>Edytuj</button>
      </article>)}
      <p className="text-sm text-white/45">Lista jest przypisana do Twojego konta. Zdjęcia, współpraca zespołu i publikacja na Allegro są jeszcze w przygotowaniu.</p>
    </div>
  );
}
