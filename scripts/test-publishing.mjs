import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(new URL("../public/wystawiacz/app.js", import.meta.url), "utf8");
const ast = ts.createSourceFile("app.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const functions = ast.statements.filter(ts.isFunctionDeclaration).map(fn => fn.getText(ast)).join("\n");
let response;
let requests = [];
const context = vm.createContext({
  window: { getWystawiaczToken: async () => "session" },
  fetch: async (url, options) => { requests.push({ url, options }); if (response instanceof Error) throw response; return response; },
  state: { localPhotosByName: new Map() },
});
vm.runInContext(functions + "\nconst publishingProducts = new Set();", context);
context.state.compliance = { responsibleProducers: [{ id: "producer", name: "BMW" }], responsiblePersons: [{ id: "person" }] };
context.escapeHtml = value => String(value).replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const definitions = [
  { id: "count", name: "Liczba sztuk w zestawie", type: "integer", required: true, options: { describesProduct: true }, restrictions: { min: 1 } },
  { id: "brand", name: "Producent", type: "dictionary", requiredForProduct: true, dictionary: [{ id: "bmw", value: "BMW" }], options: { describesProduct: true } },
  { id: "state", name: "Stan", type: "dictionary", required: true, dictionary: [{ id: "used", value: "Uzywany" }], options: { describesProduct: false } },
  { id: "before", name: "Produkt wprowadzony do obrotu na terenie UE przed 13.12.2024", type: "dictionary", dictionary: [{ id: "yes", value: "Tak" }], options: { describesProduct: false } },
];
const complete = {
  title: "Pompa ABS BMW F40", stock: 3, stockUnit: "PAIR", price: "120,50", categoryId: "cat",
  marketedBeforeGPSRObligation: false,
  responsibleProducerId: "producer", responsiblePersonId: "person", safetyInformation: "Informacje producenta dla tej czesci.",
  parameterValues: { count: "2", brand: "bmw", state: "used" }, descriptionText: "Moj opis\n<script>nie wykonuj</script>"
};
assert.equal(context.validateListingParameters(complete, definitions), "");
assert.match(context.validateListingParameters({ ...complete, parameterValues: {} }, definitions), /Liczba sztuk.*Producent.*Stan/);
assert.match(context.validateListingParameters({ ...complete, parameterValues: { ...complete.parameterValues, brand: "invalid" } }, definitions), /Producent/);
assert.match(context.validateListingParameters({ ...complete, parameterValues: { ...complete.parameterValues, count: "0" } }, definitions), /Liczba sztuk/);
assert.match(context.validateListingParameters({ ...complete, responsibleProducerId: "other-account" }, definitions), /producenta/);
assert.match(context.validateListingParameters({ ...complete, safetyInformation: "" }, definitions), /bezpieczenstwie/);
assert.match(context.validateListingParameters({ ...complete, safetyInformation: "<p>test</p>" }, definitions), /HTML/);
assert.match(context.validateListingParameters({ ...complete, stock: 1.5 }, definitions), /calkowita/);
assert.equal(context.parameterConditionMatches({ parametersWithValue: [{ id: "state", oneOfValueIds: ["used"] }] }, complete.parameterValues), true);
assert.equal(context.parameterConditionMatches({ parametersWithValue: [{ id: "state", oneOfValueIds: ["new"] }] }, complete.parameterValues), false);
const conditional = { id: "gtin", name: "EAN", required: true, requiredIf: { parametersWithValue: [{ id: "state", oneOfValueIds: ["new"] }] }, type: "string" };
assert.equal(context.validateListingParameters(complete, [...definitions, conditional]), "", "A conditional requirement must not apply when its condition is false");
assert.match(context.validateListingParameters(complete, [...definitions, { ...conditional, requiredIf: { parametersWithoutValue: [{ id: "mpn" }] } }]), /EAN/);
const payload = context.buildAllegroOfferPayload(complete, ["https://images.test/main"], definitions, { city: "Znin" });
assert.equal(payload.stock.unit, "PAIR");
const linked = context.buildAllegroOfferPayload({ ...complete, catalogProduct: {
  id: "f748fdc9-4e44-4bf1-ad39-6fab2d588e5f", parameters: [
    { id: "brand", options: { identifiesProduct: true } }, { id: "count", options: { identifiesProduct: false } }
  ]
} }, ["https://images.test/main"], definitions, { city: "Znin" });
assert.equal(linked.productSet[0].product.id, "f748fdc9-4e44-4bf1-ad39-6fab2d588e5f");
assert.equal(linked.productSet[0].product.name, undefined, "No new catalog product name");
assert.equal(linked.productSet[0].product.images.length, 0, "Do not import catalog photos");
assert.equal(linked.images[0], "https://images.test/main");
assert.equal(linked.name, complete.title);
assert.equal(linked.description.sections[0].items[1].content, payload.description.sections[0].items[1].content);
assert.equal(linked.productSet[0].product.parameters.length, 1);
assert.equal(linked.productSet[0].product.parameters[0].id, "count", "Do not override catalog identifying parameters");
assert.equal(payload.stock.available, 3);
assert.equal(payload.productSet[0].safetyInformation.type, "TEXT");
assert.equal(payload.productSet[0].responsibleProducer.id, "producer");
assert.equal(payload.productSet[0].responsiblePerson.id, "person");
assert.equal(payload.productSet[0].marketedBeforeGPSRObligation, false, "Unchecked choice is sent as false");
assert.equal(payload.productSet[0].product.parameters.find(item => item.id === "count").values[0], "2", "Package count is independent of available stock");
assert.ok(payload.parameters.some(item => item.id === "state"));
assert.ok(payload.description.sections[0].items[1].content.includes("&lt;script&gt;"));
for (const unit of ["UNIT", "SET"]) assert.equal(context.buildAllegroOfferPayload({ ...complete, stockUnit: unit }, [], definitions, {}).stock.unit, unit);
const oldSessionPayload = context.buildAllegroOfferPayload({ ...complete, parameterValues: { ...complete.parameterValues, before: "yes" } }, [], definitions, {});
assert.equal(oldSessionPayload.productSet[0].marketedBeforeGPSRObligation, false, "Explicit unchecked choice overrides obsolete parameter");
assert.ok(!oldSessionPayload.parameters.some(item => item.id === "before"));
const preGPSR = { ...complete, marketedBeforeGPSRObligation: true, responsibleProducerId: "", responsiblePersonId: "", safetyInformation: "" };
assert.equal(context.validateListingParameters(preGPSR, definitions), "", "Used pre-GPSR product is not blocked by empty GPSR fields");
const prePayload = context.buildAllegroOfferPayload(preGPSR, [], definitions, {});
assert.equal(prePayload.productSet[0].marketedBeforeGPSRObligation, true);
assert.equal(prePayload.productSet[0].safetyInformation, undefined, "Do not invent safety text");
assert.equal(prePayload.productSet[0].responsibleProducer, undefined, "Do not invent producer details");
assert.match(context.validateListingParameters(preGPSR, definitions.map(parameter => parameter.id === "state" ? { ...parameter, dictionary: [{ id: "used", value: "Nowy" }] } : parameter)), /odznacz ptaszek/);
assert.equal(context.buildAllegroOfferPayload({ ...preGPSR, marketedBeforeGPSRObligation: undefined }, [], definitions, {}).productSet[0].marketedBeforeGPSRObligation, true, "Old sessions default to user's chosen pre-GPSR flow");
response = new Response("<html>Error code: 1102</html>", { status: 500, headers: { "CF-Ray": "123abc-WAW" } });
await assert.rejects(context.apiRequest("/api/upload-image"), /limit zasobow.*1102.*HTTP 500.*123abc-WAW/);
response = Response.json({ message: "Limit Allegro" }, { status: 429 });
await assert.rejects(context.apiRequest("/api/product-offers"), /Limit Allegro.*HTTP 429/);
response = new Error("secret transport details");
await assert.rejects(context.apiRequest("/api/product-offers"), /brak odpowiedzi HTTP/);
response = new Response("not JSON", { status: 200 });
await assert.rejects(context.apiRequest("/api/product-offers"), /nieprawidlowa odpowiedz.*HTTP 200/);

const first = new Blob([Uint8Array.from([0, 128, 255])], { type: "image/jpeg" });
const second = new Blob(["rotated"], { type: "image/png" });
context.state.localPhotosByName.set("first.jpg", { file: first });
context.state.localPhotosByName.set("second.png", { file: second });
context.fetch = async (url, options) => { requests.push({ url, options }); return Response.json({ location: `https://images.test/${requests.length}` }); };
requests = [];
const urls = await context.uploadProductImages({ photoNames: ["second.png", "first.jpg"] });
assert.equal(urls.length, 2);
assert.equal(requests[0].options.body, second, "Selected order and rotated file preserved");
assert.equal(requests[1].options.body, first);
assert.equal(requests[0].options.headers["Content-Type"], "image/png");
assert.equal(requests[0].options.headers.Authorization, "Bearer session");
context.fetch = async () => new Response("Error 1102", { status: 500 });
await assert.rejects(context.uploadProductImages({ photoNames: ["first.jpg"] }), /Zdjecie 1\/1 \(first.jpg\).*1102/);

let release;
let uploads = 0;
let offers = 0;
const product = { id: "one", title: "Test", price: 10, categoryId: "123" };
Object.assign(context, {
  activeProductId: null, confirm: () => { throw new Error("Unexpected confirmation"); }, showToast: () => {}, renderProducts: () => {},
  applyDefaultAfterSalesToProduct: () => {}, validateProductBeforePublish: () => "", getPublishLocation: () => ({}),
  loadCategoryParameterDefinitions: async () => [], buildAllegroOfferPayload: () => ({}), toBase64Utf8: () => "offer",
  validateListingParameters: () => "",
  uploadProductImages: async () => { uploads++; return new Promise(resolve => { release = resolve; }); },
  apiRequest: async () => { offers++; return { id: "published" }; },
});
context.state.products = [product];
const pending = context.publishProduct("one");
await new Promise(resolve => setImmediate(resolve));
await context.publishProduct("one");
assert.equal(uploads, 1, "Double click does not start another upload/publish");
release([]);
await pending;
assert.equal(offers, 1);
assert.equal(product.publishStatus, "WYSTAWIONO");
await context.publishProduct("one");
assert.equal(offers, 1, "Already published product is not duplicated");

product.allegroOfferId = "";
product.publishStatus = "GOTOWE";
context.uploadProductImages = async () => [];
context.apiRequest = async () => { offers++; throw new Error("HTTP 500"); };
await context.publishProduct("one");
assert.match(product.publishError, /Tworzenie oferty.*sprawdz Moje oferty/);
assert.equal(offers, 2, "No automatic retry of ambiguous offer creation");
context.uploadProductImages = async () => { throw new Error("image failed"); };
await context.publishProduct("one");
assert.match(product.publishError, /Wysylanie zdjec: image failed/);
assert.equal(offers, 2);
context.validateListingParameters = () => "Missing producer";
const beforeValidation = uploads;
context.uploadProductImages = async () => { uploads++; return []; };
await context.publishProduct("one");
assert.equal(uploads, beforeValidation, "Validation fails before any image upload");
assert.match(product.publishError, /Sprawdzanie parametrow: Missing producer/);
console.log("Publishing: binary order/bytes, HTTP/Cloudflare errors, stage, double-click lock and no blind POST retries passed. No live offers created.");
