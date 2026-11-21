type Parameter = { id: string; name: string; values: string[] };
export type OvokoSourceCondition = "used" | "new" | "damaged" | "restored" | "";
export type OvokoSourcePreview = {
  id: string; title: string; description: string; images: string[]; skippedImages: number;
  price: string; currency: string; stock: number | null; status: string; categoryId: string;
  shippingRateId: string; externalId: string; parameters: Parameter[]; suggestedCode: string; bundle: boolean; condition: OvokoSourceCondition;
};
const object = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const text = (value: unknown, limit = 1000) => typeof value === "string" ? value.slice(0, limit) : "";
const normalized = (value: string) => value.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
function sourceCondition(parameters: unknown[]): OvokoSourceCondition {
  const names: Record<string, OvokoSourceCondition> = { uzywany: "used", used: "used", nowy: "new", new: "new", uszkodzony: "damaged", "with defects": "damaged", regenerowany: "restored", restored: "restored" };
  const ids: Record<string, OvokoSourceCondition> = { "11323_1": "new", "11323_2": "used" };
  const claims = new Set<OvokoSourceCondition>(); let unknown = false;
  for (const input of parameters) {
    const row = object(input);
    if (row.id !== "11323" && normalized(text(row.name)) !== "stan") continue;
    const values = Array.isArray(row.values) ? row.values.filter((value: unknown) => typeof value === "string" && value.trim()) : [];
    // Text comes from the offer's condition; dictionary-only responses retain known Allegro IDs.
    const mapped = values.length ? values.map((value: string) => Object.hasOwn(names, normalized(value)) ? names[normalized(value)] : undefined) : (Array.isArray(row.valuesIds) ? row.valuesIds.map((id: unknown) => typeof id === "string" && Object.hasOwn(ids, id) ? ids[id] : undefined) : []);
    if (!mapped.length || mapped.some((value: OvokoSourceCondition | undefined) => !value)) unknown = true;
    for (const value of mapped) if (value) claims.add(value);
  }
  return !unknown && claims.size === 1 ? [...claims][0] : "";
}
export function offerDescriptionText(html: string): string {
  // An inert template parses markup without attaching provider HTML to the page.
  const template = document.createElement("template"); template.innerHTML = html;
  template.content.querySelectorAll("script,style,iframe,object,embed,svg,math").forEach(node => node.remove());
  template.content.querySelectorAll("br").forEach(node => node.replaceWith(document.createTextNode("\n")));
  template.content.querySelectorAll("p,li,h1,h2,h3,h4,div").forEach(node => node.appendChild(document.createTextNode("\n")));
  return (template.content.textContent || "").trim();
}
export function ovokoSourcePreview(input: unknown, expectedId: string, toText: (html: string) => string): OvokoSourcePreview {
  const source = object(input);
  if (!/^\d{1,30}$/.test(expectedId) || source.id !== expectedId || typeof source.name !== "string" || !source.name.trim()) throw new Error("Nieprawidlowe lub niezgodne dane oferty Allegro. Nie utworzono podgladu.");
  const products = Array.isArray(source.productSet) ? source.productSet : [];
  const offerParameters = Array.isArray(source.parameters) ? source.parameters.slice(0, 500) : [];
  const hasOfferCondition = offerParameters.some(value => object(value).id === "11323" || normalized(text(object(value).name)) === "stan");
  const condition = sourceCondition(hasOfferCondition ? offerParameters : products.flatMap(item => Array.isArray(object(object(item).product).parameters) ? object(object(item).product).parameters.slice(0, 500) : []));
  const parameters: Parameter[] = [...(Array.isArray(source.parameters) ? source.parameters : []), ...products.flatMap(item => Array.isArray(object(object(item).product).parameters) ? object(object(item).product).parameters : [])].slice(0, 500).map(value => {
    const parameter = object(value);
    return { id: text(parameter.id, 40), name: text(parameter.name, 300), values: (Array.isArray(parameter.values) ? parameter.values : []).filter((value: unknown): value is string => typeof value === "string").slice(0, 30).map((value: string) => value.slice(0, 1000)) };
  });
  const codeNames = new Set(["numer katalogowy czesci", "numer katalogowy części", "kod producenta", "manufacturer code", "numer oe"]);
  const candidates = [...new Set(parameters.filter(parameter => codeNames.has(parameter.name.toLowerCase().trim())).flatMap(parameter => parameter.values).filter(value => value.trim() && value.length <= 255))];
  const rawImages = Array.isArray(source.images) ? source.images : [];
  const images = [...new Set(rawImages.slice(0, 50).flatMap((value: unknown) => {
    try {
      const url = new URL(typeof value === "string" ? value : text(object(value).url));
      return url.protocol === "https:" && !url.username && !url.password && url.hostname.endsWith(".allegroimg.com") ? [url.href] : [];
    } catch { return []; }
  }))];
  const description = (Array.isArray(object(source.description).sections) ? source.description.sections : []).slice(0, 100).flatMap((section: unknown) => Array.isArray(object(section).items) ? object(section).items : []).filter((item: unknown) => object(item).type === "TEXT").map((item: unknown) => text(object(item).content, 50000)).join("\n");
  const price = object(object(source.sellingMode).price), stock = object(source.stock).available;
  return { id: expectedId, title: text(source.name, 500), description: toText(description.slice(0, 100000)).slice(0, 40000), images, skippedImages: Math.max(0, rawImages.length - images.length),
    price: typeof price.amount === "string" && price.amount.length <= 30 && /^\d+(\.\d+)?$/.test(price.amount) ? price.amount : "", currency: typeof price.currency === "string" && /^[A-Z]{3}$/.test(price.currency) ? price.currency : "",
    stock: Number.isSafeInteger(stock) && stock >= 0 ? stock : null, status: text(object(source.publication).status, 40), categoryId: text(object(source.category).id, 40),
    shippingRateId: text(object(object(source.delivery).shippingRates).id, 100), externalId: text(object(source.external).id, 1000), parameters, suggestedCode: candidates.length === 1 ? candidates[0] : "",
    bundle: products.length !== 1 || Number(object(object(products[0]).quantity).value ?? 1) !== 1, condition };
}
export type OvokoPreparationDraft = { title: string; notes: string; manufacturerCode: string; price: string; currency: string; categoryId: string; donorId: string; qualityId: string; statusId: string; shippingPlan: string };
export function initialOvokoDraft(source: OvokoSourcePreview): OvokoPreparationDraft {
  const supported = ["PLN", "EUR"].includes(source.currency);
  return { title: source.title, notes: source.description, manufacturerCode: "", price: supported ? source.price : "", currency: supported ? source.currency : "", categoryId: "", donorId: "", qualityId: "", statusId: "", shippingPlan: "" };
}
export function ovokoPreparationIssues(source: OvokoSourcePreview, draft: OvokoPreparationDraft): string[] {
  const issues = ["Publikacja jest wylaczona w tym etapie. Ten podglad nie wysyla danych oferty do Ovoko.", "Samochod-dawca wymaga odczytu i potwierdzenia na Twoim koncie Ovoko; wpisany numer nie jest zweryfikowany.", "Pozostaje sprawdzenie wymaganych atrybutow zaleznych od kategorii oraz zasad wysylki Ovoko."];
  if (source.bundle || source.stock !== 1) issues.push("Oferta jest zestawem lub liczba sztuk nie wynosi 1. Nie utozsamiamy jej automatycznie z jedna fizyczna czescia.");
  if (!source.images.length) issues.push("Brak bezpiecznych adresow zdjec do podgladu.");
  if (source.images.some(url => !/\.(jpg|jpeg|png)$/i.test(new URL(url).pathname))) issues.push("Adresy zdjec wymagaja sprawdzenia formatu wymaganego przez Ovoko; nie zmieniamy ich automatycznie.");
  if (!draft.categoryId) issues.push("Wybierz kategorie Ovoko poziomu 3. Kategoria Allegro nie jest jej odpowiednikiem.");
  if (!draft.qualityId) issues.push("Wybierz jakosc czesci ze slownika Ovoko.");
  if (!draft.statusId) issues.push("Wybierz status rekordu ze slownika Ovoko; sam status nie potwierdza widocznosci w sprzedazy.");
  if (!/^\d+(\.\d{1,2})?$/.test(draft.price) || Number(draft.price) <= 0 || !["PLN", "EUR"].includes(draft.currency)) issues.push("Uzupelnij dodatnia cene i walute PLN lub EUR. Nie wykonujemy przewalutowania.");
  if (!draft.manufacturerCode.trim()) issues.push("Numer katalogowy pozostaje do sprawdzenia lub uzupelnienia, bez zgadywania z tytulu.");
  if (!draft.shippingPlan.trim()) issues.push("Brak planu wysylki. Cennik Allegro nie jest automatycznie cennikiem Ovoko.");
  return issues;
}
