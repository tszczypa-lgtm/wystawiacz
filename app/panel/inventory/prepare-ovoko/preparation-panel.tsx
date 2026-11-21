"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { accountRequest, type AccountInfo } from "@/lib/account-client";
import { allegroRequest } from "@/lib/allegro-client";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import { initialOvokoDraft, offerDescriptionText, ovokoPreparationIssues, ovokoSourcePreview, type OvokoPreparationDraft, type OvokoSourcePreview } from "@/lib/ovoko-preparation";
import type { OvokoReadResult, OvokoReadRow } from "@/lib/ovoko-read";
import { suggestPartNumbers, suggestOvokoCategories, suggestionSearchMatches } from "@/lib/ovoko-suggestions";

const button = "rounded-lg border border-white/20 px-3 py-2 text-sm font-bold disabled:opacity-40";
const field = "mt-1 w-full rounded-lg border border-white/20 bg-[#0d1117] px-3 py-2 text-white";
export function OvokoPreparationPanel() {
  const [source, setSource] = useState<OvokoSourcePreview | null>(null), [draft, setDraft] = useState<OvokoPreparationDraft | null>(null);
  const [busy, setBusy] = useState(true), [error, setError] = useState(""), [dictionaryError, setDictionaryError] = useState("");
  const [dictionaries, setDictionaries] = useState<Record<string, OvokoReadRow[]>>({}), [dictionaryBusy, setDictionaryBusy] = useState(false);
  const [shippingName, setShippingName] = useState("");
  const [numberAccepted, setNumberAccepted] = useState(""), [categoryAccepted, setCategoryAccepted] = useState("");
  const [categorySearch, setCategorySearch] = useState("");
  const numberSuggestions = useMemo(() => source ? suggestPartNumbers(source.title, source.parameters) : [], [source]);
  const categorySuggestions = useMemo(() => source ? suggestOvokoCategories(source.title, dictionaries.categories || []) : [], [source, dictionaries.categories]);
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
  function change(name: keyof OvokoPreparationDraft, value: string) {
    if (name === "manufacturerCode") setNumberAccepted("");
    if (name === "categoryId") setCategoryAccepted(value);
    setDraft(previous => previous ? { ...previous, [name]: value } : null);
  }
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
        if (!controller.signal.aborted) {
          setDictionaries(previous => ({ ...previous, [operation]: result.rows }));
          if (operation === "categories" && draft?.categoryId && !result.rows.some(row => row.id === draft.categoryId && row.level === "3")) setCategoryAccepted("");
        }
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
        <section className="min-w-0 self-start space-y-4 rounded-2xl border border-white/10 p-4"><h2 className="text-xl font-bold">Zrodlo: Allegro</h2><a className="font-bold underline" href={`https://allegro.pl/oferta/${source.id}`} target="_blank" rel="noopener noreferrer">{source.title}</a>
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
          <div className="space-y-3 rounded-xl border border-violet-400/30 p-3">
            <h3 className="text-sm font-bold text-violet-200">Oznaczenia znalezione w tytule i parametrach</h3>
            <p className="text-xs leading-5 text-white/65">Przepisujemy cale znalezione oznaczenie razem z literami. Spacje, kropki i myslniki usuwamy tylko w propozycji zapisu. Nie dopisujemy brakujacego indeksu i nie potwierdzamy autentycznosci numeru OE. Pole parametru zawierajace caly tytul pomijamy.</p>
            {numberSuggestions.length > 1 && <p className="text-xs text-amber-200">Jest kilka mozliwych numerow. Wybierz po sprawdzeniu czesci lub etykiety; niczego nie wybrano automatycznie.</p>}
            {!numberSuggestions.length && <p className="text-xs text-amber-200">Brak jednoznacznie wydzielonego oznaczenia w obslugiwanym formacie. Wpisz caly numer recznie, razem z indeksem.</p>}
            <ul className="max-h-72 space-y-3 overflow-auto" aria-label="Propozycje numerow">{numberSuggestions.slice(0, 12).map(candidate => <li key={candidate.number} className="rounded-lg border border-white/10 p-2"><p className="break-all font-mono text-sm font-bold">{candidate.number}</p>{candidate.evidence.map((item, index) => <p key={index} className="break-words text-xs text-white/60">{item.source}: <span className="font-mono">{item.raw}</span></p>)}{candidate.warnings.map(warning => <p key={warning} className="mt-1 text-xs text-amber-200">{warning}</p>)}<button className={`${button} mt-2`} type="button" onClick={() => { change("manufacturerCode", candidate.number); setNumberAccepted(candidate.number); }}>Uzyj numeru {candidate.number}</button></li>)}</ul>
            {numberSuggestions.length > 12 && <p className="text-xs">Pokazano 12 z {numberSuggestions.length} propozycji. Pozostale oznaczenia sprawdz w tytule lub wpisz recznie.</p>}
            <button className={button} type="button" disabled={!draft.manufacturerCode.trim()} onClick={() => setNumberAccepted(draft.manufacturerCode)}>Zatwierdz wpisany numer</button>
            <p role="status" className={`text-xs ${numberAccepted && numberAccepted === draft.manufacturerCode ? "text-emerald-300" : "text-amber-200"}`}>{numberAccepted && numberAccepted === draft.manufacturerCode ? "Numer zatwierdzony recznie w tej sesji. Nie zweryfikowano go w katalogu producenta." : "Numer niezatwierdzony. Nie nadpisujemy go samodzielnie."}</p>
          </div>
          <div className="grid grid-cols-2 gap-3"><label className="text-sm">Cena robocza<input className={field} inputMode="decimal" value={draft.price} maxLength={30} onChange={event => change("price", event.target.value)} /></label><label className="text-sm">Waluta<select aria-label="Waluta" className={field} value={draft.currency} onChange={event => change("currency", event.target.value)}><option value="">Wybierz</option><option>PLN</option><option>EUR</option></select></label></div><p className="text-xs text-amber-200">Nie przeliczamy walut. Zmiana PLN/EUR nie zmienia wpisanej kwoty.</p>
          {([ ["categories", "categoryId", "Kategoria Ovoko"], ["qualities", "qualityId", "Jakosc czesci Ovoko"], ["statuses", "statusId", "Status rekordu Ovoko"] ] as const).map(([operation, name, label]) => <div key={operation} className="space-y-2">
            {operation === "categories" && dictionaries.categories && <div className="space-y-3 rounded-xl border border-violet-400/30 p-3"><h3 className="text-sm font-bold text-violet-200">Propozycje kategorii z tytulu</h3><p className="text-xs text-white/65">Porownanie slow i ich odmian z pobranym slownikiem Ovoko. To nie mapa kategorii Allegro ani potwierdzenie dopasowania przez producenta. Nie zmienia kategorii bez klikniecia.</p>
              {!categorySuggestions.length && <p className="text-xs text-amber-200">Brak propozycji na podstawie wspolnych slow. Wyszukaj kategorie recznie.</p>}
              <ul className="max-h-64 space-y-3 overflow-auto" aria-label="Propozycje kategorii">{categorySuggestions.map(candidate => <li key={candidate.id} className="rounded-lg border border-white/10 p-2"><p className="text-sm font-bold">{candidate.path} (ID {candidate.id})</p><p className="text-xs text-white/60">Wspolne slowa: {candidate.matches.join(", ")}</p><p className="text-xs text-amber-200">{candidate.weak ? "Slaba wskazowka: jedno wspolne slowo w nazwie kategorii." : "Kilka wspolnych slow; nadal wymaga sprawdzenia."}</p><button type="button" className={`${button} mt-2`} onClick={() => change("categoryId", candidate.id)}>Uzyj kategorii {candidate.id}</button></li>)}</ul>
              <label className="block text-sm">Szukaj w pobranych kategoriach<input type="search" className={field} value={categorySearch} onChange={event => setCategorySearch(event.target.value)} maxLength={100} /></label>
            </div>}
            <label className="block text-sm">{label}<select aria-label={label} className={field} value={draft[name]} disabled={!dictionaries[operation]} onChange={event => change(name, event.target.value)}><option value="">Nie wybrano</option>{(dictionaries[operation] || []).filter(row => operation !== "categories" || row.level === "3").filter(row => operation !== "categories" || row.id === draft.categoryId || suggestionSearchMatches(dictionaryLabel(operation, row), categorySearch)).map(row => <option key={row.id} value={row.id}>{dictionaryLabel(operation, row)}</option>)}</select></label>
            {operation === "categories" && <p className={`text-xs ${categoryAccepted && categoryAccepted === draft.categoryId ? "text-emerald-300" : "text-amber-200"}`}>{categoryAccepted && categoryAccepted === draft.categoryId ? "Kategorie wybrano recznie w tej sesji." : "Kategoria niezatwierdzona."}</p>}
            <button type="button" className={button} disabled={dictionaryBusy} onClick={() => void readDictionary(operation)}>Pobierz: {label}</button></div>)}
          <p className="text-xs text-white/60">Slowniki sa odczytywane osobno, po kliknieciu (wspolny limit 3 odczytow/minute). Kategorie wybieramy wylacznie z poziomu 3, bez kopiowania ID Allegro.</p>
          <label className="block text-sm">ID samochodu-dawcy Ovoko - roboczo, niezweryfikowane<input className={field} value={draft.donorId} maxLength={12} inputMode="numeric" onChange={event => change("donorId", event.target.value)} /></label><p className="text-xs text-amber-200">To nie jest ID modelu, czesci ani miejsca skladowania. Nie tworz tego numeru na podstawie Allegro. Weryfikacja dawcy bedzie osobnym krokiem.</p>
          <label className="block text-sm">Plan wysylki do sprawdzenia<textarea className={field} value={draft.shippingPlan} maxLength={2000} rows={3} onChange={event => change("shippingPlan", event.target.value)} /></label><p className="text-xs text-white/60">Cennik Allegro jest tylko informacja zrodlowa. Nie przypisano wysylki Ovoko.</p>
          <label className="block text-sm">Opis / uwagi robocze<textarea className={field} value={draft.notes} maxLength={40000} rows={8} onChange={event => change("notes", event.target.value)} /></label><p className="text-xs text-white/60">Tekst bez formatowania HTML i ilustracji w opisie, do 40000 znakow. Sprawdz kompletnosc przed dalszym przygotowaniem.</p>
        </section>
      </div>
      {dictionaryError && <p role="alert" className="rounded-xl border border-amber-400/30 p-4">{dictionaryError} Dane robocze pozostaly bez zmian.</p>}
      <section className="rounded-xl border border-amber-400/30 p-4"><h2 className="font-bold">Do sprawdzenia przed publikacja</h2><ul className="mt-3 list-disc space-y-2 pl-5 text-sm" aria-label="Braki przygotowania">{ovokoPreparationIssues(source, draft).map(issue => <li key={issue}>{issue}</li>)}{(!numberAccepted || numberAccepted !== draft.manufacturerCode) && <li>Numer czesci wymaga recznego zatwierdzenia razem z calym indeksem.</li>}</ul><p className="mt-4 font-bold text-amber-200">Nie opublikowano. Nie zapisano powiazania Allegro-Ovoko. Na tej stronie nie ma przycisku wystawiania.</p></section>
    </>}
  </section>;
}
