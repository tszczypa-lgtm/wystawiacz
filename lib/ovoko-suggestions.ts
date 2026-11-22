import type { OvokoReadRow } from "./ovoko-read";
import type { OvokoSourcePreview, OvokoPreparationDraft } from "./ovoko-preparation";

export function ovokoAutomaticFields(source: OvokoSourcePreview, dictionaries: Record<string, OvokoReadRow[]>): Partial<OvokoPreparationDraft> {
  const fields: Partial<OvokoPreparationDraft> = {};
  const numbers = suggestPartNumbers(source.title, source.parameters).filter(candidate => candidate.number.length !== 17);
  if (numbers.length) fields.manufacturerCode = numbers[0].number;
  if (numbers.length > 1) fields.additionalCodes = numbers.slice(1).map(candidate => candidate.number).join("\n");
  const categories = suggestOvokoCategories(source.title, dictionaries.categories || []);
  if (categories.length) fields.categoryId = categories[0].id;
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
  const titlePosition = (candidate: NumberSuggestion) => Math.min(...candidate.evidence.filter(item => item.source === "Tytul Allegro").map(item => title.indexOf(item.raw)).filter(index => index >= 0), Infinity);
  return candidates.filter(candidate => candidate.evidence.some(item => item.source === "Tytul Allegro") || !candidates.some(other => other !== candidate && other.number.startsWith(candidate.number) && /^[A-Z0-9]+$/.test(other.number.slice(candidate.number.length)) && other.evidence.some(item => item.source === "Tytul Allegro"))).sort((a, b) => titlePosition(a) - titlePosition(b));
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
  const firstMentioned = (text: string, rows: OvokoReadRow[]) => {
    const normalized = ` ${fold(text).replace(/[^a-z0-9]+/g, " ")} `;
    const position = (row: OvokoReadRow) => Math.min(...[row.name, ...(fold(row.name) === "volkswagen" ? ["VW"] : [])].map(name => {
      const index = normalized.indexOf(` ${fold(name).replace(/[^a-z0-9]+/g, " ").trim()} `);
      return index < 0 ? Infinity : index;
    }));
    return [...rows].sort((a, b) => position(a) - position(b) || a.id.localeCompare(b.id, "en", { numeric: true }))[0]?.id || "";
  };
  const labels = new Set(["marka pojazdu", "marka samochodu", "marka auta", "producent pojazdu", "producent samochodu"]);
  const explicit = parameters.filter(row => labels.has(fold(row.name).trim())).flatMap(row => row.values);
  if (explicit.length) {
    const matches = suggestOvokoBrands(explicit.join(" "), brands);
    // Vehicle parameters take precedence; multiple compatible makes use a stable first mention.
    return firstMentioned(explicit.join(" "), matches);
  }
  const matches = suggestOvokoBrands(title, brands);
  const specific = matches.filter(row => fold(row.name).trim() !== "ac");
  const candidates = specific.length ? specific : matches;
  if (candidates.length) return firstMentioned(title, candidates);
  const producerLabels = new Set(["producent", "marka", "producent czesci", "marka czesci"]);
  const producers = suggestOvokoBrands(parameters.filter(row => producerLabels.has(fold(row.name).trim())).flatMap(row => row.values).join(" "), brands);
  // Only distinctive model names; shared names such as Master or Partner are intentionally excluded.
  const modelMakes: Record<string, string[]> = { renault: ["kangoo", "clio", "megane", "scenic", "twingo", "captur", "kadjar", "talisman", "austral", "arkana"] };
  const words = new Set(fold(vehicleSuggestionText(title, parameters)).match(/[a-z0-9]+/g) || []);
  const inferred = brands.filter(row => (modelMakes[fold(row.name).trim()] || []).some(model => words.has(model)));
  const combined = [...new Set([...producers, ...inferred].map(row => row.id))];
  return combined.length === 1 ? combined[0] : "";
}
function vehicleTokens(value: string): string[] {
  return fold(value).replace(/\b(?:(?:ml|m)[-\s]*(?:class|klasse|klasa)|(?:class|klasse|klasa)[-\s]*m|ml)\b/g, "mclass").replace(/\b([sc])[\s\-\u2010-\u2014]+max\b/g, "$1max").replace(/\b(mk|mark|gen)\s+([1-9]\d?|[ivx]+)\b/g, "$1$2").replace(/\b([a-z0-9]+)[-\u2010-\u2014]([a-z0-9]+)\b/g, "$1$2").match(/[a-z0-9]+/g) || [];
}
const romanGenerations: Record<string, string> = { i: "1", ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7", viii: "8", ix: "9", x: "10" };
function vehicleGenerations(value: string) {
  return vehicleTokens(value).flatMap(token => {
    const marked = token.match(/^(?:mk|mark|gen)([1-9]\d?|[ivx]+)$/);
    if (marked) return [`generation${romanGenerations[marked[1]] || marked[1]}`];
    return Object.hasOwn(romanGenerations, token) ? [`generation${romanGenerations[token]}`] : [];
  });
}
function rankOvokoModels(title: string, models: OvokoReadRow[], includeRejected = false) {
  const sourceTokens = vehicleTokens(title), tokens = new Set(sourceTokens), sourceGenerations = new Set(vehicleGenerations(title));
  return models.map(row => {
    const names = vehicleTokens(row.name.split("(")[0]);
    const matches = [...new Set(names.filter(token => token.length >= 2 && !Object.hasOwn(romanGenerations, token) && !/^(?:mk|mark|gen)/.test(token) && tokens.has(token)))];
    const generation = vehicleTokens(row.name);
    const generations = generation.filter(token => /^[bdefgwlx]\d{1,4}$/.test(token));
    const conflict = generations.some(token => [...tokens].some(source => source[0] === token[0] && /^[bdefgwlx]\d{1,4}$/.test(source))) && !generations.some(token => tokens.has(token));
    const numbered = vehicleGenerations(row.name), numberedConflict = numbered.length > 0 && sourceGenerations.size > 0 && !numbered.some(token => sourceGenerations.has(token));
    const chassis = generations.filter(token => tokens.has(token));
    const score = (matches.length || chassis.length) && !conflict ? matches.length + chassis.length * 10 + numbered.filter(token => sourceGenerations.has(token)).length * 2 : 0;
    const order = Math.min(...[...matches, ...chassis].map(token => sourceTokens.indexOf(token)), sourceTokens.length);
    return { ...row, matches, score, order, generationConflict: numberedConflict, chassisConflict: conflict };
  }).filter(row => row.score > 0 || includeRejected && row.matches.length > 0).sort((a, b) => b.score - a.score || a.order - b.order || a.name.localeCompare(b.name) || a.id.localeCompare(b.id, "en", { numeric: true }));
}
export function ovokoModelHasConflict(title: string, model: OvokoReadRow): boolean {
  return rankOvokoModels(title, [model], true).some(row => row.generationConflict || row.chassisConflict);
}
export function suggestOvokoModels(title: string, models: OvokoReadRow[]) {
  return rankOvokoModels(title, models).slice(0, 100);
}
export function automaticOvokoModel(title: string, models: OvokoReadRow[]): string {
  const ranked = rankOvokoModels(title, models);
  if (!ranked.length) return "";
  // A reproducible best draft choice, not a claim about the actual origin vehicle.
  return ranked.find(row => !row.generationConflict)?.id || "";
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
  radia: "radio", radioodtwarzacz: "radio", radioodtwarzacze: "radio", tuner: "radio",
  nawigacji: "nawigacja", nawigacje: "nawigacja", multimedialny: "multimedia", multimedialna: "multimedia", multimedialne: "multimedia",
  mapy: "mapa", map: "mapa", mapami: "mapa", sterujaca: "sterownik", sterujacy: "sterownik",
  paliwa: "paliwo", paliwowa: "paliwo", paliwowy: "paliwo", klimatyzacji: "klimatyzacja", poduszek: "airbag",
};
const stop = new Set(["czesc", "czesci", "samochod", "samochodu", "samochodowe", "nowy", "nowa", "uzywany", "uzywana", "oryginal", "oryginalny", "przod", "tyl", "lewy", "prawy", "lewa", "prawa", "komplet", "szt"]);
function terms(value: string) { return [...new Set((fold(value).match(/[a-z0-9]+/g) || []).filter(word => word.length >= 3 && !stop.has(word) && !/\d/.test(word)).map(word => words[word] || word))]; }
const genericCategoryTerms = new Set(["modul", "sterownik", "jednostka", "panel", "pompa", "zestaw", "element", "czujnik"]);
const categorySystems = new Set(["abs", "airbag", "klimatyzacja", "paliwo", "silnik", "drzwi", "radio", "zamek", "pdc", "skrzynia", "wspomaganie"]);
export function suggestOvokoCategories(title: string, categories: OvokoReadRow[]): CategorySuggestion[] {
  const source = new Set(terms(title)), byId = new Map(categories.map(row => [row.id, row]));
  if (source.has("multimedia") || /\b(?:NAC\s+WAVE\d*|RCC)\b/i.test(title)) source.add("radio");
  return categories.filter(row => row.level === "3").flatMap(row => {
    const names = [row.name], seen = new Set([row.id]); let parent = row.parentId;
    while (parent && parent !== "0" && !seen.has(parent) && seen.size < 3) { seen.add(parent); const item = byId.get(parent); if (!item) break; names.unshift(item.name); parent = item.parentId; }
    const leaf = terms(row.name), matches = leaf.filter(term => source.has(term));
    if (!matches.length) return [];
    // Navigation hardware is not map media; a generic unit/module is not evidence of AdBlue.
    if (leaf.some(term => ["mapa", "adblue"].includes(term) && !source.has(term))) return [];
    if (matches.every(term => genericCategoryTerms.has(term)) && leaf.some(term => categorySystems.has(term) && !source.has(term))) return [];
    const parentMatches = terms(names.slice(0, -1).join(" ")).filter(term => source.has(term) && !matches.includes(term));
    const hardware = source.has("radio") && !source.has("mapa") && leaf.includes("radio") ? 6 + (leaf.includes("panel") && (leaf.includes("dvd") || leaf.includes("gps")) ? 6 : 0) : 0;
    const score = matches.reduce((sum, term) => sum + (genericCategoryTerms.has(term) ? 1 : 3), 0) + parentMatches.length + hardware + matches.length / leaf.length;
    return [{ id: row.id, path: names.join(" / "), matches: [...matches, ...parentMatches], score, weak: matches.length < 2 }];
  }).sort((a, b) => b.score - a.score || a.path.localeCompare(b.path, "pl")).slice(0, 8);
}
