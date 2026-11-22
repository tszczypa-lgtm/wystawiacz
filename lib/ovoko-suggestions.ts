import type { OvokoReadRow } from "./ovoko-read";
import type { OvokoSourcePreview, OvokoPreparationDraft } from "./ovoko-preparation";

export function ovokoAutomaticFields(source: OvokoSourcePreview, dictionaries: Record<string, OvokoReadRow[]>): Partial<OvokoPreparationDraft> {
  const fields: Partial<OvokoPreparationDraft> = {};
  const numbers = suggestPartNumbers(source.title, source.parameters);
  // A single numeric code is useful too; retain its warning, not an extra confirmation step.
  if (numbers.length === 1 && numbers[0].number.length !== 17) fields.manufacturerCode = numbers[0].number;
  const categories = suggestOvokoCategories(source.title, dictionaries.categories || []);
  if (categories.length && (!categories[1] || categories[0].score > categories[1].score)) fields.categoryId = categories[0].id;
  const qualityNames: Record<string, string[]> = { used: ["uzywany", "used"], new: ["nowy", "new"], damaged: ["uszkodzony", "with defects"], restored: ["regenerowany", "restored"] };
  const qualities = (dictionaries.qualities || []).filter(row => (qualityNames[source.condition] || []).includes(fold(row.name).trim()));
  if (qualities.length === 1) fields.qualityId = qualities[0].id;
  if (source.status === "ACTIVE" && source.stock !== null && source.stock > 0 && !source.bundle) {
    const statuses = (dictionaries.statuses || []).filter(row => ["na stanie", "in stock"].includes(fold(row.name).trim()));
    if (statuses.length === 1) fields.statusId = statuses[0].id;
  }
  return fields;
}

