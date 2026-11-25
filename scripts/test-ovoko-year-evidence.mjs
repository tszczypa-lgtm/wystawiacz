import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const bundle = await build({ entryPoints: [fileURLToPath(new URL("../lib/ovoko-year-evidence.ts", import.meta.url))], bundle: true, write: false, platform: "node", format: "esm" });
const { suggestOvokoYearEvidence } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const number = "5Q0959593EA", brand = { id: "1", name: "Audi" };
const model = { id: "10", name: "A4 (B8)", brand: "1" };
const models = [model, { id: "11", name: "A4 (B9)" }, { id: "12", name: "A6 (C7)" }];
const source = { id: "101", title: "RADIO AUDI A4 B8", parameters: [], description: "", categoryId: "radio" };
const fit = (text, origin = "catalog") => ({ text, origin });
const ownOffer = (changes = {}) => ({ id: "102", name: `RADIO AUDI A4 B8 ${number} 2012`, category: { id: "radio" }, parameters: [], ...changes });
const part = (changes = {}) => ({ id: "200", car_id: "300", manufacturer_code: number, ...changes });
const car = (changes = {}) => ({ id: "300", car_model: "10", car_years: "2011", ...changes });
let tests = 0;
async function run(changes = {}, handlers = {}) {
  const calls = [];
  const input = { source, number, brand, model, models, fitmentRows: [], ...changes,
    allegro: async path => {
      calls.push(["allegro", path]);
      assert.ok(/^\/ovoko-fitment\/\d+\?expand=1&number=[A-Z0-9]+$/.test(path) || /^\/sale\/offers\?name=[A-Z0-9]+&limit=5$/.test(path) || /^\/sale\/product-offers\/\d+$/.test(path), `Read-only allowlist: ${path}`);
      return handlers.allegro ? handlers.allegro(path) : {};
    },
    ovoko: async path => {
      calls.push(["ovoko", path]);
      assert.ok(/^\/v2\/get\/parts\?search=[A-Z0-9]+&page=1&limit=5$/.test(path) || /^\/get\/car\/\d+$/.test(path), `Read-only allowlist: ${path}`);
      return handlers.ovoko ? handlers.ovoko(path) : {};
    } };
  const value = await suggestOvokoYearEvidence(input);
  if (value) {
    assert.equal(value.technical, true);
    assert.match(value.reason, /nie potwierdza rocznika dawcy/);
    assert.match(value.reason, /^[\x20-\x7e]+$/);
  }
  assert.ok(calls.filter(([, path]) => path.startsWith("/sale/product-offers/")).length <= 3);
  assert.ok(calls.filter(([, path]) => path.startsWith("/get/car/")).length <= 2);
  tests++;
  return { value, calls };
}
for (const value of ["", " ", "ABCDEF", "123", "<script>123456</script>"]) {
  const result = await run({ number: value }); assert.equal(result.value, null); assert.deepEqual(result.calls, []);
}
for (const range of ["2008-2015", "2008 - 2015", "2008/01-2015/12", "01/2008 - 12/2015", "2008.01-2015.12", "2008\u20132015"]) {
  const result = await run({ fitmentRows: [fit(`AUDI A4 B8 ${range} 2000cc`)] });
  assert.equal(result.value?.year, "2008"); assert.equal(result.value.source, "allegro-fitment"); assert.match(result.value.reason, /catalog/); assert.equal(result.calls.length, 0);
}
const ranges = [fit("AUDI A4 B8 2013-2015", "offer"), fit("AUDI A4 B8 2008-2012", "catalog")];
assert.deepEqual((await run({ fitmentRows: ranges })).value, (await run({ fitmentRows: [...ranges].reverse() })).value);
assert.equal((await run({ model: { ...model, years: "2010 - 2014" }, fitmentRows: [fit("AUDI A4 B8 2008-2015")] })).value?.year, "2010");
assert.equal((await run({ model: { ...model, years: " - 2014" }, fitmentRows: [fit("AUDI A4 B8 2008-2015")] })).value?.year, "2008");
for (const row of ["AUDI A4 B9 2008-2015", "AUDI A6 C7 2008-2015", "BMW A4 B8 2008-2015", "AUDI A4 2008-2015", "AUDI A40 B8 2008-2015", "AUDI A4 B8 2000cc", "AUDI A4 B8 2000 PLN", "AUDI A4 B8 OE20082015", "AUDI A4 B8 2015-2008", "AUDI A4 B8 2008/13-2015/12", "AUDI A4 B8 2008/12-2008/01", "AUDI A4 B8 cena 2008-2015 PLN"]) {
  assert.equal((await run({ fitmentRows: [fit(row)] })).value, null, row);
}
assert.equal((await run({ model: { ...model, years: "2016 - 2019" }, fitmentRows: ranges })).value, null);
const fetched = await run({ fitmentRows: undefined }, { allegro: path => path.startsWith("/ovoko-fitment/") ? { rows: ranges } : {} });
assert.equal(fetched.value?.year, "2008"); assert.equal(fetched.calls.length, 1);
const empty = await run({}, { allegro: () => { throw new Error("private provider error"); } });
assert.equal(empty.value, null); assert.ok(!empty.calls.some(([, path]) => path.startsWith("/ovoko-fitment/")), "Explicit empty rows skip refetch");

