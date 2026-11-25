import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
const code = ts.transpileModule(await readFile(new URL("../lib/allegro-api.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { readOvokoFitment } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
const id = "11111111-1111-1111-1111-111111111111", number = "5Q0959593EA";
const source = { id: "101", category: { id: "radio" } };
let mode = "ok", calls = [];
async function remote(path) {
  calls.push(path);
  assert.ok(path.startsWith("/sale/compatibility-list-suggestions?") || path.startsWith("/sale/products?phrase=") || path === `/sale/products/${id}?language=pl-PL`);
  if (path.startsWith("/sale/compatibility-list-suggestions?offer.id=")) return { items: mode === "suggestion" ? [{ type: "ID", text: "CITROEN C5 AIRCROSS 2017 - 2024" }] : [] };
  if (path.startsWith("/sale/products?")) { const query = new URL(path, "https://api.allegro.pl").searchParams; assert.equal(query.get("phrase"), number); assert.ok(["MPN", null].includes(query.get("mode"))); return { products: mode === "empty" ? [] : [{ id }] }; }
  if (path.startsWith("/sale/compatibility-list-suggestions?product.id=")) return { items: [{ text: "CITROEN C5 AIRCROSS 2017 - 2024" }] };
  return { id, name: "Radio multimedialne", category: { id: mode === "wrong-category" ? "unrelated" : "radio" }, parameters: [{ name: "Numer katalogowy części", values: [mode === "short" ? "5Q0959593E" : mode === "long" ? "5Q0959593EAX" : mode === "title" ? "RADIO 5Q0959593EA" : "5Q0 959 593 EA"] }], compatibilityList: mode === "product-suggestion" ? undefined : mode === "malformed" ? { items: "bad" } : { items: [{ text: "CITROEN C5 AIRCROSS 2017 - 2024" }] } };
}
const own = await readOvokoFitment({ ...source, compatibilityList: { items: [{ text: "PEUGEOT 3008 II 2016 - 2024" }] } }, number, remote);
assert.equal(own.rows[0].origin, "offer"); assert.equal(calls.length, 0);
mode = "suggestion"; calls = []; const suggested = await readOvokoFitment(source, number, remote); assert.equal(suggested.rows[0].origin, "suggestion"); assert.equal(calls.length, 1);
calls = []; const noNumberSuggestion = await readOvokoFitment(source, "", remote); assert.equal(noNumberSuggestion.rows[0].origin, "suggestion"); assert.equal(calls.length, 1);
mode = "empty"; calls = []; assert.deepEqual((await readOvokoFitment(source, "", remote)).rows, []); assert.equal(calls.length, 1, "No number means no catalogue search, never a placeholder MPN");
for (const kind of ["ok", "product-suggestion"]) {
  mode = kind; calls = []; const matched = await readOvokoFitment(source, number, remote);
  assert.equal(matched.rows[0].origin, kind === "ok" ? "catalog" : "catalog-suggestion"); assert.equal(matched.names[0], "Radio multimedialne"); assert.ok(calls.length <= 4);
}
for (const kind of ["short", "long", "title", "wrong-category", "empty"]) { mode = kind; const matched = await readOvokoFitment(source, number, remote); assert.deepEqual(matched.rows, []); assert.deepEqual(matched.names, []); }
mode = "malformed"; await assert.rejects(() => readOvokoFitment(source, number, remote));
const productIds = Array.from({ length: 9 }, (_, i) => `11111111-1111-1111-1111-${String(i + 1).padStart(12, "0")}`);
async function expandedFixture(kind, ownRows = []) {
  const paths = [];
  const result = await readOvokoFitment({ ...source, compatibilityList: { items: ownRows } }, number, async path => {
    paths.push(path);
    if (path.startsWith("/sale/compatibility-list-suggestions?")) return { items: [] };
    if (path.startsWith("/sale/products?")) {
      const query = new URL(path, "https://api.allegro.pl").searchParams;
      return { products: kind === "phrase" && query.has("mode") ? [] : productIds.map(id => ({ id })) };
    }
    const index = productIds.findIndex(id => path.includes(id)); assert.notEqual(index, -1);
    return { id: productIds[index], name: "Radio CITROEN C5 AIRCROSS", category: { id: kind === "similar" ? "gps" : "radio", ...(kind === "similar" ? { similar: [{ id: "radio" }] } : {}) }, parameters: [{ name: "Numer katalogowy części", values: [index < 2 && kind === "later" ? `${number}X` : number] }, { name: "Marka pojazdu", values: ["Peugeot"] }, { name: "Model pojazdu", values: ["308 II"] }] };
  }, true);
  return { ...result, paths };
}
for (const kind of ["title", "phrase", "similar", "later"]) {
  const result = await expandedFixture(kind);
  assert.ok(result.names.includes("Radio CITROEN C5 AIRCROSS"));
  assert.ok(result.names.includes("Peugeot 308 II"), "Vehicle parameters remain attached to the exact-code product");
  assert.equal(result.paths.filter(path => /^\/sale\/products\//.test(path)).length, 6, "Bounded scan includes results beyond the first two");
  if (kind === "phrase") assert.ok(result.paths.some(path => path.startsWith("/sale/products?") && !path.includes("mode=")), "Retry catalogue phrase search only with complete code verification");
}
const expandedOwn = await expandedFixture("title", [{ text: "Nieznany model" }]);
assert.equal(expandedOwn.rows[0].origin, "offer"); assert.ok(expandedOwn.names.includes("Radio CITROEN C5 AIRCROSS"), "Unusable own rows must not suppress catalogue enrichment");
await assert.rejects(() => readOvokoFitment(source, number, async () => { throw new Error("provider unavailable"); }), /provider unavailable/, "Read errors cannot become successful no-match responses");
const bundle = await build({ entryPoints: [fileURLToPath(new URL("../lib/ovoko-fitment.ts", import.meta.url))], bundle: true, write: false, format: "esm", platform: "node" });
const { matchOvokoFitment } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const brands = [{ id: "1", name: "Citroen" }, { id: "2", name: "Peugeot" }, { id: "3", name: "Audi" }];
const models = async brand => brand === "1" ? [{ id: "11", name: "C5 III", years: "2008 - 2017" }, { id: "12", name: "C5 Aircross", years: "2017 - 2024" }] : brand === "2" ? [{ id: "21", name: "308 II", years: "2013 - 2021" }] : [{ id: "31", name: "A4 (B8)", years: "2008 - 2015" }];
const fitments = [{ text: "CITROEN C5 AIRCROSS 2017/01-2024/12 1.5 HDi", origin: "catalog" }, { text: "PEUGEOT 308 II 2013/01-2021/12", origin: "catalog" }];
assert.equal((await matchOvokoFitment(fitments, brands, ["1", "2"], "RADIO CITROEN PEUGEOT OPEL", models)).modelId, "12");
assert.equal((await matchOvokoFitment(fitments, brands, ["2"], "RADIO PEUGEOT", models)).modelId, "21", "Never merge a Citroen model with a Peugeot brand from another row");
assert.equal(await matchOvokoFitment(fitments, brands, ["3"], "RADIO AUDI", models), null, "Unrelated brands are ignored");
assert.equal(await matchOvokoFitment([{ text: "AUDI A4 B8", origin: "suggestion" }], brands, ["3"], "AUDI A4 B9", models), null, "Fitment enrichment cannot bypass a known generation conflict");
const vw=[{id:"4",name:"Volkswagen"}], golfs=async()=>[{id:"41",name:"Golf V"},{id:"42",name:"Golf VII"}];
assert.equal((await matchOvokoFitment([{text:"Volkswagen Golf 7 2012-2019",origin:"catalog"}],vw,["4"],"",golfs,true)).modelId,"42");
assert.equal(await matchOvokoFitment([{text:"Volkswagen Golf 5G0907044BF",origin:"catalog"}],vw,["4"],"",golfs,true),null,"OE digits do not identify a model generation; ambiguous catalogue row cannot select the first Golf");
const variants=async()=>[{id:"variant",name:"Golf VII Variant (BA5, BV5)"},{id:"base",name:"Golf VII, e-Golf (5G1, BQ1)"}];
assert.equal((await matchOvokoFitment([{text:"Volkswagen Golf VII",origin:"catalog"}],vw,["4"],"",variants,true)).modelId,"base","Alternative names are aliases, not missing body-type requirements");
assert.equal((await matchOvokoFitment([{text:"Volkswagen Golf VII Variant",origin:"catalog"}],vw,["4"],"",variants,true)).modelId,"variant");
mode="ok";
const duplicateOrigin=await readOvokoFitment({...source,compatibilityList:{items:[{text:"CITROEN C5 AIRCROSS 2017 - 2024"}]}},number,remote,true);
assert.equal(duplicateOrigin.rows[0].origin,"catalog","Exact catalogue verification must upgrade a duplicated seller fitment row");
console.log("Ovoko fitment: owned compatibility, offer/product suggestions, exact indexed MPN and leading zero preservation, same-category checks, bounded reads and failure handling passed. No network used.");