export type NumberSuggestion = { number: string; evidence: { raw: string; source: string }[]; warnings: string[] };
const normalizeNumber = (value: string) => value.toUpperCase().replace(/[ .-]/g, "");
const suffixWords = new Set(["DO", "OD", "NA", "ZE", "BEZ", "ABS", "ESP", "TDI", "FSI", "TSI", "DSG", "GTI", "GTE", "LED", "OEM", "OE", "NR", "NOWY", "AUDI", "SEAT", "BMW", "RHD", "LHD", "ECU", "BCM", "BSI", "BSM", "CAN", "ID"]);
const boundary = (value: string | undefined) => !value || !/[\p{L}\p{N}_]/u.test(value);
function plausible(value: string) {
  const number = normalizeNumber(value);
  if (!/^[A-Z0-9]{6,32}$/.test(number) || (number.match(/\d/g) || []).length < 3) return false;
  if (/^\d+$/.test(number)) return number.length >= 7 && number.length <= 20;
  return !/^\d{4}[-.]\d{4}$/.test(value) && !/^\d{4}(?:19|20)\d{2}$/.test(number);
}
export function suggestPartNumbers(title: string, parameters: { name: string; values: string[] }[] = []): NumberSuggestion[] {
  const found = new Map<string, NumberSuggestion>(), occupied: { start: number; end: number }[] = [];
  function add(raw: string, source: string, warnings: string[] = []) {
    if (!plausible(raw)) return;
    const number = normalizeNumber(raw), candidate = found.get(number) || { number, evidence: [], warnings: [] };
    if (!candidate.evidence.some(item => item.raw === raw && item.source === source)) candidate.evidence.push({ raw, source });
    if (/^\d+$/.test(number)) warnings.push("Sam ciag cyfr moze byc innym identyfikatorem, niekoniecznie numerem OE.");
    if (number.length === 17) warnings.push("Oznaczenie ma 17 znakow: sprawdz, czy nie jest to VIN zamiast numeru czesci.");
    candidate.warnings = [...new Set([...candidate.warnings, ...warnings])]; found.set(number, candidate);
  }
  function titleSpan(start: number, end: number) {
    if (!boundary(title[start - 1]) || !boundary(title[end])) return;
    if (occupied.some(span => start < span.end && end > span.start)) return;
    let raw = title.slice(start, end);
    const attached = title.slice(end).match(/^(?:[.-][A-Z0-9]+)+/i);
    if (attached) { raw += attached[0]; end += attached[0].length; }
    if (/^\/[A-Z]{1,3}(?=$|[^\p{L}\p{N}_])/iu.test(title.slice(end))) return;
    if (/^ *[([][A-Z]{1,3}[)\]]/iu.test(title.slice(end))) return;
    const suffix = title.slice(end).match(/^ +([A-Z]{1,3})(?=$|[^\p{L}\p{N}_])/iu);
    const warnings: string[] = [];
    if (suffix && /\d$/.test(normalizeNumber(raw)) && !suffixWords.has(suffix[1].toUpperCase())) {
      raw += suffix[0]; end += suffix[0].length;
      warnings.push("Indeks jest oddzielony spacja. Sprawdz, czy litery naleza do numeru, a nie do opisu.");
    }
    if (!plausible(raw)) return;
    add(raw, "Tytul Allegro", warnings); occupied.push({ start, end });
  }
  // Recognize explicit numeric groups as a whole, never as several shortened part numbers.
  const grouped = [/[0-9][ .-][0-9]{3}[ .-][0-9]{3}[ .-][0-9]{3}[A-Z]*/gi, /[0-9]{2}[ .-][0-9]{2}[ .-][0-9][ .-][0-9]{3}[ .-][0-9]{3}[A-Z]*/gi, /[0-9]{2}[ .-][0-9]{6}[ .-][0-9]{2}[A-Z]*/gi, /[A-Z0-9]{3}[ .-][0-9]{3}[ .-][0-9]{3}[A-Z]*/gi];
  for (const pattern of grouped) for (const match of title.matchAll(pattern)) titleSpan(match.index!, match.index! + match[0].length);
  for (const match of title.matchAll(/[A-Z0-9]+(?:[.-][A-Z0-9]+)*/gi)) {
    if (/^(?:19|20)\d{2}[-.](?:19|20)\d{2}$/.test(match[0])) continue;
    titleSpan(match.index!, match.index! + match[0].length);
  }
  const labels = new Set(["numer katalogowy czesci", "numer katalogowy części", "kod producenta", "manufacturer code", "numer oe"]);
  for (const parameter of parameters) {
    if (!labels.has(parameter.name.toLowerCase().trim())) continue;
    for (const raw of parameter.values) {
      // A title pasted into the MPN field is not a verified manufacturer code.
      if (raw.trim().toLowerCase() === title.trim().toLowerCase() || /[^A-Z0-9 .-]/i.test(raw) || /\s/.test(raw.trim())) continue;
      add(raw.trim(), `Parametr: ${parameter.name}`, ["Wartosc parametru rowniez wymaga sprawdzenia; nie uznajemy jej za pewniejsza od tytulu."]);
    }
  }
  const candidates = [...found.values()];
  // A base number in a parameter must not replace a longer indexed number found in the title.
  return candidates.filter(candidate => candidate.evidence.some(item => item.source === "Tytul Allegro") || !candidates.some(other => other !== candidate && other.number.startsWith(candidate.number) && /^[A-Z0-9]+$/.test(other.number.slice(candidate.number.length)) && other.evidence.some(item => item.source === "Tytul Allegro")));
}