function offers(detail, offers = [{ id: "101" }, { id: "102" }]) {
  return path => path.startsWith("/sale/offers?") ? { offers } : detail;
}
const owned = await run({}, { allegro: offers(ownOffer()) });
assert.equal(owned.value?.year, "2012"); assert.equal(owned.value.source, "allegro-offer"); assert.equal(owned.value.sourceUrl, "https://allegro.pl/oferta/102");
assert.deepEqual(owned.calls, [["allegro", `/sale/offers?name=${number}&limit=5`], ["allegro", "/sale/product-offers/102"]], "Only owner-scoped API-style adapters; source offer skipped");
for (const details of [
  ownOffer({ name: "AUDI A4 B8 5Q0959593E 2012" }),
  ownOffer({ name: "AUDI A4 B8 5Q0959593EAX 2012" }),
  ownOffer({ name: `AUDI A4 B9 ${number} 2012` }),
  ownOffer({ name: `AUDI A40 B8 ${number} 2012` }),
  ownOffer({ name: `BMW A4 B8 ${number} 2012` }),
  ownOffer({ category: { id: "engine" } }),
  ownOffer({ id: "999" }),
  ownOffer({ name: `AUDI A4 B8 ${number} 2000cc 2001 PLN 2002.00 2003/12` }),
  ownOffer({ name: `AUDI A4 B8 ${number}`, description: { sections: [{ items: [{ type: "TEXT", content: "<p>rok produkcji 2012</p>" }] }] } }),
]) assert.equal((await run({}, { allegro: offers(details) })).value, null, JSON.stringify(details));
assert.equal((await run({ model: { ...model, years: "2008 - 2015" } }, { allegro: offers(ownOffer({ name: `AUDI A4 B8 ${number}` })) })).value, null, "No dictionary-only fallback");
const parameterYear = ownOffer({ name: "Radio Audi A4 B8", parameters: [{ name: "Numer katalogowy czesci", values: ["5Q0 959 593 EA"] }, { name: "Rok produkcji", values: ["2010"] }] });
assert.equal((await run({}, { allegro: offers(parameterYear) })).value?.year, "2010");
const productYear = ownOffer({ name: "Radio", productSet: [{ product: { parameters: [...parameterYear.parameters, { name: "Marka pojazdu", values: ["Audi"] }, { name: "Model pojazdu", values: ["A4 B8"] }] } }] });
assert.equal((await run({}, { allegro: offers(productYear) })).value?.year, "2010");
assert.equal((await run({}, { allegro: offers(ownOffer({ name: "Radio Audi A4 B8", parameters: [{ name: "Numer OE", values: [number] }, { name: "Rok produkcji", values: ["2010/01-2014/12"] }] })) })).value?.year, "2010");
assert.equal((await run({ number: "5Q0959593E" }, { allegro: offers(ownOffer({ parameters: [{ name: "Numer OE", values: ["5Q0959593E"] }] })) })).value, null, "A truncated parameter cannot override a full title suffix");
for (const trap of ["2000 cm\u00b3", "2000 ccm", "2000 cm 3", "2000 \u20ac", "$2000", "EUR 2000", "cena: 2000"]) {
  assert.equal((await run({}, { allegro: offers(ownOffer({ name: `Audi A4 B8 ${number} ${trap}` })) })).value, null, trap);
}
assert.equal((await run({ source: { ...source, title: "Audi A4 B9" }, fitmentRows: ranges })).value, null, "Evidence cannot override a source generation conflict");

