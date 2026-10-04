"use client";

import type { CompanyDetails } from "@/lib/account-validation";

export function CompanyFields({ value, onChange, disabled = false }: { value: CompanyDetails; onChange: (value: CompanyDetails) => void; disabled?: boolean }) {
  const fields: [keyof CompanyDetails, string, string, number][] = [["name", "Nazwa firmy", "organization", 200], ["nip", "NIP", "off", 20], ["street", "Ulica i numer", "street-address", 200], ["postcode", "Kod pocztowy", "postal-code", 6], ["city", "Miejscowość", "address-level2", 100]];
  return <fieldset disabled={disabled} className="grid gap-3">
    <legend className="mb-3 font-bold">Dane firmy do faktury (Polska)</legend>
    {fields.map(([key, label, autoComplete, maxLength]) => <label key={key} className="grid gap-2 text-sm font-bold">{label}
      <input required maxLength={maxLength} autoComplete={autoComplete} value={value[key]} onChange={event => onChange({ ...value, [key]: event.target.value })} className="w-full rounded-xl border border-current/20 bg-transparent px-4 py-3 font-normal outline-none focus:border-[#ff8a3d]" />
    </label>)}
    <p className="text-xs opacity-60">Dane służą do rozliczeń. Nie są danymi sprzedawcy pobieranymi z Allegro.</p>
  </fieldset>;
}