export type CategorySuggestion = { id: string; path: string; matches: string[]; score: number; weak: boolean };
const fold = (value: string) => value.toLowerCase().replace(/ł/g, "l").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
export function vehicleSuggestionText(title: string, parameters: { name: string; values: string[] }[]) {
  const labels = new Set(["marka pojazdu", "marka samochodu", "marka auta", "producent pojazdu", "producent samochodu", "model pojazdu", "model samochodu"]);
  return [title, ...parameters.filter(row => labels.has(fold(row.name).trim())).flatMap(row => row.values)].join(" ");
}
export function suggestOvokoBrands(title: string, brands: OvokoReadRow[]) {
  const text = ` ${fold(title).replace(/[^a-z0-9]+/g, " ")} `;
  const matches = brands.filter(row => {
    const names = [row.name, ...(fold(row.name) === "volkswagen" ? ["VW"] : [])];
    return names.some(name => text.includes(` ${fold(name).replace(/[^a-z0-9]+/g, " ").trim()} `));
  });
  // Compound makes are more specific than their contained make names (Land Rover vs Rover).
  return matches.filter(row => !matches.some(other => other !== row && fold(other.name).length > fold(row.name).length && ` ${fold(other.name)} `.includes(` ${fold(row.name)} `)));
}
export function automaticOvokoBrand(title: string, parameters: { name: string; values: string[] }[], brands: OvokoReadRow[]): string {
  const labels = new Set(["marka pojazdu", "marka samochodu", "marka auta", "producent pojazdu", "producent samochodu"]);
  const explicit = parameters.filter(row => labels.has(fold(row.name).trim())).flatMap(row => row.values);
  if (explicit.length) {
    const matches = suggestOvokoBrands(explicit.join(" "), brands);
    // An explicit but conflicting/unrecognized vehicle brand must not be overridden by title guesses.
    return matches.length === 1 ? matches[0].id : "";
  }
  const matches = suggestOvokoBrands(title, brands);
  const specific = matches.filter(row => fold(row.name).trim() !== "ac");
  const candidates = specific.length ? specific : matches;
  return candidates.length === 1 ? candidates[0].id : "";
}
export function suggestOvokoModels(title: string, models: OvokoReadRow[]) {
  const tokens = new Set(fold(title).match(/[a-z0-9]+/g) || []);
  return models.map(row => {
    const names = fold(row.name).split("(")[0].match(/[a-z0-9]+/g) || [];
    const matches = names.filter(token => token.length >= 2 && tokens.has(token));
    const generation = (fold(row.name).split("(")[1] || "").match(/[a-z0-9]+/g) || [];
    const generations = generation.filter(token => /^[bdefgw]\d{1,3}$/.test(token));
    const conflict = generations.some(token => [...tokens].some(source => source[0] === token[0] && /^[bdefgw]\d{1,3}$/.test(source))) && !generations.some(token => tokens.has(token));
    if (conflict) return { ...row, score: 0 };
    const score = matches.length ? matches.length + generation.filter(token => tokens.has(token)).length * 2 : 0;
    return { ...row, score };
  }).filter(row => row.score > 0).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, 20);
}
export function suggestionSearchMatches(value: string, query: string) { return fold(value).includes(fold(query.trim())); }
const words: Record<string, string> = {
  pompa: "pompa", pompy: "pompa", pomp: "pompa", pompek: "pompa", pompka: "pompa",
  sterownik: "sterownik", sterowniki: "sterownik", sterownika: "sterownik", sterownikow: "sterownik",
  modul: "modul", moduly: "modul", modulu: "modul", modulow: "modul",
  zamek: "zamek", zamka: "zamek", zamki: "zamek", zamkow: "zamek",
  drzwi: "drzwi", drzwiowy: "drzwi", drzwiowe: "drzwi", drzwiowych: "drzwi",
  przekladnia: "przekladnia", przekladnie: "przekladnia", przekladni: "przekladnia", maglownica: "maglownica", maglownice: "maglownica",
  kierownicza: "kierowniczy", kierowniczej: "kierowniczy", kierowniczy: "kierowniczy", kierownicze: "kierowniczy",
  silnika: "silnik", silnik: "silnik", silnikow: "silnik", silniki: "silnik",
  lampa: "lampa", lampy: "lampa", lamp: "lampa", reflektor: "reflektor", reflektory: "reflektor", reflektora: "reflektor",
};
const stop = new Set(["czesc", "czesci", "samochod", "samochodu", "samochodowe", "nowy", "nowa", "uzywany", "uzywana", "oryginal", "oryginalny", "przod", "tyl", "lewy", "prawy", "lewa", "prawa", "komplet", "szt"]);
function terms(value: string) { return [...new Set((fold(value).match(/[a-z0-9]+/g) || []).filter(word => word.length >= 3 && !stop.has(word) && !/\d/.test(word)).map(word => words[word] || word))]; }
export function suggestOvokoCategories(title: string, categories: OvokoReadRow[]): CategorySuggestion[] {
  const source = new Set(terms(title)), byId = new Map(categories.map(row => [row.id, row]));
  return categories.filter(row => row.level === "3").flatMap(row => {
    const names = [row.name], seen = new Set([row.id]); let parent = row.parentId;
    while (parent && parent !== "0" && !seen.has(parent) && seen.size < 3) { seen.add(parent); const item = byId.get(parent); if (!item) break; names.unshift(item.name); parent = item.parentId; }
    const leaf = terms(row.name), matches = leaf.filter(term => source.has(term));
    if (!matches.length) return [];
    const parentMatches = terms(names.slice(0, -1).join(" ")).filter(term => source.has(term) && !matches.includes(term));
    return [{ id: row.id, path: names.join(" / "), matches: [...matches, ...parentMatches], score: matches.length * 3 + parentMatches.length, weak: matches.length < 2 }];
  }).sort((a, b) => b.score - a.score || a.path.localeCompare(b.path, "pl")).slice(0, 8);
}
