"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { accountRequest, type AccountInfo } from "@/lib/account-client";
import { allegroRequest } from "@/lib/allegro-client";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import { initialOvokoDraft, offerDescriptionText, ovokoPreparationIssues, ovokoSourcePreview, type OvokoPreparationDraft, type OvokoSourcePreview } from "@/lib/ovoko-preparation";
import type { OvokoReadResult, OvokoReadRow } from "@/lib/ovoko-read";
import { suggestPartNumbers, suggestOvokoCategories, suggestionSearchMatches, suggestOvokoBrands, suggestOvokoModels, vehicleSuggestionText } from "@/lib/ovoko-suggestions";

const button = "rounded-lg border border-white/20 px-3 py-2 text-sm font-bold disabled:opacity-40";
const field = "mt-1 w-full rounded-lg border border-white/20 bg-[#0d1117] px-3 py-2 text-white";
export function OvokoPreparationPanel() {
  const [source, setSource] = useState<OvokoSourcePreview | null>(null), [draft, setDraft] = useState<OvokoPreparationDraft | null>(null);
  const [busy, setBusy] = useState(true), [error, setError] = useState(""), [dictionaryError, setDictionaryError] = useState("");
  const [dictionaries, setDictionaries] = useState<Record<string, OvokoReadRow[]>>({}), [dictionaryBusy, setDictionaryBusy] = useState(false);
  const [shippingName, setShippingName] = useState("");
  const [numberAccepted, setNumberAccepted] = useState(""), [categoryAccepted, setCategoryAccepted] = useState("");
  const [categorySearch, setCategorySearch] = useState("");
  const [brandId, setBrandId] = useState(""), [modelId, setModelId] = useState("");
  const [modelsBusy, setModelsBusy] = useState(false), [modelError, setModelError] = useState("");
  const vehicleText = source ? vehicleSuggestionText(source.title, source.parameters) : "";
  const brandSuggestions = useMemo(() => suggestOvokoBrands(vehicleText, dictionaries.brands || []), [vehicleText, dictionaries.brands]);
  const modelSuggestions = useMemo(() => suggestOvokoModels(vehicleText, dictionaries.models || []), [vehicleText, dictionaries.models]);
  const numberSuggestions = useMemo(() => source ? suggestPartNumbers(source.title, source.parameters) : [], [source]);
  const categorySuggestions = useMemo(() => source ? suggestOvokoCategories(source.title, dictionaries.categories || []) : [], [source, dictionaries.categories]);
  const active = useRef<AbortController | null>(null);
  const touched = useRef(new Set<string>());
  async function readOvoko(operation: string, signal: AbortSignal, selectedBrand?: string) {
    const { data } = await createSupabaseBrowserClient().auth.getSession();
    if (!data.session) throw new Error("Zaloguj sie ponownie.");
    const response = await fetch(operation === "brands" ? "/api/ovoko/test" : "/api/ovoko/read", { method: "POST", signal, cache: "no-store", headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ useSaved: true, ...(operation === "brands" ? {} : { operation }), ...(selectedBrand ? { brandId: selectedBrand } : {}) }) });
    const result = await response.json() as OvokoReadResult & { brands?: OvokoReadRow[]; message?: string };
    if (!response.ok) throw new Error(result.message || "Nie udalo sie odczytac slownika.");
    const rows = operation === "brands" ? result.brands : result.rows;
    if (result.ok !== true || result.readOnly !== true || (operation !== "brands" && result.operation !== operation) || !Array.isArray(rows)) throw new Error("Niepotwierdzony format slownika Ovoko.");
    return rows;
  }
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
        if (!controller.signal.aborted) {
          const numbers = suggestPartNumbers(preview.title, preview.parameters);
          setSource(preview);
          setDraft({ ...initialOvokoDraft(preview), manufacturerCode: numbers.length === 1 && !numbers[0].warnings.length ? numbers[0].number : "" });
        }
      } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Nie udalo sie pobrac oferty."); }
      finally { if (!controller.signal.aborted) setBusy(false); }
    })();
    return () => { controller.abort(); active.current?.abort(); };
  }, []);
  useEffect(() => {
    if (!source) return;
    const controller = new AbortController();
    setDictionaryBusy(true); setDictionaryError("");
    void (async () => {
      const failures: string[] = [];
      // Sequential, bounded reads: no polling, automatic retries or offer mutations.
      for (const operation of ["categories", "qualities", "statuses", "brands"]) {
        if (controller.signal.aborted) return;
        try {
          const rows = await readOvoko(operation, controller.signal);
          if (!controller.signal.aborted) {
            setDictionaries(previous => ({ ...previous, [operation]: rows }));
            if (operation === "categories") {
              const matches = suggestOvokoCategories(source.title, rows);
              if (matches.length && (!matches[1] || matches[0].score > matches[1].score)) {
                setDraft(previous => previous && !touched.current.has("categoryId") && !previous.categoryId ? { ...previous, categoryId: matches[0].id } : previous);
              }
            }
            if (operation === "brands") {
              const matches = suggestOvokoBrands(vehicleSuggestionText(source.title, source.parameters), rows);
              if (matches.length === 1 && !touched.current.has("brandId")) setBrandId(previous => previous || matches[0].id);
            }
          }
        } catch (error) {
          if (controller.signal.aborted) return;
          failures.push(`${operation}: ${error instanceof Error ? error.message : "Blad odczytu"}`);
          break;
        }
      }
      if (!controller.signal.aborted) { setDictionaryBusy(false); setDictionaryError(failures.join(" ")); }
    })();
    if (source.shippingRateId) void allegroRequest<{ shippingRates: { id: string; name: string }[] }>("/shipping-rates", { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) setShippingName(data.shippingRates?.find(rate => rate.id === source.shippingRateId)?.name || "");
    }).catch(() => { /* The source shipping ID remains visible if its name is unavailable. */ });
    return () => controller.abort();
  }, [source]);
  useEffect(() => {
    const controller = new AbortController();
    setModelId(""); setModelError(""); setDictionaries(previous => ({ ...previous, models: [] }));
    if (!brandId) { setModelsBusy(false); return () => controller.abort(); }
    setModelsBusy(true);
    void readOvoko("models", controller.signal, brandId).then(rows => {
      if (!controller.signal.aborted) {
        setDictionaries(previous => ({ ...previous, models: rows }));
        const matches = suggestOvokoModels(vehicleText, rows);
        if (matches.length && (!matches[1] || matches[0].score > matches[1].score)) setModelId(matches[0].id);
      }
    }).catch(error => { if (!controller.signal.aborted) setModelError(error instanceof Error ? error.message : "Blad modeli"); })
      .finally(() => { if (!controller.signal.aborted) setModelsBusy(false); });
    return () => controller.abort();
  }, [brandId, vehicleText]);
  function change(name: keyof OvokoPreparationDraft, value: string) {
    touched.current.add(name);
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
          <p className="break-all text-sm">Cennik Allegro: {shippingName || source.shippingRateId || "brak"}</p>
          <div className="grid grid-cols-3 gap-2" aria-label="Zdjecia z Allegro">{source.images.map((url, index) => <img key={url} src={url} alt={`Zdjecie zrodlowe ${index + 1}`} loading="lazy" referrerPolicy="no-referrer" className="aspect-square w-full rounded-lg bg-white/5 object-contain" />)}</div>
          <p className="text-sm text-white/60">Adresow zdjec do sprawdzenia: {source.images.length}. Pominiete lub powtorzone: {source.skippedImages}. Nie wyslano zdjec do Ovoko.</p>
          <details><summary className="cursor-pointer text-sm font-bold">Parametry zrodlowe Allegro (bez mapowania ID)</summary><ul className="max-h-60 overflow-auto text-sm">{source.parameters.map((parameter, index) => <li key={index} className="mt-2 break-words">{parameter.name || parameter.id}: {parameter.values.join(", ") || "Brak wartosci tekstowej"}</li>)}</ul></details>
        </section>
        <section className="min-w-0 space-y-4 rounded-2xl border border-white/10 p-4"><h2 className="text-xl font-bold">Robocze dane do Ovoko</h2>
          <label className="block text-sm">Nazwa robocza<input className={field} value={draft.title} maxLength={500} onChange={event => change("title", event.target.value)} /></label><p className="text-xs text-white/60">Nie jest to gotowy tytul importu. W Ovoko nazwa czesci wynika z kategorii.</p>
          <label className="block text-sm">Numer katalogowy - propozycja do sprawdzenia<input className={field} value={draft.manufacturerCode} maxLength={255} onChange={event => change("manufacturerCode", event.target.value)} /></label><p className="text-xs text-white/60">Jedno oznaczenie bez ostrzezen wpisujemy od razu, z calym indeksem. Sprawdz je przed publikacja.</p>
          <details className="space-y-3 rounded-xl border border-violet-400/30 p-3"><summary className="cursor-pointer text-sm font-bold">Podpowiedzi numeru ({numberSuggestions.length})</summary>
            <h3 className="text-sm font-bold text-violet-200">Oznaczenia znalezione w tytule i parametrach</h3>
            <p className="text-xs leading-5 text-white/65">Przepisujemy cale znalezione oznaczenie razem z literami. Spacje, kropki i myslniki usuwamy tylko w propozycji zapisu. Nie dopisujemy brakujacego indeksu i nie potwierdzamy autentycznosci numeru OE. Pole parametru zawierajace caly tytul pomijamy.</p>
            {numberSuggestions.length > 1 && <p className="text-xs text-amber-200">Jest kilka mozliwych numerow. Wybierz po sprawdzeniu czesci lub etykiety; niczego nie wybrano automatycznie.</p>}
            {!numberSuggestions.length && <p className="text-xs text-amber-200">Brak jednoznacznie wydzielonego oznaczenia w obslugiwanym formacie. Wpisz caly numer recznie, razem z indeksem.</p>}
            <ul className="max-h-72 space-y-3 overflow-auto" aria-label="Propozycje numerow">{numberSuggestions.slice(0, 12).map(candidate => <li key={candidate.number} className="rounded-lg border border-white/10 p-2"><p className="break-all font-mono text-sm font-bold">{candidate.number}</p>{candidate.evidence.map((item, index) => <p key={index} className="break-words text-xs text-white/60">{item.source}: <span className="font-mono">{item.raw}</span></p>)}{candidate.warnings.map(warning => <p key={warning} className="mt-1 text-xs text-amber-200">{warning}</p>)}<button className={`${button} mt-2`} type="button" onClick={() => { change("manufacturerCode", candidate.number); setNumberAccepted(candidate.number); }}>Uzyj numeru {candidate.number}</button></li>)}</ul>
            {numberSuggestions.length > 12 && <p className="text-xs">Pokazano 12 z {numberSuggestions.length} propozycji. Pozostale oznaczenia sprawdz w tytule lub wpisz recznie.</p>}
            <button className={button} type="button" disabled={!draft.manufacturerCode.trim()} onClick={() => setNumberAccepted(draft.manufacturerCode)}>Zatwierdz wpisany numer</button>
            <p role="status" className={`text-xs ${numberAccepted && numberAccepted === draft.manufacturerCode ? "text-emerald-300" : "text-amber-200"}`}>{numberAccepted && numberAccepted === draft.manufacturerCode ? "Numer zatwierdzony recznie w tej sesji. Nie zweryfikowano go w katalogu producenta." : "Propozycja numeru wymaga sprawdzenia."}</p>
          </details>
          <div className="grid grid-cols-2 gap-3"><label className="text-sm">Cena robocza<input className={field} inputMode="decimal" value={draft.price} maxLength={30} onChange={event => change("price", event.target.value)} /></label><label className="text-sm">Waluta<select aria-label="Waluta" className={field} value={draft.currency} onChange={event => change("currency", event.target.value)}><option value="">Wybierz</option><option>PLN</option><option>EUR</option></select></label></div><p className="text-xs text-amber-200">Nie przeliczamy walut. Zmiana PLN/EUR nie zmienia wpisanej kwoty.</p>
          {([ ["categories", "categoryId", "Kategoria Ovoko"], ["qualities", "qualityId", "Jakosc czesci Ovoko"], ["statuses", "statusId", "Status rekordu Ovoko"] ] as const).map(([operation, name, label]) => <div key={operation} className="space-y-2">
            {operation === "categories" && dictionaries.categories && <details className="space-y-3 rounded-xl border border-violet-400/30 p-3"><summary className="cursor-pointer text-sm font-bold text-violet-200">Podpowiedzi kategorii ({categorySuggestions.length})</summary>
              {!categorySuggestions.length && <p className="text-xs text-amber-200">Brak propozycji na podstawie wspolnych slow. Wyszukaj kategorie recznie.</p>}
              <ul className="max-h-64 space-y-3 overflow-auto" aria-label="Propozycje kategorii">{categorySuggestions.map(candidate => <li key={candidate.id} className="rounded-lg border border-white/10 p-2"><p className="text-sm font-bold">{candidate.path} (ID {candidate.id})</p><p className="text-xs text-white/60">Wspolne slowa: {candidate.matches.join(", ")}</p><p className="text-xs text-amber-200">{candidate.weak ? "Slaba wskazowka: jedno wspolne slowo w nazwie kategorii." : "Kilka wspolnych slow; nadal wymaga sprawdzenia."}</p><button type="button" className={`${button} mt-2`} onClick={() => change("categoryId", candidate.id)}>Uzyj kategorii {candidate.id}</button></li>)}</ul>
              <label className="block text-sm">Szukaj w pobranych kategoriach<input type="search" className={field} value={categorySearch} onChange={event => setCategorySearch(event.target.value)} maxLength={100} /></label>
            </details>}
            <label className="block text-sm">{label}<select aria-label={label} className={field} value={draft[name]} disabled={!dictionaries[operation]} onChange={event => change(name, event.target.value)}><option value="">Nie wybrano</option>{(dictionaries[operation] || []).filter(row => operation !== "categories" || row.level === "3").filter(row => operation !== "categories" || row.id === draft.categoryId || suggestionSearchMatches(dictionaryLabel(operation, row), categorySearch)).map(row => <option key={row.id} value={row.id}>{dictionaryLabel(operation, row)}</option>)}</select></label>
            {operation === "categories" && <p className={`text-xs ${categoryAccepted && categoryAccepted === draft.categoryId ? "text-emerald-300" : "text-amber-200"}`}>{categoryAccepted && categoryAccepted === draft.categoryId ? "Kategorie wybrano recznie w tej sesji." : draft.categoryId ? "Kategoria dopasowana z tytulu - sprawdz." : "Wybierz kategorie; brak jednoznacznej propozycji."}</p>}
            </div>)}
          {dictionaryBusy && <p role="status" className="text-sm text-violet-200">Dopasowuje slowniki Ovoko...</p>}
          <div className="space-y-3 rounded-xl border border-violet-400/30 p-3"><h3 className="text-sm font-bold">Samochod - marka i model</h3>
            <label className="block text-sm">Marka auta Ovoko<select aria-label="Marka auta Ovoko" className={field} value={brandId} onChange={event => { touched.current.add("brandId"); setBrandId(event.target.value); }}><option value="">Wybierz marke</option>{(dictionaries.brands || []).map(row => <option key={row.id} value={row.id}>{row.name}{brandSuggestions.some(item => item.id === row.id) ? " - z tytulu" : ""}</option>)}</select></label>
            <label className="block text-sm">Model auta Ovoko<select aria-label="Model auta Ovoko" className={field} value={modelId} disabled={!brandId || modelsBusy} onChange={event => setModelId(event.target.value)}><option value="">{modelsBusy ? "Dopasowuje modele..." : "Wybierz model"}</option>{modelSuggestions.length > 0 && <optgroup label="Pasujace slowa z tytulu">{modelSuggestions.map(row => <option key={row.id} value={row.id}>{row.name} {row.years}</option>)}</optgroup>}<optgroup label="Wszystkie modele marki">{(dictionaries.models || []).filter(row => !modelSuggestions.some(item => item.id === row.id)).map(row => <option key={row.id} value={row.id}>{row.name} {row.years}</option>)}</optgroup></select></label>
            <p className="text-xs text-white/60">Podpowiedz z tytulu, nie potwierdzenie zgodnosci po numerze OE. Model to nie konkretne auto-dawca. Przy kilku generacjach wybierz wlasciwa.</p>{modelError && <p role="alert" className="text-sm text-amber-200">{modelError}</p>}
          </div>
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
