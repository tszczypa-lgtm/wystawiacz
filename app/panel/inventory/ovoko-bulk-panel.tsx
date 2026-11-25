"use client";

import { useEffect, useRef, useState } from "react";
import { allegroRequest, AllegroClientError } from "@/lib/allegro-client";
import { ovokoBulkRequest, OvokoBulkClientError } from "@/lib/ovoko-bulk-client";
import { adjustedOvokoPrice, sameOvokoMoney, type OvokoPriceAdjustment } from "@/lib/ovoko-bulk-price";
import { offerDescriptionText, ovokoSourcePreview } from "@/lib/ovoko-preparation";
import { OvokoFallbackVehicle, type FallbackVehicle } from "./ovoko-fallback-vehicle";
import { OvokoJobRepair, type OvokoCorrections } from "./ovoko-job-repair";
import type { OvokoRepairHint } from "@/lib/ovoko-read";
import { ManualOvokoLauncher } from "./manual-ovoko-launcher";
import { ManualOvokoOverride } from "./manual-override";
import { resolveManualOvokoOverride, ManualOverrideClientError } from "@/lib/ovoko-manual-client";

export type BulkOffer = { id: string; name: string; price: { amount: string; currency: string } | null };
type StockMode = "shared" | "separate";
type Job = { id: string; name: string; price: string; currency: string; state: "waiting" | "sending" | "done" | "skipped" | "error"; message: string; retryable: boolean; code?: string; repair?: OvokoRepairHint; rule: OvokoPriceAdjustment; technical: boolean; stockMode: StockMode; multiStock?: boolean; completedUnits?: number; totalUnits?: number; sourceUrl?: string };
function vehicleKey(job: Job) {
  const vehicle = job.repair?.vehicle;
  return job.state === "error" && job.code === "vehicle_creation_locked" && vehicle?.brandId && vehicle.modelId && /^[12]\d{3}$/.test(vehicle.year) ? `${vehicle.brandId}:${vehicle.modelId}:${vehicle.year}` : "";
}
type Binding = { sellerId: string; fingerprint: string };
type Outcome = { ok: boolean; partId: string; alreadyCreated: boolean; completedUnits?: number; totalUnits?: number; initialStock?: number; moreUnits?: boolean; message?: string; price?: string; currency?: string; prepared?: Record<string, string>; webPending?: boolean; retryAfter?: number };
const field = "rounded-lg border border-white/20 bg-[#0d1117] px-3 py-1.5";
const button = "rounded-lg border border-white/20 px-3 py-1.5 text-sm font-bold disabled:opacity-40";
function recordTransferAttempt(lastAttempt: { current: number }) {
  lastAttempt.current = Date.now();
}
async function waitForTransferSlot(lastAttempt: { current: number }, stopped: { current: boolean }, interval = 6250) {
  while (Date.now() - lastAttempt.current < interval && !stopped.current) await new Promise(resolve => setTimeout(resolve, 250));
  if (stopped.current) return false;
  recordTransferAttempt(lastAttempt);
  return true;
}
async function waitForRateLimit(stopped: { current: boolean }) {
  for (let seconds = 0; seconds < 60 && !stopped.current; seconds++) await new Promise(resolve => setTimeout(resolve, 1000));
}
export function OvokoBulkPanel({ offers, onFinished }: { offers: BulkOffer[]; onFinished: () => void }) {
  const [mode, setMode] = useState<OvokoPriceAdjustment["mode"]>("none"), [value, setValue] = useState("0");
  const [stockMode, setStockMode] = useState<StockMode>("shared");
  const [running, setRunning] = useState(false), [jobs, setJobs] = useState<Job[]>([]), [message, setMessage] = useState("");
  const [fallbackVehicle, setFallbackVehicle] = useState<FallbackVehicle>(), [technical, setTechnical] = useState(true);
  const [recovering, setRecovering] = useState(false);
  const [queuedRecovery, setQueuedRecovery] = useState<string[]>([]);
  const jobsRef = useRef<Job[]>([]), pendingRecovery = useRef<string[]>([]), lastRecovery = useRef(0);
  const lock = useRef(false), stop = useRef(false), mounted = useRef(true), lastAttempt = useRef(0), binding = useRef<Binding | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; stop.current = true; }; }, []);
  useEffect(() => {
    if (!running) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [running]);
  const adjustment: OvokoPriceAdjustment = { mode, value: mode === "none" ? "0" : value.replace(",", ".") };
  const priceLabel = mode === "percent" ? "Procent (%)" : mode === "fixed" ? "Konkretna cena w walucie oferty" : "Kwota w walucie oferty";
  const counts = { created: jobs.filter(job => job.state === "done").length, skipped: jobs.filter(job => job.state === "skipped").length, failed: jobs.filter(job => job.state === "error").length, pending: jobs.filter(job => ["waiting", "sending"].includes(job.state)).length };
  const summary = `Przeniesiono: ${counts.created}; pominieto: ${counts.skipped}; bledy: ${counts.failed}; niewyslane: ${counts.pending}.`;
  function price(offer: BulkOffer, rule = adjustment) {
    try { return adjustedOvokoPrice(offer.price?.amount || "", offer.price?.currency || "", rule); }
    catch (error) { return (error as Error).message; }
  }
  function replaceJobs(next: Job[]) { jobsRef.current = next; if (mounted.current) setJobs(next); }
  function update(id: string, patch: Partial<Job>) { replaceJobs(jobsRef.current.map(job => job.id === id ? { ...job, ...patch } : job)); }
  async function begin(rule: OvokoPriceAdjustment, retry = false) {
    const session = await ovokoBulkRequest<{ ok: boolean; binding: Binding }>({ operation: "start", adjustment: rule });
    if (!session.ok || !session.binding) throw new Error("Nie potwierdzono kont docelowych.");
    if (retry && (!binding.current || session.binding.sellerId !== binding.current.sellerId || session.binding.fingerprint !== binding.current.fingerprint)) throw new Error("Konto Allegro lub Ovoko zmienilo sie. Otworz nowe okno z listy ofert.");
    binding.current = session.binding;
    return session.binding;
  }
  async function transfer(offer: BulkOffer, rule: OvokoPriceAdjustment, session: Binding, useTechnical: boolean, selectedStockMode: StockMode, fallback?: FallbackVehicle, overrides?: OvokoCorrections, manualVehicle = false): Promise<boolean> {
    // The same pace applies to the batch and explicit one-row corrections.
    if (!await waitForTransferSlot(lastAttempt, stop)) return false;
    update(offer.id, { state: "sending", message: "Sprawdzam model i rok. Gdy brakuje danych, wyszukiwanie internetowe moze potrwac do minuty...", sourceUrl: undefined });
    try { adjustedOvokoPrice(offer.price?.amount || "", offer.price?.currency || "", rule); } catch (error) { throw new OvokoBulkClientError((error as Error).message, 400); }
    const owned = await allegroRequest<{ offer: unknown; sellerId: string }>(`/ovoko-source/${offer.id}`);
    const source = ovokoSourcePreview(owned.offer, offer.id, offerDescriptionText);
    update(offer.id, { multiStock: source.stock !== null && source.stock > 1 });
    if (owned.sellerId !== session.sellerId) throw new OvokoBulkClientError("Konto Allegro zmienilo sie. Zatrzymano partie.", 409, "account_changed");
    if (!sameOvokoMoney(source.price, offer.price?.amount) || source.currency !== offer.price?.currency) throw new OvokoBulkClientError(`Cena Allegro zmienila sie od zaznaczenia (${offer.price?.amount} ${offer.price?.currency} -> ${source.price} ${source.currency}). Odswiez oferte.`, 400);
    if (stop.current) { update(offer.id, { state: "waiting", message: "Nie wyslano" }); return false; }
    const item = { offerId: offer.id, binding: session, adjustment: rule, stockMode: selectedStockMode, notes: source.description, expectedSource: { title: source.title, price: source.price, currency: source.currency, stock: source.stock, status: source.status, condition: source.condition, images: source.images } };
    Object.assign(item.expectedSource,{stockUnit:source.stockUnit});
    type Preparation = Outcome & { category?: { id: string; name: string }; vehicle?: { brand: string; model: string; usedFallback: boolean; evidence?: string; sourceUrl?: string } };
    const prepareInput = { ...item, operation: "prepare", allowTechnicalModel: useTechnical, ...(fallback ? { fallbackVehicle: fallback } : {}), ...(manualVehicle ? { manualVehicle: true } : {}), ...(overrides ? { overrides } : {}) };
    let preparation = await ovokoBulkRequest<Preparation>(prepareInput);
    const waitingSince=Date.now();
    while(preparation.webPending){
      update(offer.id,{message:preparation.message||"Trwa wyszukiwanie internetowe. Czekam na wynik OpenAI..."});
      if(Date.now()-waitingSince>600000)throw new OvokoBulkClientError("OpenAI nie zakonczylo wyszukiwania w 10 minut. Czesc nie zostala wyslana; pozostale pozycje ida dalej.",400);
      const delay=Math.max(3,Math.min(15,preparation.retryAfter||5))*1000;
      for(let elapsed=0;elapsed<delay&&!stop.current;elapsed+=250)await new Promise(resolve=>setTimeout(resolve,250));
      if(stop.current){update(offer.id,{state:"waiting",message:"Zatrzymano oczekiwanie na OpenAI. Czesc nie zostala wyslana."});return false;}
      // Read-only preparation polling never retries importPart/importCar after an uncertain write.
      preparation=await ovokoBulkRequest<Preparation>(prepareInput);
    }
    try { const sourceUrl = new URL(preparation.vehicle?.sourceUrl || ""); if (sourceUrl.protocol === "https:" && !sourceUrl.username && !sourceUrl.password) update(offer.id, {sourceUrl:sourceUrl.href}); } catch { /* Optional citation only. */ }
    if (!preparation.alreadyCreated && stop.current) { update(offer.id, { state: "waiting", message: "Auto przygotowane. Czesc nie zostala wyslana." }); return false; }
    // Never cancel, repeat or unlock an uncertain write.
    let result = preparation;
    if (!preparation.alreadyCreated) {
      do {
        recordTransferAttempt(lastAttempt);
        result = await ovokoBulkRequest<Outcome>({ ...item, operation: "item", prepared: preparation.prepared });
        if (!result.ok || !/^[1-9]\d{0,11}$/.test(String(result.partId))) throw new Error("Niepewny wynik wysylki. Sprawdz Ovoko; nie ponawiaj.");
        update(offer.id, { completedUnits: result.completedUnits ?? 1, totalUnits: result.totalUnits ?? 1, message: `Potwierdzono rekordy Ovoko: ${result.completedUnits ?? 1}/${result.totalUnits ?? 1}. Zapas poczatkowy: ${result.initialStock ?? source.stock}. ID: ${result.partId}.` });
        if (result.alreadyCreated || !result.moreUnits) break;
        if (!await waitForTransferSlot(lastAttempt, stop)) {
          update(offer.id, { state: "waiting", message: `Zatrzymano po ${result.completedUnits}/${result.totalUnits} rekordow. Pozostale nie zostaly wyslane.` });
          return false;
        }
      } while (true);
    }
    if (!result.ok || !/^[1-9]\d{0,11}$/.test(String(result.partId))) throw new Error("Niepewny wynik wysylki. Sprawdz Ovoko; nie ponawiaj.");
    const vehicle = preparation.vehicle ? ` Auto: ${preparation.vehicle.brand} ${preparation.vehicle.model}${preparation.vehicle.usedFallback ? " (model pomocniczy)" : ""}.${preparation.vehicle.evidence ? ` Zrodlo: ${preparation.vehicle.evidence}.` : ""}` : "";
    const category = !result.alreadyCreated && preparation.category ? ` Kategoria: ${preparation.category.name} (ID ${preparation.category.id}).` : "";
    update(offer.id, { state: result.alreadyCreated ? "skipped" : "done", retryable: false, completedUnits: result.completedUnits ?? 1, totalUnits: result.totalUnits ?? 1, message: `${result.alreadyCreated ? "Juz przeniesiona, pominieto" : "Przeniesiono"}. Rekordy Ovoko: ${result.completedUnits ?? 1}/${result.totalUnits ?? 1}; zapas poczatkowy: ${result.initialStock ?? source.stock}. Ovoko ID: ${result.partId}.${category}${vehicle}${result.message ? ` ${result.message}` : ""}`, ...(result.price ? { price: result.price, currency: result.currency || source.currency } : {}) });
    return true;
  }
  function failure(id: string, error: unknown) {
    const retryable = error instanceof OvokoBulkClientError && error.status === 400 && (!error.repair || error.repair.needsVehicle || error.repair.needsCategory);
    const job = jobsRef.current.find(job => job.id === id);
    const progress = job?.completedUnits ? `Potwierdzono rekordy: ${job.completedUnits}/${job.totalUnits}. ` : "";
    update(id, { state: "error", retryable, code: error instanceof OvokoBulkClientError ? error.code : undefined, repair: error instanceof OvokoBulkClientError ? error.repair : undefined, message: progress + (error instanceof Error ? error.message : "Niepotwierdzony wynik.") });
    // Each item has its own durable write lock. Never replay it; continue independent rows.
    return !((error instanceof OvokoBulkClientError || error instanceof AllegroClientError) && [401, 403].includes(error.status) || error instanceof OvokoBulkClientError && error.code === "account_changed");
  }
  function finish() { lock.current = false; pendingRecovery.current = []; if (mounted.current) { setQueuedRecovery([]); replaceJobs(jobsRef.current.map(job => job.state === "waiting" && !job.completedUnits ? { ...job, message: "Nie wyslano w tej partii" } : job)); setRunning(false); onFinished(); } }
  async function drainVehicleRecovery(session: Binding) {
    while (pendingRecovery.current.length && !stop.current) {
      const first = jobsRef.current.find(job => job.id === pendingRecovery.current[0]);
      const key = first && vehicleKey(first);
      if (!key) { pendingRecovery.current.shift(); setQueuedRecovery([...pendingRecovery.current]); continue; }
      const group = jobsRef.current.filter(job => pendingRecovery.current.includes(job.id) && vehicleKey(job) === key);
      const vehicle = first!.repair!.vehicle!;
      // Two override calls per model: keep this below the separate six-calls/minute budget.
      if (!await waitForTransferSlot(lastRecovery, stop, 21000)) break;
      let resolved = false;
      try {
        await resolveManualOvokoOverride({ kind: "vehicle", offerId: first!.id, ...vehicle, binding: session });
        resolved = true;
        for (const job of group) {
          if (stop.current) break;
          const offer = offers.find(offer => offer.id === job.id); if (!offer) continue;
          try { await transfer(offer, job.rule, session, job.technical, job.stockMode, vehicle, job.repair?.categoryId ? { categoryId: job.repair.categoryId } : {}, true); }
          catch (error) {
            if (!failure(job.id, error)) throw error;
            if ((error instanceof OvokoBulkClientError || error instanceof AllegroClientError) && error.status === 429) await waitForRateLimit(stop);
          }
        }
      } catch (error) {
        for (const job of group) if (jobsRef.current.find(current => current.id === job.id)?.state === "error") update(job.id, { message: `${resolved ? "Nie przeniesiono czesci po sprawdzeniu auta" : "Nie odblokowano auta"}: ${error instanceof Error ? error.message : "Nie potwierdzono wyniku."}` });
        if ((error instanceof OvokoBulkClientError || error instanceof AllegroClientError || error instanceof ManualOverrideClientError) && [401, 403].includes(error.status) || (error instanceof OvokoBulkClientError || error instanceof ManualOverrideClientError) && error.code === "account_changed") throw error;
        if (error instanceof ManualOverrideClientError && error.status === 429) await waitForRateLimit(stop);
      } finally {
        const ids = new Set(group.map(job => job.id));
        pendingRecovery.current = pendingRecovery.current.filter(id => !ids.has(id)); setQueuedRecovery([...pendingRecovery.current]);
      }
    }
  }
  function queueVehicleRecovery() {
    const selected = jobsRef.current.filter(job => vehicleKey(job) && !pendingRecovery.current.includes(job.id));
    if (!selected.length || recovering) return;
    const models = new Set(selected.map(vehicleKey)).size;
    if (!window.confirm(`Sprawdzic i odblokowac ${models} rekordow aut dla ${selected.length} czesci? Akceptujesz ryzyko duplikatu po starej niepewnej probie. Istniejace auta wykorzystamy. Po odblokowaniu ponowimy tylko te czesci z zachowanymi cenami. Trwajacych zapisow nie przerywamy.`)) return;
    pendingRecovery.current.push(...selected.map(job => job.id)); setQueuedRecovery([...pendingRecovery.current]);
    setMessage("Zlecono odblokowanie aut. Wykonamy je pomiedzy wysylkami, bez przerywania biezacej pozycji.");
    if (!lock.current) void (async () => {
      lock.current = true; stop.current = false; setRunning(true);
      try { await drainVehicleRecovery(await begin(selected[0].rule, true)); }
      catch (error) { setMessage(error instanceof Error ? error.message : "Nie potwierdzono kont. Nie ponowiono czesci."); pendingRecovery.current = []; setQueuedRecovery([]); }
      finally { finish(); }
    })();
  }
  async function start() {
    if (lock.current || !offers.length || offers.length > 200) return;
    lock.current = true; stop.current = false; setRunning(true); setMessage("");
    const snapshot = offers.map(offer => ({ ...offer, price: offer.price ? { ...offer.price } : null })), rule = { ...adjustment }, fallback = fallbackVehicle ? { ...fallbackVehicle } : undefined;
    pendingRecovery.current = []; setQueuedRecovery([]);
    replaceJobs(snapshot.map(offer => ({ id: offer.id, name: offer.name, price: price(offer, rule), currency: offer.price?.currency || "", state: "waiting", retryable: false, message: "Oczekuje", rule, technical, stockMode })));
    try {
      const session = await begin(rule);
      for (const offer of snapshot) {
        await drainVehicleRecovery(session);
        if (stop.current) break;
        try { if (!await transfer(offer, rule, session, technical, stockMode, fallback)) break; }
        catch (error) {
          if (!failure(offer.id, error)) throw error;
          if ((error instanceof OvokoBulkClientError || error instanceof AllegroClientError) && error.status === 429) {
            update(offer.id, { message: `${error.message} Pozostale pozycje rusza po 60 s przerwy.` });
            await waitForRateLimit(stop);
          }
        }
      }
      await drainVehicleRecovery(session);
      if (mounted.current) setMessage(stop.current ? "Zatrzymano. Pozostale pozycje nie zostaly wyslane." : "Partia zakonczona.");
    } catch (error) {
      if (mounted.current) setMessage(`Partia zatrzymana: ${error instanceof Error ? error.message : "nie potwierdzono wyniku"} Nie ponawiamy automatycznie.`);
    } finally { finish(); }
  }
  async function retry(job: Job, fallback: FallbackVehicle | undefined, overrides: OvokoCorrections) {
    if (lock.current || !job.retryable) return;
    const offer = offers.find(offer => offer.id === job.id); if (!offer) return;
    lock.current = true; stop.current = false; setRunning(true); setMessage("");
    try {
      const session = await begin(job.rule, true);
      await transfer(offer, job.rule, session, job.technical, job.stockMode, fallback, overrides, !!fallback);
      await drainVehicleRecovery(session);
      if (mounted.current) setMessage("Zakonczono poprawianie pozycji.");
    } catch (error) { failure(job.id, error); if (mounted.current) setMessage("Nie przeniesiono poprawianej pozycji. Sprawdz jej wynik ponizej."); }
    finally { finish(); }
  }
  return <section className="space-y-2 rounded-xl border border-orange-400/30 bg-orange-500/5 p-3" aria-label="Masowe przenoszenie do Ovoko">
    <h2 className="text-base font-bold">{running ? `Trwa przenoszenie partii (${jobs.length})` : `Przenies zaznaczone do Ovoko (${offers.length})`}</h2>
    <p className="text-xs text-white/65">Kopie ze zdjeciami. Allegro bez zmian. Wysylka wedlug Ovoko. Automat sprzedazy ma osobny wlacznik na liscie czesci. Do 200 pozycji, maks. 10 na minute.</p>
    <fieldset disabled={running || recovering} className="space-y-1 text-sm"><legend className="font-bold">Oferty z wieloma sztukami</legend>
      <label className="block"><input type="radio" name="bulk-stock-mode" checked={stockMode === "shared"} onChange={() => setStockMode("shared")} /> Jedna pozycja dla calego zapasu (zalecane)</label>
      <label className="block"><input type="radio" name="bulk-stock-mode" checked={stockMode === "separate"} onChange={() => setStockMode("separate")} /> Kazda sztuka osobno</label>
      <p className="text-xs text-white/70">{stockMode === "shared" ? "Kupujacy Ovoko kupuje jedna sztuke naraz." : "Kazdy egzemplarz ma osobna pozycje."}</p>
      <p className="text-xs text-white/60">Jedna oferta Allegro = jeden wspolny rekord albo N rekordow Ovoko. Identyczne wspolne zdjecia, cena za sztuke. Trybu rozpoczetego transferu nie mozna zmienic. W trybie wspolnym automat sprzedazy moze ponownie uaktywnic ten sam rekord po sprzedazy, gdy pozostaje zapas; nie tworzy nowego rekordu.</p>
    </fieldset>
    <details className="text-xs text-white/65"><summary className="cursor-pointer">Dopasowanie i bezpieczenstwo</summary><p className="mt-1">Automat sprawdza tytul, Pasuje do i katalog po pelnym numerze. Model roboczy to tylko przypisanie techniczne do marki, nie potwierdzenie zgodnosci czesci. Blokady duplikatow i niepewnych zapisow pozostaja aktywne.</p></details>
    <OvokoFallbackVehicle disabled={running} onChange={setFallbackVehicle} />
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-sm">Cena w Ovoko<select aria-label="Cena w Ovoko" className={field} value={mode} disabled={running} onChange={event => setMode(event.target.value as OvokoPriceAdjustment["mode"])}><option value="none">Bez zmiany</option><option value="amount">Zmien o kwote</option><option value="percent">Zmien procentowo</option><option value="fixed">Ustaw cene</option></select></label>
      {mode !== "none" && <label className="flex flex-col gap-1 text-sm">{priceLabel}<input aria-label={priceLabel} className={`${field} w-44`} inputMode="decimal" value={value} disabled={running} onChange={event => setValue(event.target.value)} placeholder={mode === "fixed" ? "np. 100" : "np. -10 lub 15"} /></label>}
      <button className={`${button} bg-[#ff5a00]`} disabled={running || recovering || !offers.length || offers.length > 200} onClick={() => void start()}>{running ? "Przenoszenie trwa..." : "Przenies zaznaczone do Ovoko"}</button>
      {running && <button className={button} onClick={() => { stop.current = true; setMessage("Zatrzymuje po biezacym zadaniu. Nie przerywamy wysylki w trakcie."); }}>Zatrzymaj po biezacej</button>}
      {jobs.some(job => vehicleKey(job)) && <button className={`${button} border-orange-300/50`} disabled={recovering || !jobs.some(job => vehicleKey(job) && !queuedRecovery.includes(job.id))} onClick={queueVehicleRecovery}>Odblokuj auta z bledow ({new Set(jobs.filter(job => !queuedRecovery.includes(job.id)).map(vehicleKey).filter(Boolean)).size})</button>}
    </div>
    <label className="flex items-center gap-2 text-xs text-white/70"><input type="checkbox" checked={technical} disabled={running} onChange={event => setTechnical(event.target.checked)} />Gdy brak dopasowania, uzyj modelu roboczego rozpoznanej marki</label>
    <p className="text-xs text-white/50">Kwota dotyczy waluty oferty (PLN/EUR), bez przewalutowania. Minus obniza; procent zaokraglamy do 2 miejsc. Ustaw cene = jedna konkretna cena dla kazdej kopii. Zostaw okno otwarte.</p>
    {!jobs.length && !!offers.length && <div className="max-h-[50vh] overflow-auto text-sm"><table className="w-full text-left"><thead className="sticky top-0 bg-[#19191b]"><tr><th>Oferta</th><th>Allegro</th><th>Ovoko po korekcie</th></tr></thead><tbody>{offers.map(offer => <tr key={offer.id}><td className="max-w-md truncate py-1" title={offer.name}>{offer.name}</td><td className="whitespace-nowrap px-3">{offer.price?.amount} {offer.price?.currency}</td><td className="whitespace-nowrap">{price(offer)} {offer.price?.currency}</td></tr>)}</tbody></table></div>}
    {message && <p role="status" className="text-xs text-amber-200">{message} {summary}</p>}
    {!!jobs.length && <div className="max-h-[calc(100vh-330px)] min-h-48 divide-y divide-white/10 overflow-auto rounded border border-white/10 text-sm" aria-live="polite">{jobs.map(job => <div key={job.id} className="px-2 py-1.5" data-offer-id={job.id}>
      <div className="flex items-start justify-between gap-3"><a href={`/panel/inventory/prepare-ovoko?offerId=${job.id}`} target="_blank" rel="noopener noreferrer" className="min-w-0 font-semibold underline">{job.name}</a><span className="shrink-0 whitespace-nowrap text-xs text-white/70">{job.state === "skipped" ? "Cena istniejacej czesci bez zmian." : `${job.state === "done" ? "Cena wyslana" : "Cena planowana"}: ${job.price} ${job.currency}`}</span></div>
      <p className={`text-xs leading-5 ${job.state === "done" || job.state === "skipped" ? "text-emerald-300" : job.state === "error" ? "text-amber-200" : "text-white/60"}`}>{job.message}</p>
      {job.sourceUrl && <a href={job.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-emerald-200 underline">Zrodlo modelu i roku</a>}
      {job.retryable && <OvokoJobRepair key={`${job.id}:${JSON.stringify(job.repair)}`} id={job.id} hint={job.repair} disabled={running || recovering} onTransfer={(vehicle, corrections) => void retry(job, vehicle, corrections)} />}
      {job.state === "error" && !job.multiStock && !job.code?.startsWith("stock_") && <>
        {running && <p className="text-xs text-white/60">{queuedRecovery.includes(job.id) ? "Auto w kolejce do odblokowania." : vehicleKey(job) ? "Uzyj Odblokuj auta z bledow nad lista; pozostale pozycje ida dalej." : "Reczne poprawienie dostepne po zakonczeniu lub zatrzymaniu partii."}</p>}
        {!running && <ManualOvokoOverride offerId={job.id} brandId={job.repair?.vehicle?.brandId || job.repair?.brandId || ""} modelId={job.repair?.vehicle?.modelId || ""} year={job.repair?.vehicle?.year || ""} disabled={recovering} continueTransfer onBusyChange={busy => { lock.current = busy; setRecovering(busy); }} onResolved={result => {
          if (result.kind === "part" && result.foundId) update(job.id, { state: "skipped", retryable: false, message: `Potwierdzono istniejaca czesc Ovoko ID: ${result.foundId}. Powiazanie naprawione; nie utworzono duplikatu.` });
          else {
            const vehicle = job.repair?.vehicle;
            void retry({ ...job, retryable: true }, vehicle?.brandId && vehicle.modelId ? vehicle : undefined, job.repair?.categoryId ? { categoryId: job.repair.categoryId } : {});
          }
        }} />}
        {!running && <ManualOvokoLauncher offerId={job.id} />}
      </>}
    </div>)}</div>}
  </section>;
}
