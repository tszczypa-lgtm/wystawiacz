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
  activeProductId: null, confirm: () => true, showToast: () => {}, renderProducts: () => {},
  applyDefaultAfterSalesToProduct: () => {}, validateProductBeforePublish: () => "", getPublishLocation: () => ({}),
  loadCategoryParameterDefinitions: async () => [], buildAllegroOfferPayload: () => ({}), toBase64Utf8: () => "offer",
  uploadProductImages: async () => { uploads++; return new Promise(resolve => { release = resolve; }); },
  apiRequest: async () => { offers++; return { id: "published" }; },
});
context.state.products = [product];
const pending = context.publishProduct("one");
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
console.log("Publishing: binary order/bytes, HTTP/Cloudflare errors, stage, double-click lock and no blind POST retries passed. No live offers created.");
