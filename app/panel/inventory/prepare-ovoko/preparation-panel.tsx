"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { accountRequest, type AccountInfo } from "@/lib/account-client";
import { allegroRequest } from "@/lib/allegro-client";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import { initialOvokoDraft, offerDescriptionText, ovokoPreparationIssues, ovokoPublicationBlockers, ovokoSourcePreview, additionalOvokoCodes, type OvokoPreparationDraft, type OvokoSourcePreview } from "@/lib/ovoko-preparation";
import type { OvokoReadResult, OvokoReadRow } from "@/lib/ovoko-read";
import { ovokoCarYear, preferredOvokoCar } from "@/lib/ovoko-car-selection";
import { suggestPartNumbers, suggestOvokoCategories, suggestionSearchMatches, suggestOvokoBrands, suggestOvokoModels, vehicleSuggestionText, ovokoAutomaticFields, automaticOvokoBrand, automaticOvokoModel } from "@/lib/ovoko-suggestions";
import { ManualOvokoOverride } from "../manual-override";

const button = "rounded-lg border border-white/20 px-3 py-2 text-sm font-bold disabled:opacity-40";
const field = "mt-1 w-full rounded-lg border border-white/20 bg-[#0d1117] px-3 py-2 text-white";
export function OvokoPreparationPanel({ popup=false }: { popup?:boolean }) {
  const [source, setSource] = useState<OvokoSourcePreview | null>(null), [draft, setDraft] = useState<OvokoPreparationDraft | null>(null);
  const [busy, setBusy] = useState(true), [error, setError] = useState(""), [dictionaryError, setDictionaryError] = useState("");
  const [dictionaries, setDictionaries] = useState<Record<string, OvokoReadRow[]>>({}), [dictionaryBusy, setDictionaryBusy] = useState(false);
  const [shippingName, setShippingName] = useState("");
  const [stockMode, setStockMode] = useState<"shared" | "separate">("shared");
  const [stockError, setStockError] = useState(false);
  const publicationMounted = useRef(true);
  useEffect(() => { publicationMounted.current = true; return () => { publicationMounted.current = false; }; }, []);
  const [numberAccepted, setNumberAccepted] = useState(""), [categoryAccepted, setCategoryAccepted] = useState("");
  const [categorySearch, setCategorySearch] = useState("");
  const [brandId, setBrandId] = useState(""), [modelId, setModelId] = useState("");
  const [modelsBusy, setModelsBusy] = useState(false), [modelError, setModelError] = useState("");
  const [carsBusy, setCarsBusy] = useState(false), [carsError, setCarsError] = useState(""), [carsRefresh, setCarsRefresh] = useState(0);
  const [carYear, setCarYear] = useState(""), [creatingCar, setCreatingCar] = useState(false), [carAttempted, setCarAttempted] = useState(false), [carMessage, setCarMessage] = useState("");
  const lastCarModel = useRef("");
  const carWriteLocks = useRef(new Set<string>());
  const publicationLock = useRef(false), publicationSent = useRef(false);
  const [overrideBusy, setOverrideBusy] = useState(false);
  const [review, setReview] = useState(false);
  const [publishing, setPublishing] = useState(false), [attempted, setAttempted] = useState(false), [publicationMessage, setPublicationMessage] = useState(""), [partId, setPartId] = useState("");
  useEffect(() => {
    if (!publishing) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [publishing]);
  const vehicleText = source ? vehicleSuggestionText(source.title, source.parameters) : "";
  const brandSuggestions = useMemo(() => suggestOvokoBrands(vehicleText, dictionaries.brands || []), [vehicleText, dictionaries.brands]);
  const modelSuggestions = useMemo(() => suggestOvokoModels(vehicleText, dictionaries.models || []), [vehicleText, dictionaries.models]);
  const numberSuggestions = useMemo(() => source ? suggestPartNumbers(source.title, source.parameters) : [], [source]);
  const categorySuggestions = useMemo(() => source ? suggestOvokoCategories(source.title, dictionaries.categories || []) : [], [source, dictionaries.categories]);
  const yearSuggestion = useMemo(() => source ? ovokoCarYear(source, dictionaries.models?.find(row => row.id === modelId)) : { year: "", reason: "", technical: false }, [source, modelId, dictionaries.models]);
  const active = useRef<AbortController | null>(null);
  const publicationPanel = useRef<HTMLElement | null>(null);
  const feedbackPanel = useRef<HTMLParagraphElement | null>(null);
  useEffect(() => {
    if (publicationMessage && !publishing) feedbackPanel.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [publicationMessage, publishing]);
  const touched = useRef(new Set<string>());
  async function readOvoko(operation: string, signal: AbortSignal, selectedBrand?: string) {
    const { data } = await createSupabaseBrowserClient().auth.getSession();
    if (!data.session) throw new Error("Zaloguj sie ponownie.");
    const response = await fetch(operation === "brands" ? "/api/ovoko/test" : "/api/ovoko/read", { method: "POST", signal, cache: "no-store", headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ useSaved: true, ...(operation === "brands" ? {} : { operation }), ...(selectedBrand ? operation === "cars" ? { modelId: selectedBrand } : { brandId: selectedBrand } : {}) }) });
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
        if (!info.isAdmin && !info.access?.allowed) throw new Error(info.access?.reason || "Brak aktywnego dostepu.");
        if (controller.signal.aborted) return;
        const offer = await allegroRequest<unknown>(`/own-offers/${ids[0]}`, { signal: controller.signal });
        const preview = ovokoSourcePreview(offer, ids[0], offerDescriptionText);
        if (!controller.signal.aborted) {
          const automatic = ovokoAutomaticFields(preview, {});
          setSource(preview);
          setDraft({ ...initialOvokoDraft(preview), ...automatic });
          setNumberAccepted(automatic.manufacturerCode || "");
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
      const loaded: Record<string, OvokoReadRow[]> = {};
      // Sequential, bounded reads: no polling, automatic retries or offer mutations.
      for (const operation of ["categories", "qualities", "statuses", "brands"]) {
        if (controller.signal.aborted) return;
        try {
          const rows = await readOvoko(operation, controller.signal);
          if (!controller.signal.aborted) {
            setDictionaries(previous => ({ ...previous, [operation]: rows }));
            loaded[operation] = rows;
            const automatic = ovokoAutomaticFields(source, loaded);
            setDraft(previous => {
              if (!previous) return previous;
              const next = { ...previous };
              for (const name of Object.keys(automatic) as (keyof OvokoPreparationDraft)[]) {
                if (!touched.current.has(name) && !next[name] && automatic[name] !== undefined) next[name] = automatic[name]!;
              }
              return next;
            });
            if (automatic.categoryId && !touched.current.has("categoryId")) setCategoryAccepted(automatic.categoryId);
            if (operation === "brands") {
              const selected = automaticOvokoBrand(source.title, source.parameters, rows);
              if (selected && !touched.current.has("brandId")) setBrandId(previous => previous || selected);
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
        setModelId(automaticOvokoModel(vehicleText, rows));
      }
    }).catch(error => { if (!controller.signal.aborted) setModelError(error instanceof Error ? error.message : "Blad modeli"); })
      .finally(() => { if (!controller.signal.aborted) setModelsBusy(false); });
    return () => controller.abort();
  }, [brandId, vehicleText]);
  useEffect(() => {
    const controller = new AbortController();
    setDictionaries(previous => ({ ...previous, cars: [] })); setCarsError("");
    if (lastCarModel.current !== modelId) {
      lastCarModel.current = modelId;
      setDraft(previous => previous ? { ...previous, donorId: "" } : previous);
    }
    if (!modelId) { setCarsBusy(false); return () => controller.abort(); }
    setCarsBusy(true);
    void readOvoko("cars", controller.signal, modelId).then(rows => {
      if (controller.signal.aborted) return;
      setDictionaries(previous => ({ ...previous, cars: rows }));
      const preferred = preferredOvokoCar(rows, yearSuggestion.year);
      if (preferred) setDraft(previous => previous && !previous.donorId ? { ...previous, donorId: preferred.id } : previous);
    }).catch(error => { if (!controller.signal.aborted) setCarsError(error instanceof Error ? error.message : "Nie udalo sie odczytac aut Ovoko."); })
      .finally(() => { if (!controller.signal.aborted) setCarsBusy(false); });
    return () => controller.abort();
  }, [modelId, carsRefresh, yearSuggestion.year]);
  useEffect(() => { setCarYear(yearSuggestion.year); setCarAttempted(false); setCarMessage(""); }, [modelId, yearSuggestion.year]);
  useEffect(() => { setReview(false); }, [brandId, modelId]);
  function change(name: keyof OvokoPreparationDraft, value: string) {
    setReview(false);
    touched.current.add(name);
    if (name === "manufacturerCode") setNumberAccepted("");
    if (name === "categoryId") setCategoryAccepted(value);
    setDraft(previous => previous ? { ...previous, [name]: value } : null);
  }
  function chooseMainNumber(value: string) {
    if (!draft) return;
    const rest = [...new Set([draft.manufacturerCode, ...draft.additionalCodes.split(/\r?\n/)].map(code => code.trim()).filter(code => code && code !== value))].join("\n");
    change("manufacturerCode", value); change("additionalCodes", rest); setNumberAccepted(value);
  }
  const categoryMap = new Map((dictionaries.categories || []).map(row => [row.id, row]));
  function dictionaryLabel(operation: string, row: OvokoReadRow) {
    const names = [row.name], seen = new Set([row.id]); let parent = row.parentId;
    while (operation === "categories" && parent && parent !== "0" && !seen.has(parent) && seen.size < 3) {
      seen.add(parent); const item = categoryMap.get(parent); names.unshift(item?.name || `Rodzic ID ${parent}`); parent = item?.parentId;
    }
    return `${names.join(" / ")} (ID ${row.id})`;
  }
  const publicationBlockers = source && draft ? [
    ...ovokoPublicationBlockers(source, draft, brandId, modelId),
    ...(busy || dictionaryBusy ? ["Trwa pobieranie i dopasowanie danych Ovoko."] : []),
    ...(modelsBusy ? ["Trwa pobieranie modeli wybranej marki."] : []),
    ...(carsBusy ? ["Trwa odczyt Moich samochodow Ovoko dla wybranego modelu."] : []),
    ...(creatingCar ? ["Trwa automatyczne przygotowanie rekordu auta Ovoko."] : []),
    ...(draft.statusId && dictionaries.statuses && !dictionaries.statuses.some(row => row.id === draft.statusId && ["na stanie", "in stock"].includes(row.name.trim().toLowerCase())) ? ["Pierwsza proba wymaga dostepnosci Na stanie, nie Sprzedano ani Zarezerwowano."] : []),
  ] : [];
  const otherCodes = draft ? additionalOvokoCodes(draft.additionalCodes, draft.manufacturerCode) : [];
  async function createCar(): Promise<string | null> {
    if (overrideBusy) return null;
    const attemptKey = `${modelId}:${carYear}`;
    if (!brandId || !modelId || !/^\d{4}$/.test(carYear) || creatingCar || carWriteLocks.current.has(attemptKey) || carAttempted || carsBusy || modelsBusy || dictionaryBusy) {
      setPublicationMessage(carWriteLocks.current.has(attemptKey) || carAttempted ? "Przygotowanie tego auta bylo juz uruchomione. Sprawdz komunikat przy aucie; nie ponawiamy niepewnego zapisu." : "Nie przygotowano auta: wybierz marke, model i poprawny rok lub poczekaj na zakonczenie odczytu.");
      return null;
    }
    carWriteLocks.current.add(attemptKey);
    setCreatingCar(true); setCarAttempted(true); setCarMessage(""); setReview(false);
    setDraft(previous => previous ? { ...previous, donorId: "" } : previous);
    try {
      const { data } = await createSupabaseBrowserClient().auth.getSession();
      if (!data.session) throw new Error("Zaloguj sie ponownie.");
      const response = await fetch("/api/ovoko/create-car", { method: "POST", cache: "no-store", headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ brandId, modelId, year: carYear, confirmCreate: true }) });
      const result = await response.json() as { ok?: boolean; carId?: string; modelId?: string; year?: string; reused?: boolean; message?: string };
      if (!response.ok || !result.ok || !result.carId || !/^[1-9]\d{0,11}$/.test(result.carId) || result.modelId !== modelId || result.year !== carYear) {
        if (!response.ok && response.status !== 409) { setCarAttempted(false); carWriteLocks.current.delete(attemptKey); }
        throw new Error(result.message || "Niepewny wynik tworzenia auta. Sprawdz Ovoko, nie ponawiaj automatycznie.");
      }
      setDraft(previous => previous ? { ...previous, donorId: result.carId! } : previous);
      setCarsError("");
      setCarMessage(`${result.reused ? "Wykorzystano istniejacy" : "Utworzono nowy"} rekord auta ID ${result.carId}. ID uzupelniono automatycznie.`);
      setCarsRefresh(value => value + 1);
      return result.carId;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Niepewny wynik. Sprawdz Moje samochody Ovoko.";
      setCarMessage(message); setPublicationMessage(message);
    }
    finally { setCreatingCar(false); }
    return null;
  }
  function openPublicationReview() {
    if (!source || publishing || attempted || creatingCar || carsBusy || modelsBusy || dictionaryBusy) return;
    setReview(true);
    publicationPanel.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  async function publishSingle() {
    if (overrideBusy) return;
    if (!source || !draft || publishing || attempted || publicationLock.current || publicationSent.current || creatingCar || carsBusy || modelsBusy || dictionaryBusy) return;
    if (!brandId || !modelId || modelError || source.status !== "ACTIVE" || !Number.isInteger(source.stock) || source.stock! < 1 || source.stock! > 10000 || source.bundle) {
      setPublicationMessage(modelError || "Przygotowanie auta wymaga marki, modelu i aktywnej oferty Allegro z 1-10000 sztuk, bez zestawu.");
      openPublicationReview(); return;
    }
    publicationLock.current = true;
    setPublishing(true); setPublicationMessage("");
    let progress = "";
    try {
      const donorId = draft.donorId || await createCar();
      if (!donorId) { setPublicationMessage(previous => previous || "Nie przygotowano auta. Sprawdz komunikat przy samochodzie. Nie wyslano czesci."); return; }
      setReview(true);
      const blockers = ovokoPublicationBlockers(source, { ...draft, donorId }, brandId, modelId);
      if (blockers.length || dictionaryError) {
        setPublicationMessage(`Auto ID ${donorId} jest uzupelnione. Nie wyslano czesci: ${[...blockers, dictionaryError].filter(Boolean).join(" ")}`);
        return;
      }
      const { data } = await createSupabaseBrowserClient().auth.getSession();
      if (!data.session) throw new Error("Zaloguj sie ponownie. Nie potwierdzono wysylki.");
      publicationSent.current = true; setAttempted(true);
      const payload = { offerId: source.id, brandId, modelId, donorId, categoryId: draft.categoryId, qualityId: draft.qualityId, statusId: draft.statusId, manufacturerCode: draft.manufacturerCode, additionalCodes: draft.additionalCodes, price: draft.price, currency: draft.currency, notes: draft.notes, confirmSingle: true, stockMode, expectedSource: { title: source.title, price: source.price, currency: source.currency, stock: source.stock, status: source.status, condition: source.condition, images: source.images } };
      let continuationBinding: { sellerId: string; fingerprint: string } | undefined;
      do {
        if (!publicationMounted.current) break;
        const started = Date.now();
        const response = await fetch("/api/ovoko/publish", { method: "POST", cache: "no-store", headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, ...(continuationBinding ? { binding: continuationBinding } : {}) }) });
        const result = await response.json() as { ok?: boolean; partId?: string; alreadyCreated?: boolean; completedUnits?: number; totalUnits?: number; initialStock?: number; moreUnits?: boolean; message?: string; code?: string; binding?: { sellerId: string; fingerprint: string } };
        if (!response.ok || result.ok !== true || !result.partId || !/^[1-9]\d{0,11}$/.test(result.partId)) {
          if (result.code?.startsWith("stock_")) setStockError(true);
          if (result.code === "stock_changed") { setAttempted(false); publicationSent.current = false; }
          throw new Error(result.message || "Niepotwierdzony wynik wysylki. Sprawdz Ovoko przed ponowieniem.");
        }
        setPartId(result.partId);
        progress = `Potwierdzono rekordy Ovoko: ${result.completedUnits ?? 1}/${result.totalUnits ?? 1}; zapas poczatkowy: ${result.initialStock ?? source.stock}.`;
        setPublicationMessage(`${progress} ${result.alreadyCreated ? "Juz przeniesione; bez ponownej wysylki. Ovoko ID" : "Ovoko potwierdzilo utworzenie czesci ID"} ${result.partId}. ${result.moreUnits ? "Trwa przenoszenie kolejnych sztuk. Zostaw okno otwarte." : "Sprawdz zdjecia, cene i widocznosc w Ovoko. Allegro bez zmian."}${result.message ? ` ${result.message}` : ""}`);
        if (result.alreadyCreated || !result.moreUnits) break;
        if (!result.binding || !/^\d{1,30}$/.test(result.binding.sellerId) || !/^[a-f0-9]{64}$/.test(result.binding.fingerprint) || continuationBinding && (result.binding.sellerId !== continuationBinding.sellerId || result.binding.fingerprint !== continuationBinding.fingerprint)) throw new Error("Nie potwierdzono kont dla kolejnej sztuki. Zatrzymano transfer; sprawdz Ovoko.");
        continuationBinding = result.binding;
        await new Promise(resolve => setTimeout(resolve, Math.max(0, 6250 - (Date.now() - started))));
      } while (true);
    } catch (error) {
      setPublicationMessage(`${progress} ${error instanceof Error ? error.message : "Niepewny wynik wysylki. Sprawdz Ovoko; nie ponawiaj automatycznie."}`.trim());
    } finally { setPublishing(false); publicationLock.current = false; }
  }
  return <section className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-3xl font-black">Przygotuj do Ovoko</h1><div className="flex gap-2">{popup&&<button type="button" className={button} disabled={publishing||creatingCar} onClick={()=>window.close()}>Zamknij okno</button>}<button type="button" className={`${button} bg-orange-600`} disabled={!source || busy || dictionaryBusy || modelsBusy || carsBusy || publishing || attempted || creatingCar} onClick={() => void publishSingle()}>{publishing ? "Wystawiam..." : "Wystaw w Ovoko"}</button></div></div>
    {publicationMessage && <p ref={feedbackPanel} role={partId || publishing ? "status" : "alert"} className={`rounded-lg border p-3 ${partId ? "border-emerald-400/40 text-emerald-200" : "border-amber-400/40 text-amber-200"}`}>{publicationMessage}</p>}
    {source && source.stock === 1 && !stockError && <ManualOvokoOverride key={`${source.id}:${brandId}:${modelId}:${carYear}`} offerId={source.id} brandId={brandId} modelId={modelId} year={carYear} disabled={publishing || creatingCar} onBusyChange={setOverrideBusy} onResolved={result => {
      setReview(false); setPublicationMessage(result.message);
      setAttempted(false); publicationSent.current = false; setPartId("");
      if (result.kind === "vehicle") { setCarAttempted(false); carWriteLocks.current.delete(`${modelId}:${carYear}`); setCarMessage(result.message); setCarsRefresh(value => value + 1); if (result.foundId) setDraft(previous => previous ? { ...previous, donorId: result.foundId! } : previous); }
    }} />}
    <p className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm leading-6"><strong>Jedno klikniecie Wystaw.</strong> Automat sprawdza dane, wykorzystuje zapisane auto albo tworzy brakujace i wysyla czesc ze zdjeciami. Bez dodatkowych checkboxow. Sam podglad niczego nie wysyla. Cennika wysylki Allegro nie przenosimy; obowiazuja ustawienia Ovoko. Nie zmieniamy Allegro. Niepewnych zapisow nie ponawiamy.</p>
    <a href="/panel/inventory" className="inline-block text-sm underline">Wroc do ofert Allegro</a>
    {busy && <p role="status">Sprawdzam uprawnienia i pobieram oferte z polaczonego konta Allegro...</p>}
    {error && <p role="alert" className="rounded-xl border border-amber-400/30 p-4">{error} Nie utworzono podgladu i nie zmieniono ofert.</p>}
    {source && draft && <>
      {source.stock !== null && source.stock > 1 && <fieldset disabled={publishing || creatingCar} className="space-y-2 rounded-xl border border-orange-400/30 p-3 text-sm"><legend className="font-bold">Sposob przenoszenia zapasu</legend>
        <label className="block"><input type="radio" name="single-stock-mode" checked={stockMode === "shared"} onChange={() => setStockMode("shared")} /> Jedna pozycja dla calego zapasu (zalecane)</label>
        <label className="block"><input type="radio" name="single-stock-mode" checked={stockMode === "separate"} onChange={() => setStockMode("separate")} /> Kazda sztuka osobno</label>
        <p>{stockMode === "shared" ? "Kupujacy Ovoko kupuje jedna sztuke naraz." : "Kazdy egzemplarz ma osobna pozycje."}</p>
        <p>Jedna oferta Allegro = {stockMode === "shared" ? 1 : source.stock} rekordow Ovoko. Zapas poczatkowy: {source.stock}. Identyczne wspolne zdjecia, cena za sztuke. Tryb rozpoczetego transferu jest niezmienny.</p>
        <p className="text-xs text-white/60">Tryb wspolny: po sprzedazy jednej sztuki automat sprzedazy zmniejsza zapas Allegro o 1 i moze uaktywnic ten sam rekord Ovoko, gdy pozostaje zapas. Publikacja nie tworzy kolejnego rekordu. Tryb osobny: kolejne sztuki wysylamy co najmniej co 6250 ms.</p>
      </fieldset>}
      <div className="grid gap-5 xl:grid-cols-2">
        <section className="min-w-0 self-start space-y-4 rounded-2xl border border-white/10 p-4"><h2 className="text-xl font-bold">Zrodlo: Allegro</h2><a className="font-bold underline" href={`https://allegro.pl/oferta/${source.id}`} target="_blank" rel="noopener noreferrer">{source.title}</a>
          <p className="text-sm">Oferta ID: {source.id}; status: {source.status || "brak"}; liczba sztuk: {source.stock ?? "nieznana"}</p>
          <p className="text-sm">Stan czesci Allegro: {({ used: "Uzywany", new: "Nowy", damaged: "Uszkodzony", restored: "Regenerowany", "": "Brak jednoznacznej wartosci" })[source.condition]}</p>
          <p>Cena zrodlowa: {source.price || "brak"} {source.currency}</p><p className="break-all text-sm">ID zewnetrzne: {source.externalId || "brak"}; kategoria Allegro ID: {source.categoryId || "brak"}</p>
          <p className="break-all text-sm">Cennik Allegro: {shippingName || source.shippingRateId || "brak"}</p>
          <div className="grid grid-cols-3 gap-2" aria-label="Zdjecia z Allegro">{source.images.map((url, index) => <img key={url} src={url} alt={`Zdjecie zrodlowe ${index + 1}`} loading="lazy" referrerPolicy="no-referrer" className="aspect-square w-full rounded-lg bg-white/5 object-contain" />)}</div>
          <p className="text-sm text-white/60">Galeria do przeniesienia: {source.images.length} zdjec. Powtorzenia pominiete: {source.duplicateImages}. Niedozwolone lub ponad limit: {source.rejectedImages}. {partId ? "Przekazano adresy calej galerii do API Ovoko; sprawdz zdjecia na koncie." : "Przy wystawieniu przekazujemy cala te galerie, nie tylko miniature. Sam podglad jeszcze jej nie wysyla."}</p>
          <details><summary className="cursor-pointer text-sm font-bold">Parametry zrodlowe Allegro (bez mapowania ID)</summary><ul className="max-h-60 overflow-auto text-sm">{source.parameters.map((parameter, index) => <li key={index} className="mt-2 break-words">{parameter.name || parameter.id}: {parameter.values.join(", ") || "Brak wartosci tekstowej"}</li>)}</ul></details>
        </section>
        <fieldset disabled={publishing || attempted || creatingCar || overrideBusy} className="min-w-0 space-y-4 rounded-2xl border border-white/10 p-4"><h2 className="text-xl font-bold">Robocze dane do Ovoko</h2>
          <p className="rounded-lg bg-emerald-400/10 p-3 text-sm text-emerald-200">Dane uzupelniamy automatycznie. Poprawiasz tylko wyjatki i klikasz Wystaw: auto oraz czesc przygotuja sie bez dodatkowych potwierdzen.</p>
          <label className="block text-sm">Nazwa robocza<input className={field} value={draft.title} maxLength={500} onChange={event => change("title", event.target.value)} /></label><p className="text-xs text-white/60">Nie jest to gotowy tytul importu. W Ovoko nazwa czesci wynika z kategorii.</p>
          <label className="block text-sm">Numer katalogowy - opcjonalny<input className={field} value={draft.manufacturerCode} maxLength={255} onChange={event => change("manufacturerCode", event.target.value)} /></label><p className="text-xs text-white/60">Gdy nie znasz numeru, zostaw pole puste. Pierwszy znaleziony numer jest glowny; pozostale uzupelniamy ponizej, z pelnymi indeksami i poczatkowymi zerami. Mozliwe VIN-y pomijamy.</p>
          <label className="block text-sm">Dodatkowe numery czesci<textarea className={field} value={draft.additionalCodes} maxLength={4000} rows={3} onChange={event => change("additionalCodes", event.target.value)} /></label><p className="text-xs text-white/60">Glowny numer zachowuje myslniki z aukcji. Tutaj wpisujemy ten sam numer bez myslnikow oraz pozostale pelne oznaczenia, po jednym w wierszu. Kazdy wariant trafia do osobnego pola Ovoko.</p>
          <details className="space-y-3 rounded-xl border border-violet-400/30 p-3"><summary className="cursor-pointer text-sm font-bold">Podpowiedzi numeru ({numberSuggestions.length})</summary>
            <h3 className="text-sm font-bold text-violet-200">Oznaczenia znalezione w tytule i parametrach</h3>
            <p className="text-xs leading-5 text-white/65">Przepisujemy cale znalezione oznaczenie razem z literami. Spacje, kropki i myslniki usuwamy tylko w propozycji zapisu. Nie dopisujemy brakujacego indeksu i nie potwierdzamy autentycznosci numeru OE. Pole parametru zawierajace caly tytul pomijamy.</p>
            {numberSuggestions.length > 1 && <p className="text-xs text-violet-200">Kilka oznaczen: pierwszy wpisujemy jako glowny, pozostale jako dodatkowe. Mozesz poprawic ich kolejnosc.</p>}
            {!numberSuggestions.length && <p className="text-xs text-amber-200">Brak jednoznacznie wydzielonego oznaczenia w obslugiwanym formacie. Wpisz caly numer recznie, razem z indeksem.</p>}
            <ul className="max-h-72 space-y-3 overflow-auto" aria-label="Propozycje numerow">{numberSuggestions.slice(0, 12).map(candidate => <li key={candidate.number} className="rounded-lg border border-white/10 p-2"><p className="break-all font-mono text-sm font-bold">{candidate.number}</p>{candidate.evidence.map((item, index) => <p key={index} className="break-words text-xs text-white/60">{item.source}: <span className="font-mono">{item.raw}</span></p>)}{candidate.warnings.map(warning => <p key={warning} className="mt-1 text-xs text-amber-200">{warning}</p>)}<button className={`${button} mt-2`} type="button" onClick={() => chooseMainNumber(candidate.number)}>Uzyj numeru {candidate.number}</button></li>)}</ul>
            {numberSuggestions.length > 12 && <p className="text-xs">Pokazano 12 z {numberSuggestions.length} propozycji. Pozostale oznaczenia sprawdz w tytule lub wpisz recznie.</p>}
            <button className={button} type="button" disabled={!draft.manufacturerCode.trim()} onClick={() => setNumberAccepted(draft.manufacturerCode)}>Zatwierdz wpisany numer</button>
            <p role="status" className={`text-xs ${!draft.manufacturerCode || numberAccepted === draft.manufacturerCode ? "text-emerald-300" : "text-amber-200"}`}>{!draft.manufacturerCode ? "Bez numeru czesci - dozwolone w Ovoko. Numer nie zostanie wyslany." : numberAccepted === draft.manufacturerCode ? "Numer uzupelniony. Nie wymaga osobnego zatwierdzenia. Nie zweryfikowano go w katalogu producenta." : "Propozycja numeru wymaga sprawdzenia."}</p>
          </details>
          <div className="grid grid-cols-2 gap-3"><label className="text-sm">Cena robocza<input className={field} inputMode="decimal" value={draft.price} maxLength={30} onChange={event => change("price", event.target.value)} /></label><label className="text-sm">Waluta<select aria-label="Waluta" className={field} value={draft.currency} onChange={event => change("currency", event.target.value)}><option value="">Wybierz</option><option>PLN</option><option>EUR</option></select></label></div><p className="text-xs text-amber-200">Nie przeliczamy walut. Zmiana PLN/EUR nie zmienia wpisanej kwoty.</p>
          {([ ["categories", "categoryId", "Kategoria Ovoko"], ["qualities", "qualityId", "Jakosc czesci Ovoko"], ["statuses", "statusId", "Status rekordu Ovoko"] ] as const).map(([operation, name, label]) => <div key={operation} className="space-y-2">
            {operation === "categories" && dictionaries.categories && <details className="space-y-3 rounded-xl border border-violet-400/30 p-3"><summary className="cursor-pointer text-sm font-bold text-violet-200">Podpowiedzi kategorii ({categorySuggestions.length})</summary>
              {!categorySuggestions.length && <p className="text-xs text-amber-200">Brak propozycji na podstawie wspolnych slow. Wyszukaj kategorie recznie.</p>}
              <ul className="max-h-64 space-y-3 overflow-auto" aria-label="Propozycje kategorii">{categorySuggestions.map(candidate => <li key={candidate.id} className="rounded-lg border border-white/10 p-2"><p className="text-sm font-bold">{candidate.path} (ID {candidate.id})</p><p className="text-xs text-white/60">Wspolne slowa: {candidate.matches.join(", ")}</p><p className="text-xs text-amber-200">{candidate.weak ? "Slaba wskazowka: jedno wspolne slowo w nazwie kategorii." : "Kilka wspolnych slow; nadal wymaga sprawdzenia."}</p><button type="button" className={`${button} mt-2`} onClick={() => change("categoryId", candidate.id)}>Uzyj kategorii {candidate.id}</button></li>)}</ul>
              <label className="block text-sm">Szukaj w pobranych kategoriach<input type="search" className={field} value={categorySearch} onChange={event => setCategorySearch(event.target.value)} maxLength={100} /></label>
            </details>}
            <label className="block text-sm">{label}<select aria-label={label} className={field} value={draft[name]} disabled={!dictionaries[operation]} onChange={event => change(name, event.target.value)}><option value="">Nie wybrano</option>{(dictionaries[operation] || []).filter(row => operation !== "categories" || row.level === "3").filter(row => operation !== "categories" || row.id === draft.categoryId || suggestionSearchMatches(dictionaryLabel(operation, row), categorySearch)).map(row => <option key={row.id} value={row.id}>{dictionaryLabel(operation, row)}</option>)}</select></label>
            {operation === "categories" && <p className={`text-xs ${categoryAccepted && categoryAccepted === draft.categoryId ? "text-emerald-300" : "text-amber-200"}`}>{categoryAccepted && categoryAccepted === draft.categoryId ? "Kategoria uzupelniona, bez dodatkowego zatwierdzania." : "Wybierz kategorie; brak jednoznacznej propozycji."}</p>}
            {operation === "qualities" && <p className="text-xs text-white/60">{source.condition ? "Stan przepisujemy z parametru Stan w Allegro, nie z samego faktu wystawienia." : "Brak jednoznacznego stanu Allegro - wybierz recznie."}</p>}
            {operation === "statuses" && <p className="text-xs text-white/60">{source.status === "ACTIVE" && source.stock !== null && source.stock > 0 && !source.bundle ? `Aktywna oferta Allegro: ${source.stock} szt. Dostepnosc dopasowujemy do Na stanie. Nie zmniejszamy liczby do jednej sztuki.` : "Brak potwierdzenia aktywnej oferty z dodatnim stanem albo oferta jest zestawem - bez automatycznego Na stanie."} Status magazynowy nie oznacza jeszcze publikacji Ovoko.</p>}
            </div>)}
          {dictionaryBusy && <p role="status" className="text-sm text-violet-200">Dopasowuje slowniki Ovoko...</p>}
          <div className="space-y-3 rounded-xl border border-violet-400/30 p-3"><h3 className="text-sm font-bold">Samochod - marka i model</h3>
            <label className="block text-sm">Marka auta Ovoko<select aria-label="Marka auta Ovoko" className={field} value={brandId} onChange={event => { touched.current.add("brandId"); setBrandId(event.target.value); }}><option value="">Wybierz marke</option>{(dictionaries.brands || []).map(row => <option key={row.id} value={row.id}>{row.name}{brandSuggestions.some(item => item.id === row.id) ? " - z tytulu" : ""}</option>)}</select></label>
            <label className="block text-sm">Model auta Ovoko<select aria-label="Model auta Ovoko" className={field} value={modelId} disabled={!brandId || modelsBusy} onChange={event => setModelId(event.target.value)}><option value="">{modelsBusy ? "Dopasowuje modele..." : "Wybierz model"}</option>{modelSuggestions.length > 0 && <optgroup label="Pasujace slowa z tytulu">{modelSuggestions.map(row => <option key={row.id} value={row.id}>{row.name} {row.years}</option>)}</optgroup>}<optgroup label="Wszystkie modele marki">{(dictionaries.models || []).filter(row => !modelSuggestions.some(item => item.id === row.id)).map(row => <option key={row.id} value={row.id}>{row.name} {row.years}</option>)}</optgroup></select></label>
            {!modelsBusy && modelSuggestions.length > 0 && <p role="status" className="text-xs text-violet-200">Rozpoznano pasujace warianty: {modelSuggestions.length}. {modelId ? "Wybrano najlepiej dopasowana robocza propozycje; przy remisie wybor jest staly. Sprawdz ja w podsumowaniu. Pozostale warianty sa na gorze listy." : "Brak zgodnej generacji do automatycznego wyboru. Sprawdz propozycje na gorze listy."}</p>}
            <p className="text-xs text-white/60">Podpowiedz z tytulu, nie potwierdzenie zgodnosci po numerze OE. Model to nie konkretne auto-dawca. Przy kilku generacjach wybierz wlasciwa.</p>{modelError && <p role="alert" className="text-sm text-amber-200">{modelError}</p>}
          </div>
          <div className="space-y-2 rounded-xl border border-white/10 p-3"><label className="block text-sm">Moje samochody Ovoko<select aria-label="Moje samochody Ovoko" className={field} value={draft.donorId} disabled={!modelId || carsBusy} onChange={event => change("donorId", event.target.value)}><option value="">{carsBusy ? "Odczytuje zapisane auta..." : "Wybierz zapisane auto"}</option>{draft.donorId && !(dictionaries.cars || []).some(row => row.id === draft.donorId) && <option value={draft.donorId}>ID {draft.donorId} - poza odczytana lista, do sprawdzenia</option>}{(dictionaries.cars || []).map(row => <option key={row.id} value={row.id}>ID {row.id}; rok: {row.years && row.years !== "0" ? row.years : "niepodany"}{row.engineCode ? `; silnik: ${row.engineCode}` : ""}</option>)}</select></label>
            {modelId && !carsBusy && !carsError && !(dictionaries.cars || []).length && <p className="text-xs text-amber-200">Brak zapisanego auta dla tego modelu. Przycisk Wystaw automatycznie przygotuje brakujacy rekord; ponizej widzisz model i rok.</p>}
            {modelId && !carsBusy && (dictionaries.cars || []).length > 0 && <p className="text-xs text-emerald-200">Wykorzystujemy zapisane auto tego modelu, najpierw z pasujacym rokiem; nie tworzymy kolejnego. Sprawdz przypisanie. Reczny wybor pozostaje bez zmian.</p>}
            {modelId && <button type="button" className={button} disabled={carsBusy} onClick={() => setCarsRefresh(value => value + 1)}>Odswiez moje samochody</button>}{carsError && <p role="alert" className="text-xs text-amber-200">{carsError}</p>}
          </div>
          {modelId && <div className="space-y-2 rounded-xl border border-violet-400/30 p-3"><p className="text-sm font-bold">Auto uzupelni sie automatycznie przy Wystaw.</p><p className="text-sm">Model: {dictionaries.models?.find(row => row.id === modelId)?.name}; rok nowego rekordu: {carYear || "do uzupelnienia"}.</p><p className="text-xs text-amber-200">{carYear === yearSuggestion.year ? yearSuggestion.reason : "Rok wpisany recznie."} Nie dopisujemy VIN-u ani danych zakupu.</p></div>}
          {modelId && <details className="space-y-3 rounded-xl border border-violet-400/30 p-3"><summary className="cursor-pointer text-sm font-bold">Dodaj brakujacy rekord auta do Ovoko</summary><p className="text-sm">Model: {dictionaries.models?.find(row => row.id === modelId)?.name}. Powstanie rekord katalogowy, bez VIN-u, silnika i danych zakupu. Nie tworzymy go przy samym wyborze modelu.</p>
            <label className="block text-sm">Rok nowego rekordu auta<input className={field} value={carYear} maxLength={4} inputMode="numeric" disabled={carAttempted} onChange={event => setCarYear(event.target.value)} /></label>
            <button type="button" className={button} disabled={!/^\d{4}$/.test(carYear) || carAttempted || creatingCar || modelsBusy || carsBusy || dictionaryBusy} onClick={() => void createCar()}>Utworz rekord auta i uzupelnij ID</button>
          </details>}
          {carMessage && <p role="status" className="text-sm text-amber-200">{carMessage}</p>}
          <label className="block text-sm">ID rekordu auta w Ovoko (car_id)<input className={field} value={draft.donorId} maxLength={12} inputMode="numeric" onChange={event => change("donorId", event.target.value)} /></label><p className="text-xs text-white/60">To techniczny car_id rekordu auta Ovoko, uzupelniany z listy powyzej (do 20 rekordow wybranego modelu). Nie jest to ID modelu ani miejsca skladowania. Sam ten numer nie oznacza, ze musisz znac VIN lub recznie zakladac fizycznego dawce. Przypisanie zostanie ponownie sprawdzone przed wysylka.</p>
          <label className="block text-sm">Plan wysylki do sprawdzenia<textarea className={field} value={draft.shippingPlan} maxLength={2000} rows={3} onChange={event => change("shippingPlan", event.target.value)} /></label><p className="text-xs text-white/60">Cennik Allegro jest tylko informacja zrodlowa. Nie przypisano wysylki Ovoko.</p>
          <label className="block text-sm">Opis / uwagi robocze<textarea className={field} value={draft.notes} maxLength={40000} rows={8} onChange={event => change("notes", event.target.value)} /></label><p className="text-xs text-white/60">Tekst bez formatowania HTML i ilustracji w opisie, do 40000 znakow. Sprawdz kompletnosc przed dalszym przygotowaniem.</p>
        </fieldset>
      </div>
      {dictionaryError && <p role="alert" className="rounded-xl border border-amber-400/30 p-4">{dictionaryError} Dane robocze pozostaly bez zmian.</p>}
      <section ref={publicationPanel} className="scroll-mt-5 rounded-xl border border-amber-400/30 p-4"><h2 className="font-bold">Wysylka do Ovoko</h2><ul className="mt-3 list-disc space-y-2 pl-5 text-sm" aria-label="Braki przygotowania">{ovokoPreparationIssues(source, draft).map(issue => <li key={issue}>{issue}</li>)}</ul>
        <p className="my-3 text-sm">Aktywna oferta z 1-10000 sztuk, bez zestawu i brakujacych zdjec. Wybierz zapisany rekord z Moich samochodow Ovoko; jego ID wypelni sie samo. Opony i felgi nie sa jeszcze obslugiwane. Zmiana zapasu podczas niedokonczonego transferu zatrzymuje wysylke.</p>
        <button type="button" className={button} disabled={publishing || attempted || creatingCar} onClick={openPublicationReview}>Sprawdz wysylke</button>
        <button type="button" className={`${button} ml-2 bg-orange-600`} disabled={busy || dictionaryBusy || modelsBusy || carsBusy || publishing || attempted || creatingCar} onClick={() => void publishSingle()}>{publishing ? "Wystawiam..." : "Wyslij do Ovoko"}</button>
        {publicationBlockers.length > 0 && <div className="mt-3 rounded-lg border border-amber-400/30 p-3 text-sm text-amber-200"><p className="font-bold">Co blokuje wystawienie:</p><ul className="mt-2 list-disc space-y-1 pl-5" aria-label="Blokady wystawienia">{publicationBlockers.map(issue => <li key={issue}>{issue}</li>)}</ul></div>}
        {review && <div className="mt-4 space-y-3 rounded-xl border border-orange-400/40 p-4"><h3 className="font-bold">Podsumowanie: {stockMode === "shared" ? 1 : source.stock} rekordow Ovoko; zapas: {source.stock}</h3><p>{source.title}</p><p>Numer: {draft.manufacturerCode}; cena za sztuke: {draft.price} {draft.currency}</p><p>Numery dodatkowe: {otherCodes?.join(", ") || "brak"}</p><p className="font-bold">Przenoszone zdjecia: {source.images.length} (identyczna cala galeria dla kazdego rekordu)</p><p>Kategoria: {dictionaries.categories?.find(row => row.id === draft.categoryId)?.name}; stan: {dictionaries.qualities?.find(row => row.id === draft.qualityId)?.name}; dostepnosc: {dictionaries.statuses?.find(row => row.id === draft.statusId)?.name}</p><p>Auto: {dictionaries.brands?.find(row => row.id === brandId)?.name} {dictionaries.models?.find(row => row.id === modelId)?.name}; rekord auta ID: {draft.donorId}</p>
          <p className="text-xs text-white/60">Nie zmieniamy istniejacych czesci ani Allegro. Po niepewnym wyniku nie ponawiamy automatycznie.</p>
        </div>}
      </section>
    </>}
  </section>;
}
