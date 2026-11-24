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

export type BulkOffer = { id: string; name: string; price: { amount: string; currency: string } | null };
type Job = { id: string; name: string; price: string; currency: string; state: "waiting" | "sending" | "done" | "skipped" | "error"; message: string; retryable: boolean; repair?: OvokoRepairHint; rule: OvokoPriceAdjustment; technical: boolean };
type Binding = { sellerId: string; fingerprint: string };
type Outcome = { ok: boolean; partId: string; alreadyCreated: boolean; price?: string; currency?: string; prepared?: Record<string, string> };
const field = "rounded-lg border border-white/20 bg-[#0d1117] px-3 py-1.5";
const button = "rounded-lg border border-white/20 px-3 py-1.5 text-sm font-bold disabled:opacity-40";
async function waitForTransferSlot(lastAttempt: { current: number }, stopped: { current: boolean }) {
  while (Date.now() - lastAttempt.current < 6250 && !stopped.current) await new Promise(resolve => setTimeout(resolve, 250));
  if (stopped.current) return false;
  lastAttempt.current = Date.now();
  return true;
}
async function waitForRateLimit(stopped: { current: boolean }) {
  for (let seconds = 0; seconds < 60 && !stopped.current; seconds++) await new Promise(resolve => setTimeout(resolve, 1000));
}
export function OvokoBulkPanel({ offers, onFinished }: { offers: BulkOffer[]; onFinished: () => void }) {
  const [mode, setMode] = useState<OvokoPriceAdjustment["mode"]>("none"), [value, setValue] = useState("0");
  const [running, setRunning] = useState(false), [jobs, setJobs] = useState<Job[]>([]), [message, setMessage] = useState("");
  const [fallbackVehicle, setFallbackVehicle] = useState<FallbackVehicle>(), [technical, setTechnical] = useState(true);
  const [recovering, setRecovering] = useState(false);
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
  function update(id: string, patch: Partial<Job>) { if (mounted.current) setJobs(previous => previous.map(job => job.id === id ? { ...job, ...patch } : job)); }
  async function begin(rule: OvokoPriceAdjustment, retry = false) {
    const session = await ovokoBulkRequest<{ ok: boolean; binding: Binding }>({ operation: "start", adjustment: rule });
    if (!session.ok || !session.binding) throw new Error("Nie potwierdzono kont docelowych.");
    if (retry && (!binding.current || session.binding.sellerId !== binding.current.sellerId || session.binding.fingerprint !== binding.current.fingerprint)) throw new Error("Konto Allegro lub Ovoko zmienilo sie. Otworz nowe okno z listy ofert.");
    binding.current = session.binding;
    return session.binding;
  }
  async function transfer(offer: BulkOffer, rule: OvokoPriceAdjustment, session: Binding, useTechnical: boolean, fallback?: FallbackVehicle, overrides?: OvokoCorrections, manualVehicle = false): Promise<boolean> {
    // The same pace applies to the batch and explicit one-row corrections.
    if (!await waitForTransferSlot(lastAttempt, stop)) return false;
    update(offer.id, { state: "sending", message: "Sprawdzam i przenosze..." });
    try { adjustedOvokoPrice(offer.price?.amount || "", offer.price?.currency || "", rule); } catch (error) { throw new OvokoBulkClientError((error as Error).message, 400); }
    const owned = await allegroRequest<{ offer: unknown; sellerId: string }>(`/ovoko-source/${offer.id}`);
    const source = ovokoSourcePreview(owned.offer, offer.id, offerDescriptionText);
    if (owned.sellerId !== session.sellerId) throw new OvokoBulkClientError("Konto Allegro zmienilo sie. Zatrzymano partie.", 409, "account_changed");
    if (!sameOvokoMoney(source.price, offer.price?.amount) || source.currency !== offer.price?.currency) throw new OvokoBulkClientError(`Cena Allegro zmienila sie od zaznaczenia (${offer.price?.amount} ${offer.price?.currency} -> ${source.price} ${source.currency}). Odswiez oferte.`, 400);
    if (stop.current) { update(offer.id, { state: "waiting", message: "Nie wyslano" }); return false; }
    const item = { offerId: offer.id, binding: session, adjustment: rule, notes: source.description, expectedSource: { title: source.title, price: source.price, currency: source.currency, stock: source.stock, status: source.status, condition: source.condition, images: source.images } };
    const preparation = await ovokoBulkRequest<Outcome & { category?: { id: string; name: string }; vehicle?: { brand: string; model: string; usedFallback: boolean; evidence?: string } }>({ ...item, operation: "prepare", allowTechnicalModel: useTechnical, ...(fallback ? { fallbackVehicle: fallback } : {}), ...(manualVehicle ? { manualVehicle: true } : {}), ...(overrides ? { overrides } : {}) });
    if (!preparation.alreadyCreated && stop.current) { update(offer.id, { state: "waiting", message: "Auto przygotowane. Czesc nie zostala wyslana." }); return false; }
    // Never cancel, repeat or unlock an uncertain write.
    const result = preparation.alreadyCreated ? preparation : await ovokoBulkRequest<Outcome>({ ...item, operation: "item", prepared: preparation.prepared });
    if (!result.ok || !/^[1-9]\d{0,11}$/.test(String(result.partId))) throw new Error("Niepewny wynik wysylki. Sprawdz Ovoko; nie ponawiaj.");
    const vehicle = preparation.vehicle ? ` Auto: ${preparation.vehicle.brand} ${preparation.vehicle.model}${preparation.vehicle.usedFallback ? " (model pomocniczy)" : ""}.${preparation.vehicle.evidence ? ` Zrodlo: ${preparation.vehicle.evidence}.` : ""}` : "";
    const category = !result.alreadyCreated && preparation.category ? ` Kategoria: ${preparation.category.name} (ID ${preparation.category.id}).` : "";
    update(offer.id, { state: result.alreadyCreated ? "skipped" : "done", retryable: false, message: `${result.alreadyCreated ? "Juz przeniesiona, pominieto" : "Przeniesiono"}. Ovoko ID: ${result.partId}.${category}${vehicle}`, ...(result.price ? { price: result.price, currency: result.currency || source.currency } : {}) });
    return true;
  }
  function failure(id: string, error: unknown) {
    const retryable = error instanceof OvokoBulkClientError && error.status === 400 && (!error.repair || error.repair.needsVehicle || error.repair.needsCategory);
    update(id, { state: "error", retryable, repair: error instanceof OvokoBulkClientError ? error.repair : undefined, message: error instanceof Error ? error.message : "Niepotwierdzony wynik." });
    // Each item has its own durable write lock. Never replay it; continue independent rows.
    return !((error instanceof OvokoBulkClientError || error instanceof AllegroClientError) && [401, 403].includes(error.status) || error instanceof OvokoBulkClientError && error.code === "account_changed");
  }
  function finish() { lock.current = false; if (mounted.current) { setJobs(previous => previous.map(job => job.state === "waiting" ? { ...job, message: "Nie wyslano w tej partii" } : job)); setRunning(false); onFinished(); } }
  async function start() {
    if (lock.current || !offers.length || offers.length > 200) return;
    lock.current = true; stop.current = false; setRunning(true); setMessage("");
    const snapshot = offers.map(offer => ({ ...offer, price: offer.price ? { ...offer.price } : null })), rule = { ...adjustment }, fallback = fallbackVehicle ? { ...fallbackVehicle } : undefined;
    setJobs(snapshot.map(offer => ({ id: offer.id, name: offer.name, price: price(offer, rule), currency: offer.price?.currency || "", state: "waiting", retryable: false, message: "Oczekuje", rule, technical })));
    try {
      const session = await begin(rule);
      for (const offer of snapshot) {
        if (stop.current) break;
        try { if (!await transfer(offer, rule, session, technical, fallback)) break; }
        catch (error) {
          if (!failure(offer.id, error)) throw error;
          if ((error instanceof OvokoBulkClientError || error instanceof AllegroClientError) && error.status === 429) {
            update(offer.id, { message: `${error.message} Pozostale pozycje rusza po 60 s przerwy.` });
            await waitForRateLimit(stop);
          }
        }
      }
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
      await transfer(offer, job.rule, session, job.technical, fallback, overrides, !!fallback);
      if (mounted.current) setMessage("Zakonczono poprawianie pozycji.");
    } catch (error) { failure(job.id, error); if (mounted.current) setMessage("Nie przeniesiono poprawianej pozycji. Sprawdz jej wynik ponizej."); }
    finally { finish(); }
  }
  return <section className="space-y-2 rounded-xl border border-orange-400/30 bg-orange-500/5 p-3" aria-label="Masowe przenoszenie do Ovoko">
    <h2 className="text-base font-bold">{running ? `Trwa przenoszenie partii (${jobs.length})` : `Przenies zaznaczone do Ovoko (${offers.length})`}</h2>
    <p className="text-xs text-white/65">Kopie ze zdjeciami. Allegro bez zmian. Wysylka wedlug Ovoko. Automat sprzedazy ma osobny wlacznik na liscie czesci. Do 200 pozycji, maks. 10 na minute.</p>
    <details className="text-xs text-white/65"><summary className="cursor-pointer">Dopasowanie i bezpieczenstwo</summary><p className="mt-1">Automat sprawdza tytul, Pasuje do i katalog po pelnym numerze. Model roboczy to tylko przypisanie techniczne do marki, nie potwierdzenie zgodnosci czesci. Blokady duplikatow i niepewnych zapisow pozostaja aktywne.</p></details>
    <OvokoFallbackVehicle disabled={running} onChange={setFallbackVehicle} />
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-sm">Cena w Ovoko<select aria-label="Cena w Ovoko" className={field} value={mode} disabled={running} onChange={event => setMode(event.target.value as OvokoPriceAdjustment["mode"])}><option value="none">Bez zmiany</option><option value="amount">Zmien o kwote</option><option value="percent">Zmien procentowo</option><option value="fixed">Ustaw cene</option></select></label>
      {mode !== "none" && <label className="flex flex-col gap-1 text-sm">{priceLabel}<input aria-label={priceLabel} className={`${field} w-44`} inputMode="decimal" value={value} disabled={running} onChange={event => setValue(event.target.value)} placeholder={mode === "fixed" ? "np. 100" : "np. -10 lub 15"} /></label>}
      <button className={`${button} bg-[#ff5a00]`} disabled={running || recovering || !offers.length || offers.length > 200} onClick={() => void start()}>{running ? "Przenoszenie trwa..." : "Przenies zaznaczone do Ovoko"}</button>
      {running && <button className={button} onClick={() => { stop.current = true; setMessage("Zatrzymuje po biezacym zadaniu. Nie przerywamy wysylki w trakcie."); }}>Zatrzymaj po biezacej</button>}
    </div>
    <label className="flex items-center gap-2 text-xs text-white/70"><input type="checkbox" checked={technical} disabled={running} onChange={event => setTechnical(event.target.checked)} />Gdy brak dopasowania, uzyj modelu roboczego rozpoznanej marki</label>
    <p className="text-xs text-white/50">Kwota dotyczy waluty oferty (PLN/EUR), bez przewalutowania. Minus obniza; procent zaokraglamy do 2 miejsc. Ustaw cene = jedna konkretna cena dla kazdej kopii. Zostaw okno otwarte.</p>
    {!jobs.length && !!offers.length && <div className="max-h-[50vh] overflow-auto text-sm"><table className="w-full text-left"><thead className="sticky top-0 bg-[#19191b]"><tr><th>Oferta</th><th>Allegro</th><th>Ovoko po korekcie</th></tr></thead><tbody>{offers.map(offer => <tr key={offer.id}><td className="max-w-md truncate py-1" title={offer.name}>{offer.name}</td><td className="whitespace-nowrap px-3">{offer.price?.amount} {offer.price?.currency}</td><td className="whitespace-nowrap">{price(offer)} {offer.price?.currency}</td></tr>)}</tbody></table></div>}
    {message && <p role="status" className="text-xs text-amber-200">{message} {summary}</p>}
    {!!jobs.length && <div className="max-h-[calc(100vh-330px)] min-h-48 divide-y divide-white/10 overflow-auto rounded border border-white/10 text-sm" aria-live="polite">{jobs.map(job => <div key={job.id} className="px-2 py-1.5" data-offer-id={job.id}>
      <div className="flex items-start justify-between gap-3"><a href={`/panel/inventory/prepare-ovoko?offerId=${job.id}`} target="_blank" rel="noopener noreferrer" className="min-w-0 font-semibold underline">{job.name}</a><span className="shrink-0 whitespace-nowrap text-xs text-white/70">{job.state === "skipped" ? "Cena istniejacej czesci bez zmian." : `${job.state === "done" ? "Cena wyslana" : "Cena planowana"}: ${job.price} ${job.currency}`}</span></div>
      <p className={`text-xs leading-5 ${job.state === "done" || job.state === "skipped" ? "text-emerald-300" : job.state === "error" ? "text-amber-200" : "text-white/60"}`}>{job.message}</p>
      {job.retryable && <OvokoJobRepair key={`${job.id}:${JSON.stringify(job.repair)}`} id={job.id} hint={job.repair} disabled={running || recovering} onTransfer={(vehicle, corrections) => void retry(job, vehicle, corrections)} />}
      {job.state === "error" && !running && <>
        <ManualOvokoOverride offerId={job.id} brandId={job.repair?.vehicle?.brandId || job.repair?.brandId || ""} modelId={job.repair?.vehicle?.modelId || ""} year={job.repair?.vehicle?.year || ""} disabled={recovering} onBusyChange={busy => { lock.current = busy; setRecovering(busy); }} onResolved={result => {
          if (result.kind === "part" && result.foundId) update(job.id, { state: "skipped", retryable: false, message: `Potwierdzono istniejaca czesc Ovoko ID: ${result.foundId}. Powiazanie naprawione; nie utworzono duplikatu.` });
          else update(job.id, { retryable: true, repair: job.repair || { needsVehicle: false, needsCategory: false, brandId: "", categoryId: "" }, message: `${result.message} Kliknij Uzupelnij i przenies, aby ponowic tylko te pozycje z zachowana cena.` });
        }} />
        <ManualOvokoLauncher offerId={job.id} />
      </>}
    </div>)}</div>}
  </section>;
}
