"use client";

import { useEffect, useRef, useState } from "react";
import { accountRequest, type AccountInfo } from "@/lib/account-client";
import { allegroRequest } from "@/lib/allegro-client";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import { initialOvokoDraft, offerDescriptionText, ovokoPreparationIssues, ovokoSourcePreview, type OvokoPreparationDraft, type OvokoSourcePreview } from "@/lib/ovoko-preparation";
import type { OvokoReadResult, OvokoReadRow } from "@/lib/ovoko-read";

const button = "rounded-lg border border-white/20 px-3 py-2 text-sm font-bold disabled:opacity-40";
const field = "mt-1 w-full rounded-lg border border-white/20 bg-[#0d1117] px-3 py-2 text-white";
export function OvokoPreparationPanel() {
  const [source, setSource] = useState<OvokoSourcePreview | null>(null), [draft, setDraft] = useState<OvokoPreparationDraft | null>(null);
  const [busy, setBusy] = useState(true), [error, setError] = useState(""), [dictionaryError, setDictionaryError] = useState("");
  const [dictionaries, setDictionaries] = useState<Record<string, OvokoReadRow[]>>({}), [dictionaryBusy, setDictionaryBusy] = useState(false);
  const [shippingName, setShippingName] = useState("");
  const active = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController(); active.current = controller;
    void (async () => {
      try {
        const ids = new URL(window.location.href).searchParams.getAll("offerId");
        if (ids.length !== 1 || !/^\d{1,30}$/.test(ids[0])) throw new Error("Wybierz jedna oferte z listy Allegro.");
        const info = await accountRequest<AccountInfo>("/me");
        if (!info.isAdmin) throw new Error("Przygotowanie Ovoko jest na razie dostepne tylko dla administratora.");
        if (controller.signal.aborted) return;
        const offer = await allegroRequest<unknown>(`/own-offers/${ids[0]}`, { signal: controller.signal });
        const preview = ovokoSourcePreview(offer, ids[0], offerDescriptionText);
        if (!controller.signal.aborted) { setSource(preview); setDraft(initialOvokoDraft(preview)); }
      } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Nie udalo sie pobrac oferty."); }
      finally { if (!controller.signal.aborted) setBusy(false); }
    })();
    return () => { controller.abort(); active.current?.abort(); };
  }, []);
  function change(name: keyof OvokoPreparationDraft, value: string) { setDraft(previous => previous ? { ...previous, [name]: value } : null); }
  const categoryMap = new Map((dictionaries.categories || []).map(row => [row.id, row]));
  function dictionaryLabel(operation: string, row: OvokoReadRow) {
    const names = [row.name], seen = new Set([row.id]); let parent = row.parentId;
    while (operation === "categories" && parent && parent !== "0" && !seen.has(parent) && seen.size < 3) {
      seen.add(parent); const item = categoryMap.get(parent); names.unshift(item?.name || `Rodzic ID ${parent}`); parent = item?.parentId;
    }
    return `${names.join(" / ")} (ID ${row.id})`;
  }
  async function readDictionary(operation: "categories" | "qualities" | "statuses" | "shipping") {
    if (dictionaryBusy || !source) return;
    const controller = new AbortController(); active.current = controller; setDictionaryBusy(true); setDictionaryError("");
    try {
      if (operation === "shipping") {
        const data = await allegroRequest<{ shippingRates: { id: string; name: string }[] }>("/shipping-rates", { signal: controller.signal });
        const name = data.shippingRates?.find(rate => rate.id === source.shippingRateId)?.name;
        if (!name) throw new Error("Nie znaleziono nazwy cennika Allegro. ID pozostaje widoczne; niczego nie przypisano w Ovoko.");
        if (!controller.signal.aborted) setShippingName(name);
      } else {
        const { data } = await createSupabaseBrowserClient().auth.getSession();
        if (!data.session) throw new Error("Zaloguj sie ponownie.");
        const response = await fetch("/api/ovoko/read", { method: "POST", signal: controller.signal, cache: "no-store", headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ useSaved: true, operation }) });
        const result = await response.json() as OvokoReadResult & { message?: string };
        if (!response.ok) throw new Error(result.message || "Nie udalo sie odczytac slownika.");
        if (result.ok !== true || result.readOnly !== true || result.operation !== operation || !Array.isArray(result.rows)) throw new Error("Niepotwierdzony format slownika Ovoko.");
        if (!controller.signal.aborted) setDictionaries(previous => ({ ...previous, [operation]: result.rows }));
      }
    } catch (error) { if (!controller.signal.aborted) setDictionaryError(error instanceof Error ? error.message : "Blad odczytu slownika."); }
    finally { if (!controller.signal.aborted) setDictionaryBusy(false); }
  }
  return <section className="space-y-5">
    <h1 className="text-3xl font-black">Przygotuj do Ovoko</h1>
    <p className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm leading-6"><strong>Tylko roboczy podglad jednej oferty.</strong> Nie publikujemy, nie tworzymy auta ani czesci w Ovoko. Niczego nie zmieniamy na Allegro. Zmiany formularza sa tylko w pamieci tej strony i znikna po jej zamknieciu lub odswiezeniu.</p>
    <a href="/panel/inventory" className="inline-block text-sm underline">Wroc do ofert Allegro</a>
    {busy && <p role="status">Sprawdzam uprawnienia i pobieram oferte z polaczonego konta Allegro...</p>}
    {error && <p role="alert" className="rounded-xl border border-amber-400/30 p-4">{error} Nie utworzono podgladu i nie zmieniono ofert.</p>}
    {source && draft && <>
      <div className="grid gap-5 xl:grid-cols-2">
        <section className="min-w-0 space-y-4 rounded-2xl border border-white/10 p-4"><h2 className="text-xl font-bold">Zrodlo: Allegro</h2><a className="font-bold underline" href={`https://allegro.pl/oferta/${source.id}`} target="_blank" rel="noopener noreferrer">{source.title}</a>
          <p className="text-sm">Oferta ID: {source.id}; status: {source.status || "brak"}; liczba sztuk: {source.stock ?? "nieznana"}</p>
          <p>Cena zrodlowa: {source.price || "brak"} {source.currency}</p><p className="break-all text-sm">ID zewnetrzne: {source.externalId || "brak"}; kategoria Allegro ID: {source.categoryId || "brak"}</p>
          <p className="break-all text-sm">Cennik Allegro: {shippingName || source.shippingRateId || "brak"}</p><button className={button} type="button" disabled={dictionaryBusy || !source.shippingRateId} onClick={() => void readDictionary("shipping")}>Odczytaj nazwe cennika Allegro</button>
          <div className="grid grid-cols-3 gap-2" aria-label="Zdjecia z Allegro">{source.images.map((url, index) => <img key={url} src={url} alt={`Zdjecie zrodlowe ${index + 1}`} loading="lazy" referrerPolicy="no-referrer" className="aspect-square w-full rounded-lg bg-white/5 object-contain" />)}</div>
          <p className="text-sm text-white/60">Adresow zdjec do sprawdzenia: {source.images.length}. Pominiete lub powtorzone: {source.skippedImages}. Nie wyslano zdjec do Ovoko.</p>
          <details><summary className="cursor-pointer text-sm font-bold">Parametry zrodlowe Allegro (bez mapowania ID)</summary><ul className="max-h-60 overflow-auto text-sm">{source.parameters.map((parameter, index) => <li key={index} className="mt-2 break-words">{parameter.name || parameter.id}: {parameter.values.join(", ") || "Brak wartosci tekstowej"}</li>)}</ul></details>
        </section>
        <section className="min-w-0 space-y-4 rounded-2xl border border-white/10 p-4"><h2 className="text-xl font-bold">Robocze dane do Ovoko</h2>
          <label className="block text-sm">Nazwa robocza<input className={field} value={draft.title} maxLength={500} onChange={event => change("title", event.target.value)} /></label><p className="text-xs text-white/60">Nie jest to gotowy tytul importu. W Ovoko nazwa czesci wynika z kategorii.</p>
          <label className="block text-sm">Numer katalogowy - propozycja do sprawdzenia<input className={field} value={draft.manufacturerCode} maxLength={255} onChange={event => change("manufacturerCode", event.target.value)} /></label>
          <div className="grid grid-cols-2 gap-3"><label className="text-sm">Cena robocza<input className={field} inputMode="decimal" value={draft.price} maxLength={30} onChange={event => change("price", event.target.value)} /></label><label className="text-sm">Waluta<select aria-label="Waluta" className={field} value={draft.currency} onChange={event => change("currency", event.target.value)}><option value="">Wybierz</option><option>PLN</option><option>EUR</option></select></label></div><p className="text-xs text-amber-200">Nie przeliczamy walut. Zmiana PLN/EUR nie zmienia wpisanej kwoty.</p>
          {([ ["categories", "categoryId", "Kategoria Ovoko"], ["qualities", "qualityId", "Jakosc czesci Ovoko"], ["statuses", "statusId", "Status rekordu Ovoko"] ] as const).map(([operation, name, label]) => <div key={operation} className="space-y-2"><label className="block text-sm">{label}<select aria-label={label} className={field} value={draft[name]} disabled={!dictionaries[operation]} onChange={event => change(name, event.target.value)}><option value="">Nie wybrano</option>{(dictionaries[operation] || []).filter(row => operation !== "categories" || row.level === "3").map(row => <option key={row.id} value={row.id}>{dictionaryLabel(operation, row)}</option>)}</select></label><button type="button" className={button} disabled={dictionaryBusy} onClick={() => void readDictionary(operation)}>Pobierz: {label}</button></div>)}
          <p className="text-xs text-white/60">Slowniki sa odczytywane osobno, po kliknieciu (wspolny limit 3 odczytow/minute). Kategorie wybieramy wylacznie z poziomu 3, bez kopiowania ID Allegro.</p>
          <label className="block text-sm">ID samochodu-dawcy Ovoko - roboczo, niezweryfikowane<input className={field} value={draft.donorId} maxLength={12} inputMode="numeric" onChange={event => change("donorId", event.target.value)} /></label><p className="text-xs text-amber-200">To nie jest ID modelu, czesci ani miejsca skladowania. Nie tworz tego numeru na podstawie Allegro. Weryfikacja dawcy bedzie osobnym krokiem.</p>
          <label className="block text-sm">Plan wysylki do sprawdzenia<textarea className={field} value={draft.shippingPlan} maxLength={2000} rows={3} onChange={event => change("shippingPlan", event.target.value)} /></label><p className="text-xs text-white/60">Cennik Allegro jest tylko informacja zrodlowa. Nie przypisano wysylki Ovoko.</p>
          <label className="block text-sm">Opis / uwagi robocze<textarea className={field} value={draft.notes} maxLength={40000} rows={8} onChange={event => change("notes", event.target.value)} /></label><p className="text-xs text-white/60">Tekst bez formatowania HTML i ilustracji w opisie, do 40000 znakow. Sprawdz kompletnosc przed dalszym przygotowaniem.</p>
        </section>
      </div>
      {dictionaryError && <p role="alert" className="rounded-xl border border-amber-400/30 p-4">{dictionaryError} Dane robocze pozostaly bez zmian.</p>}
      <section className="rounded-xl border border-amber-400/30 p-4"><h2 className="font-bold">Do sprawdzenia przed publikacja</h2><ul className="mt-3 list-disc space-y-2 pl-5 text-sm" aria-label="Braki przygotowania">{ovokoPreparationIssues(source, draft).map(issue => <li key={issue}>{issue}</li>)}</ul><p className="mt-4 font-bold text-amber-200">Nie opublikowano. Nie zapisano powiazania Allegro-Ovoko. Na tej stronie nie ma przycisku wystawiania.</p></section>
    </>}
  </section>;
}
