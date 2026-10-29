import { checkoutPolicy } from "@/lib/checkout-policy";
import { salesDocumentPath } from "@/lib/sales-documents";

export function CheckoutAcceptance({ sandbox, disabled, acceptTerms, requestEarlyStart, onTerms, onEarlyStart }: {
  sandbox: boolean; disabled: boolean; acceptTerms: boolean; requestEarlyStart: boolean;
  onTerms(value: boolean): void; onEarlyStart(value: boolean): void;
}) {
  return <fieldset disabled={disabled} className="mt-5 grid gap-3 rounded-xl border border-white/20 p-4 text-sm">
    <legend className="px-2 font-bold">{sandbox ? "Test zamówienia (bez opłaty)" : "Podsumowanie zamówienia"}</legend>
    <p>{checkoutPolicy.offer}</p>
    <p className="text-white/70">Miesiąc dopisujemy po końcu obecnego dostępu lub próby, nie wcześniej niż po potwierdzeniu zapłaty.</p>
    <label className="flex items-start gap-3"><input type="checkbox" checked={acceptTerms} onChange={event => onTerms(event.target.checked)} /> <span>{checkoutPolicy.terms} <a className="underline" href="/regulamin" target="_blank" rel="noopener noreferrer">Przeczytaj regulamin</a>.</span></label>
    <label className="flex items-start gap-3"><input type="checkbox" checked={requestEarlyStart} onChange={event => onEarlyStart(event.target.checked)} /> <span>{checkoutPolicy.earlyStart}</span></label>
    <p className="text-xs leading-5 text-white/70">{checkoutPolicy.withdrawal} Późniejszy start: nie zaznaczaj drugiego pola i <a className="underline" href="/kontakt">skontaktuj się przed zamówieniem</a>.</p>
    <details className="text-xs text-white/70">
      <summary className="cursor-pointer underline">Dokumenty i szczegóły dostępu</summary>
      <div className="mt-2 grid gap-2">
        <p>30 dni bezpłatnej próby według terminu w panelu. Po próbie każdy płatny miesiąc kupujesz osobno.</p>
        <p>Wersja regulaminu: {checkoutPolicy.termsVersion}. <a className="underline" href="/prywatnosc" target="_blank" rel="noopener noreferrer">Polityka prywatności</a>.</p>
        <p>Pobierz: <a className="underline" href={salesDocumentPath("regulamin")} download>regulamin TXT</a> oraz <a className="underline" href={salesDocumentPath("prywatnosc")} download>polityka prywatności TXT</a>.</p>
      </div>
    </details>
    {sandbox && <p className="text-xs text-amber-200">Sandbox: bez prawdziwej umowy, opłaty i aktywacji. Formularz sprawdza zamówienie według opublikowanych dokumentów; nie uruchamia płatnej usługi.</p>}
  </fieldset>;
}