function ovoko(parts = [part()], cars = car()) {
  return path => path.startsWith("/v2/get/parts?") ? { status_code: "R200", data: parts } : { status_code: "R200", list: [[cars]] };
}
const fallback = await run({ fitmentRows: undefined }, { allegro: () => { throw new Error("403 secret"); }, ovoko: ovoko() });
assert.equal(fallback.value?.year, "2011"); assert.equal(fallback.value.source, "ovoko-part"); assert.match(fallback.value.reason, /200.*300/);
for (const field of ["manufacturer_code", "visible_code", "other_code", "optional_codes"]) for (const value of [number, [number]]) {
  assert.equal((await run({}, { ovoko: ovoko([part({ manufacturer_code: "", [field]: value })]) })).value?.year, "2011");
}
for (const value of ["5Q0959593E", "5Q0959593EAX", `Radio ${number}`, { code: number }, [null, { code: number }]]) {
  const result = await run({}, { ovoko: ovoko([part({ manufacturer_code: value })]) }); assert.equal(result.value, null); assert.equal(result.calls.filter(([, path]) => path.startsWith("/get/car/")).length, 0);
}
for (const changes of [{ car_model: "11" }, { id: "999" }, { car_years: "0" }, { car_years: "1885" }, { car_years: "9999" }, { car_years: "2010-2012" }, { car_years: "2011cc" }]) {
  assert.equal((await run({}, { ovoko: ovoko([part()], car(changes)) })).value, null);
}
assert.equal((await run({ model: { ...model, years: "2012 - 2015" } }, { ovoko: ovoko() })).value, null);
assert.equal((await run({}, { ovoko: ovoko([part({ car_id: undefined, car: { id: "300" } })]) })).value?.year, "2011");
assert.equal((await run({}, { ovoko: () => { throw new Error("private token"); } })).value, null);
assert.equal((await run({ fitmentRows: undefined }, { allegro: () => { throw new Error("secret"); }, ovoko: () => { throw new Error("secret"); } })).value, null);
assert.equal((await run({}, { ovoko: () => ({ status_code: "R400", data: [part()], list: [[car()]] }) })).value, null);

const bounded = await run({ fitmentRows: undefined }, {
  allegro: path => path.startsWith("/ovoko-fitment/") ? { rows: [] } : path.startsWith("/sale/offers?") ? { offers: [{ id: "101" }, { id: "102" }, { id: "102" }, { id: "103" }, { id: "104" }, { id: "105" }] } : {},
  ovoko: path => path.startsWith("/v2/get/parts?") ? { data: [part(), part(), part({ car_id: "301" }), part({ car_id: "302" }), part({ car_id: "303" })] } : { list: [[car({ id: path.split("/").at(-1), car_years: path.endsWith("301") ? "2009" : "2011" })]] },
});
assert.equal(bounded.value?.year, "2009"); assert.equal(bounded.calls.length, 8);
assert.equal(new Set(bounded.calls.filter(([, path]) => path.startsWith("/get/car/")).map(([, path]) => path)).size, 2);
console.log(`Ovoko year evidence: ${tests} offline scenarios passed (exact MPN, generation, ranges, traps, owner-scoped adapters, outages, bounded read-only calls).`);
