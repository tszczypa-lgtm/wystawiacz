import { checkoutPolicy } from "@/lib/checkout-policy";
import { salesDocumentPath } from "@/lib/sales-documents";

export function CheckoutAcceptance({ sandbox, disabled, acceptTerms, requestEarlyStart, onTerms, onEarlyStart }: {
  sandbox: boolean; disabled: boolean; acceptTerms: boolean; requestEarlyStart: boolean;
  onTerms(value: boolean): void; onEarlyStart(value: boolean): void;
}) {
  return <fieldset disabled={disabled} className="mt-5 grid gap-4 rounded-xl border border-white/20 p-4 text-sm">
    <legend className="px-2 font-bold">{sandbox ? "Proba formularza zamowienia - bez prawdziwej umowy i oplaty" : "Podsumowanie zamowienia"}</legend>
    <p>{checkoutPolicy.offer}</p>
    <p>Najpierw 30 dni bezplatnego testu wedlug terminu w panelu. Potem kupujesz dostep osobno; nie pobieramy oplaty automatycznie.</p>
    <p>Oplacony okres jest liczony od pozniejszej daty: potwierdzenia zaplaty, konca oplaconego dostepu albo konca okresu probnego. Nie skraca pozostalego dostepu.</p>
    <p><a className="underline" href="/regulamin" target="_blank" rel="noopener noreferrer">{sandbox ? "Projekt regulaminu" : "Regulamin"}</a> ({checkoutPolicy.termsVersion}) oraz <a className="underline" href="/prywatnosc" target="_blank" rel="noopener noreferrer">informacje o prywatnosci</a>.</p>
    <p>Pobierz dokumenty przed zamowieniem: <a className="underline" href={salesDocumentPath("regulamin")} download>regulamin TXT</a> oraz <a className="underline" href={salesDocumentPath("prywatnosc")} download>polityka prywatnosci TXT</a>.</p>
    <label className="flex items-start gap-3"><input type="checkbox" checked={acceptTerms} onChange={event => onTerms(event.target.checked)} /> <span>{sandbox ? "Testowo: " : ""}{checkoutPolicy.terms}</span></label>
    <label className="flex items-start gap-3"><input type="checkbox" checked={requestEarlyStart} onChange={event => onEarlyStart(event.target.checked)} /> <span>{sandbox ? "Testowo: " : ""}{checkoutPolicy.earlyStart}</span></label>
    <p className="text-white/70">{checkoutPolicy.withdrawal}</p>
    <p className="text-white/70">Jesli nie chcesz wczesniejszego rozpoczecia uslugi, nie zaznaczaj drugiego pola. Uzgodnij pozniejszy start przez <a className="underline" href="/kontakt">kontakt z uslugodawca</a>; ten formularz go jeszcze nie obsluguje.</p>
    {sandbox && <p className="text-amber-200">Dokumenty i oswiadczenia sa projektem do sprawdzenia. Zaznaczenia zapisuja tylko przebieg testu.</p>}
  </fieldset>;
}
