import type { OvokoSourcePreview } from "./ovoko-preparation";
import type { OvokoReadRow } from "./ovoko-read";

export function ovokoCarYear(source: Pick<OvokoSourcePreview, "title" | "description" | "parameters">, model?: OvokoReadRow): { year: string; reason: string; technical: boolean } {
  const range = model?.years?.match(/^(\d{4})? - (\d{4})?$/);
  const valid = (year: string) => Number(year) >= 1886 && Number(year) <= new Date().getUTCFullYear() + 1 && (!range?.[1] || Number(year) >= Number(range[1])) && (!range?.[2] || Number(year) <= Number(range[2]));
  const years = (text: string) => [...text.matchAll(/(?<![A-Za-z0-9])(?:19|20)\d{2}(?![A-Za-z0-9])/g)].map(match => match[0]);
  const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const parameters = source.parameters.filter(row => /^(rok produkcji|rocznik|production year|year of manufacture)$/.test(normalize(row.name))).flatMap(row => row.values.flatMap(years));
  // OE codes, prices, phone numbers and generic dates in descriptions are not vehicle years.
  const title = years(source.title.replace(/\b(?:19|20)\d{2}\s*[-–/]\s*(?:(?:19|20)\d{2}|\d{2})\b/g, "").replace(/\b(?:19|20)\d{2}[.,]\d{2}\b/g, ""));
  const description = [...source.description.matchAll(/(?:rok\s+produkcji|rocznik|auto\s+z|samoch[oó]d\s+z)\s*[:=-]?\s*((?:19|20)\d{2})(?![\d.,]|\s*[-–/]\s*\d)/gi)].map(match => match[1]);
  const candidates = [...new Set([...parameters, ...title, ...description].filter(valid))];
  if (candidates.length === 1) return { year: candidates[0], reason: "Rok odczytany z tytulu, opisu lub parametru aukcji. Sprawdz przypisanie auta.", technical: false };
  if (range?.[1] && valid(range[1])) return { year: range[1], reason: `Rok techniczny: poczatek zakresu produkcji ${model!.years}. Nie jest potwierdzonym rocznikiem dawcy${candidates.length > 1 ? "; dane aukcji sa niejednoznaczne" : ""}.`, technical: true };
  return { year: "", reason: "Brak jednoznacznego roku i poczatku zakresu modelu. Podaj rok recznie.", technical: false };
}

export function preferredOvokoCar(rows: OvokoReadRow[], year: string): OvokoReadRow | undefined {
  return [...rows].sort((a, b) => Number(b.years === year) - Number(a.years === year) || a.id.localeCompare(b.id, "en", { numeric: true }))[0];
}
