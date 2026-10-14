"use client";

import type { CompanyDetails } from "@/lib/account-validation";

export function CompanyFields({ value, onChange, disabled = false }: { value: CompanyDetails; onChange: (value: CompanyDetails) => void; disabled?: boolean }) {
  const person = value.customerType === "person";
  const fields: [keyof CompanyDetails, string, string, number][] = [["name", person ? "Imię i nazwisko" : "Nazwa firmy", person ? "name" : "organization", 200], ...(!person ? [["nip", "NIP", "off", 20] as [keyof CompanyDetails, string, string, number]] : []), ["street", "Ulica i numer", "street-address", 200], ["postcode", "Kod pocztowy", "postal-code", 6], ["city", "Miejscowość", "address-level2", 100]];
  return <fieldset disabled={disabled} className="grid gap-3">
    <legend className="mb-3 font-bold">Dane klienta do rozliczeń (Polska)</legend>
    <label className="grid gap-2 text-sm font-bold">Kupuję jako
      <select value={person ? "person" : "business"} onChange={event => onChange({ ...value, nip: event.target.value === "person" ? "" : value.nip, customerType: event.target.value === "person" ? "person" : undefined })} className="rounded-xl border border-current/20 bg-transparent px-4 py-3">
        <option value="business" className="text-slate-900">Firma</option>
        <option value="person" className="text-slate-900">Osoba prywatna</option>
      </select>
    </label>
    {fields.map(([key, label, autoComplete, maxLength]) => <label key={key} className="grid gap-2 text-sm font-bold">{label}
      <input required maxLength={maxLength} autoComplete={autoComplete} value={value[key]} onChange={event => onChange({ ...value, [key]: event.target.value })} className="w-full rounded-xl border border-current/20 bg-transparent px-4 py-3 font-normal outline-none focus:border-[#ff8a3d]" />
    </label>)}
    <p className="text-xs opacity-60">Dane służą do rozliczeń. Nie są danymi sprzedawcy pobieranymi z Allegro.</p>
  </fieldset>;
}
