"use client";

import { useEffect, useRef, useState } from "react";
import { allegroRequest } from "@/lib/allegro-client";
import { ovokoBulkRequest, OvokoBulkClientError } from "@/lib/ovoko-bulk-client";
import { adjustedOvokoPrice, sameOvokoMoney, type OvokoPriceAdjustment } from "@/lib/ovoko-bulk-price";
import { offerDescriptionText, ovokoSourcePreview } from "@/lib/ovoko-preparation";
import { OvokoFallbackVehicle, type FallbackVehicle } from "./ovoko-fallback-vehicle";

export type BulkOffer = { id: string; name: string; price: { amount: string; currency: string } | null };
type Offer = BulkOffer;
type Job = { id: string; name: string; price: string; currency: string; state: "waiting" | "sending" | "done" | "skipped" | "error"; message: string };
const field = "rounded-lg border border-white/20 bg-[#0d1117] px-3 py-2";
const button = "rounded-lg border border-white/20 px-3 py-2 text-sm font-bold disabled:opacity-40";
export function OvokoBulkPanel({ offers, onFinished }: { offers: Offer[]; onFinished: () => void }) {
  const [mode, setMode] = useState<OvokoPriceAdjustment["mode"]>("none"), [value, setValue] = useState("0");
  const [running, setRunning] = useState(false), [jobs, setJobs] = useState<Job[]>([]), [message, setMessage] = useState("");
  const [fallbackVehicle, setFallbackVehicle] = useState<FallbackVehicle>();
  const lock = useRef(false), stop = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; stop.current = true; }; }, []);
  useEffect(() => {
    if (!running) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [running]);
  const adjustment = { mode, value: mode === "none" ? "0" : value.replace(",", ".") };
  function price(offer: Offer) {
    try { return adjustedOvokoPrice(offer.price?.amount || "", offer.price?.currency || "", adjustment); }
    catch (error) { return (error as Error).message; }
  }
  async function start() {
    if (lock.current || !offers.length || offers.length > 100) return;
    lock.current = true; stop.current = false; setRunning(true); setMessage("");
    const snapshot = offers.map(offer => ({ ...offer, price: offer.price ? { ...offer.price } : null })), rule = { ...adjustment }, fallback = fallbackVehicle ? { ...fallbackVehicle } : undefined;
    let created = 0, skipped = 0, failed = 0;
    const summary = () => `Przeniesiono: ${created}; pominieto: ${skipped}; bledy: ${failed}; niewyslane: ${snapshot.length - created - skipped - failed}.`;
    const update = (id: string, patch: Partial<Job>) => { if (mounted.current) setJobs(previous => previous.map(job => job.id === id ? { ...job, ...patch } : job)); };
    setJobs(snapshot.map(offer => ({ id: offer.id, name: offer.name, price: price(offer), currency: offer.price?.currency || "", state: "waiting", message: "Oczekuje" })));
    try {
      const session = await ovokoBulkRequest<{ ok: boolean; binding: { sellerId: string; fingerprint: string } }>({ operation: "start", adjustment: rule });
      if (!session.ok || !session.binding) throw new Error("Nie potwierdzono kont docelowych.");
      for (let i = 0; i < snapshot.length; i++) {
        if (stop.current) break;
        const offer = snapshot[i];
        update(offer.id, { state: "sending", message: "Sprawdzam i przenosze..." });
        try {
          try { adjustedOvokoPrice(offer.price?.amount || "", offer.price?.currency || "", rule); } catch (error) { throw new OvokoBulkClientError((error as Error).message, 400); }
          const owned = await allegroRequest<{ offer: unknown; sellerId: string }>(`/ovoko-source/${offer.id}`);
          const source = ovokoSourcePreview(owned.offer, offer.id, offerDescriptionText);
          if (owned.sellerId !== session.binding.sellerId) throw new Error("Konto Allegro zmienilo sie. Zatrzymano partie.");
          if (!sameOvokoMoney(source.price, offer.price?.amount) || source.currency !== offer.price?.currency) throw new OvokoBulkClientError(`Cena Allegro zmienila sie od zaznaczenia (${offer.price?.amount} ${offer.price?.currency} -> ${source.price} ${source.currency}). Odswiez oferte.`, 400);
          if (stop.current) { update(offer.id, { state: "waiting", message: "Nie wyslano" }); break; }
          // Do not abort or retry an in-flight write: its durable publication lock owns the outcome.
          const item = { offerId: offer.id, binding: session.binding, adjustment: rule, notes: source.description, expectedSource: { title: source.title, price: source.price, currency: source.currency, stock: source.stock, status: source.status, condition: source.condition, images: source.images } };
          type Outcome = { ok: boolean; partId: string; alreadyCreated: boolean; price?: string; currency?: string; prepared?: Record<string, string> };
          const preparation = await ovokoBulkRequest<Outcome & { vehicle?: { brand: string; model: string; usedFallback: boolean } }>({ ...item, operation: "prepare", ...(fallback ? { fallbackVehicle: fallback } : {}) });
          if (preparation.vehicle) update(offer.id, { message: `Auto: ${preparation.vehicle.brand} ${preparation.vehicle.model}${preparation.vehicle.usedFallback ? " (model pomocniczy)" : ""}. Przygotowano do wysylki.` });
          if (!preparation.alreadyCreated && stop.current) { update(offer.id, { state: "waiting", message: "Auto przygotowane. Czesc nie zostala wyslana." }); break; }
          const result = preparation.alreadyCreated ? preparation : await ovokoBulkRequest<Outcome>({ ...item, operation: "item", prepared: preparation.prepared });
          if (!result.ok || !/^[1-9]\d{0,11}$/.test(String(result.partId))) throw new Error("Niepewny wynik wysylki. Sprawdz Ovoko; nie ponawiaj.");
          if (result.alreadyCreated) skipped++; else created++;
          const vehicle = preparation.vehicle ? ` Auto: ${preparation.vehicle.brand} ${preparation.vehicle.model}${preparation.vehicle.usedFallback ? " (model pomocniczy)" : ""}.` : "";
          update(offer.id, { state: result.alreadyCreated ? "skipped" : "done", message: `${result.alreadyCreated ? "Juz przeniesiona, pominieto" : "Przeniesiono"}. Ovoko ID: ${result.partId}.${vehicle}`, ...(result.price ? { price: result.price, currency: result.currency } : {}) });
        } catch (error) {
          failed++;
          update(offer.id, { state: "error", message: error instanceof Error ? error.message : "Niepotwierdzony wynik." });
          if (!(error instanceof OvokoBulkClientError) || error.status !== 400) throw error;
        }
        // Pace calls below the server budget; never retry rate limits or ambiguous writes.
        if (i < snapshot.length - 1) for (let tick = 0; tick < 25 && !stop.current; tick++) await new Promise(resolve => setTimeout(resolve, 250));
      }
      if (mounted.current) setMessage(`${stop.current ? "Zatrzymano. Pozostale pozycje nie zostaly wyslane." : "Partia zakonczona."} ${summary()}`);
    } catch (error) {
      if (mounted.current) setMessage(`Partia zatrzymana: ${error instanceof Error ? error.message : "nie potwierdzono wyniku"} ${summary()} Nie ponawiamy automatycznie.`);
    } finally {
      lock.current = false;
      if (mounted.current) { setJobs(previous => previous.map(job => job.state === "waiting" ? { ...job, message: "Nie wyslano w tej partii" } : job)); setRunning(false); onFinished(); }
    }
  }
  return <section className="space-y-3 rounded-2xl border border-orange-400/30 bg-orange-500/5 p-4" aria-label="Masowe przenoszenie do Ovoko">
    <h2 className="text-lg font-bold">{running ? `Trwa przenoszenie partii (${jobs.length})` : `Przenies zaznaczone do Ovoko (${offers.length})`}</h2>
    <p className="text-sm text-white/65">Kopiujemy zaznaczone oferty z tej strony ze zdjeciami, automatycznym dopasowaniem i ochrona przed duplikatem. Allegro pozostaje bez zmian. Nie ma jeszcze synchronizacji sprzedazy; obowiazuje wysylka ustawiona w Ovoko.</p>
    <OvokoFallbackVehicle disabled={running} onChange={setFallbackVehicle} />
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-sm">Cena w Ovoko<select aria-label="Cena w Ovoko" className={field} value={mode} disabled={running} onChange={event => setMode(event.target.value as OvokoPriceAdjustment["mode"])}><option value="none">Bez zmiany</option><option value="amount">Zmien o kwote</option><option value="percent">Zmien procentowo</option></select></label>
      {mode !== "none" && <label className="flex flex-col gap-1 text-sm">{mode === "amount" ? "Kwota w walucie oferty" : "Procent (%)"}<input aria-label={mode === "amount" ? "Kwota w walucie oferty" : "Procent (%)"} className={`${field} w-48`} inputMode="decimal" value={value} disabled={running} onChange={event => setValue(event.target.value)} placeholder="np. -10 lub 15" /></label>}
      <button className={`${button} bg-[#ff5a00]`} disabled={running || !offers.length || offers.length > 100} onClick={() => void start()}>{running ? "Przenoszenie trwa..." : "Przenies zaznaczone do Ovoko"}</button>
      {running && <button className={button} onClick={() => { stop.current = true; setMessage("Zatrzymuje po biezacym zadaniu. Nie przerywamy wysylki w trakcie."); }}>Zatrzymaj po biezacej</button>}
    </div>
    <p className="text-xs text-white/60">Minus obniza, plus lub liczba bez znaku podwyzsza cene. Kwota dotyczy PLN/EUR danej oferty, bez przewalutowania. Procent zaokraglamy do 2 miejsc. Zostaw te karte otwarta; wysylamy kolejno, maksymalnie 10 pozycji na minute.</p>
    {!running && !!offers.length && <div className="max-h-48 overflow-auto text-sm"><table className="w-full text-left"><thead><tr><th>Oferta</th><th>Allegro</th><th>Ovoko po korekcie</th></tr></thead><tbody>{offers.map(offer => <tr key={offer.id}><td className="max-w-md truncate py-1">{offer.name}</td><td className="whitespace-nowrap px-3">{offer.price?.amount} {offer.price?.currency}</td><td>{price(offer)} {offer.price?.currency}</td></tr>)}</tbody></table></div>}
    {message && <p role="status" className="text-sm text-amber-200">{message}</p>}
    {!!jobs.length && <div className="max-h-80 space-y-2 overflow-auto text-sm" aria-live="polite">{jobs.map(job => <div key={job.id} className="rounded-lg border border-white/10 p-2"><a href={`/panel/inventory/prepare-ovoko?offerId=${job.id}`} target="_blank" rel="noopener noreferrer" className="font-bold underline">{job.name}</a><p>{job.state === "skipped" ? "Cena istniejacej czesci bez zmian." : `${job.state === "done" ? "Cena wyslana" : "Cena planowana"}: ${job.price} ${job.currency}`}</p><p className={job.state === "done" || job.state === "skipped" ? "text-emerald-300" : job.state === "error" ? "text-amber-200" : "text-white/60"}>{job.message}</p></div>)}</div>}
  </section>;
}
