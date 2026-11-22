import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../lib/allegro-api.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { handleAllegroApi, sealConnection, inventoryQuery } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const raw = crypto.getRandomValues(new Uint8Array(32));
const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
const env = { SUPABASE_SERVICE_ROLE_KEY: "server-only", ALLEGRO_ENCRYPTION_KEY: Buffer.from(raw).toString("base64") };
const owners = ["00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002"];
const connections = await Promise.all(owners.map((id, index) => sealConnection({ accessToken: `seller-${index}`, expiresAt: Date.now() + 3600000 }, key, id)));
const shipping = "2991e29e-5fbc-46f5-963a-65c326ba65c2";
const request = (query = "", method = "GET", index = 0) => new Request(`https://example.test/api/allegro/inventory${query}`, { method, headers: { Authorization: `Bearer user-${index}` } });
const originalFetch = globalThis.fetch;
let calls = [], status = 200, malformed = false, detailMode = false, pageSize = null, pricedRows = null;
const cents = amount => BigInt(amount.replace(".", ""));
globalThis.fetch = async (address, options = {}) => {
  const url = new URL(address), headers = new Headers(options.headers);
  const auth = headers.get("Authorization");
  if (url.pathname === "/auth/v1/user") {
    const index = Number(auth.slice(-1));
    return Response.json({ id: owners[index] });
  }
  if (url.pathname === "/rest/v1/allegro_connections") {
    assert.equal(options.method || "GET", "GET", "Reading inventory must not write database rows with unexpired credentials");
    const index = owners.indexOf(url.searchParams.get("owner_id").slice(3));
    assert.ok(index >= 0); return Response.json([{ sealed: connections[index] }]);
  }
  assert.equal(url.origin, "https://api.allegro.pl");
  if (detailMode && url.pathname.startsWith("/sale/product-offers/")) {
    const ownedId = auth === "Bearer seller-0" ? "1234567890" : "2234567890";
    assert.equal(url.pathname, `/sale/product-offers/${ownedId}`); assert.equal(options.method || "GET", "GET");
    calls.push({ url, auth }); return Response.json({ id: ownedId, name: "Owned source preview" });
  }
  if (detailMode && url.pathname === "/me") { assert.equal(options.method || "GET", "GET"); return Response.json({ id: auth === "Bearer seller-0" ? "555" : "666" }); }
  assert.equal(url.pathname, "/sale/offers");
  assert.equal(options.method || "GET", "GET", "No seller mutations allowed");
  calls.push({ url, auth });
  if (status !== 200) return Response.json({ errors: [{ userMessage: "Odczyt niedostepny" }] }, { status });
  if (malformed) return Response.json({ totalCount: 0 });
  if (pricedRows) {
    const from = url.searchParams.get("sellingMode.price.amount.gte"), to = url.searchParams.get("sellingMode.price.amount.lte");
    const rows = pricedRows.filter(row => (!from || cents(row.amount) >= cents(from)) && (!to || cents(row.amount) <= cents(to)));
    const offset = Number(url.searchParams.get("offset")), limit = Number(url.searchParams.get("limit"));
    return Response.json({ totalCount: rows.length, offers: rows.slice(offset, offset + limit).map(row => ({ id: row.id, sellingMode: { price: { amount: row.amount, currency: "PLN" } } })) });
  }
  if (pageSize !== null) return Response.json({ totalCount: 100123, offers: Array.from({ length: pageSize }, (_, i) => ({ id: String(i + 1), sellingMode: { price: { amount: "123.45", currency: "PLN" } } })) });
  return Response.json({ totalCount: 100123, offers: [{ id: auth === "Bearer seller-0" ? "1234567890" : "2234567890", name: "Pompa 1234567", primaryImage: { url: "https://a.allegroimg.com/test.jpg" }, stock: { available: 2 }, external: { id: "BIN-1" }, publication: { status: "ACTIVE" }, delivery: { shippingRates: { id: shipping } }, sellingMode: { price: { amount: "123.45", currency: "PLN" } }, internalSecret: "must-not-leak" }] });
};
try {
  assert.equal((await handleAllegroApi(new Request("https://example.test/api/allegro/inventory"), env)).status, 401);
  const result = await handleAllegroApi(request(), env);
  assert.equal(result.status, 200); assert.equal(result.headers.get("Cache-Control"), "no-store");
  const data = await result.json();
  assert.equal(data.offers[0].shippingRateId, shipping); assert.equal(data.totalCount, 100123);
  assert.equal(data.limit, 50); assert.equal(data.offset, 0); assert.equal(data.offers[0].price.amount, "123.45");
  assert.ok(!JSON.stringify(data).includes("must-not-leak")); assert.ok(!JSON.stringify(data).includes("seller-0"));
  assert.equal(calls.at(-1).url.searchParams.get("publication.status"), "ACTIVE");
  const query = new URLSearchParams({ query: "123 & external.id=other", status: "", limit: "100", offset: "100000", searchBy: "name", shippingRate: shipping, sort: "-sellingMode.price.amount" });
  assert.equal((await handleAllegroApi(request(`?${query}`), env)).status, 200);
  assert.equal(calls.at(-1).url.searchParams.get("name"), query.get("query"));
  assert.equal(calls.at(-1).url.searchParams.get("external.id"), null);
  assert.equal(calls.at(-1).url.searchParams.get("offset"), "100000");
  assert.equal(calls.at(-1).url.searchParams.get("delivery.shippingRates.id"), shipping);
  assert.equal(calls.at(-1).url.searchParams.get("publication.status"), null);
  assert.equal((await (await handleAllegroApi(request("", "GET", 1), env)).json()).offers[0].id, "2234567890", "Each owner uses only their encrypted seller connection");
  for (const [input, from, to] of [
    ["priceFrom=123.45&priceTo=123.45", "123.45", "123.45"],
    ["priceFrom=0", "0.00", null],
    ["priceTo=00123%2C5", null, "123.50"],
    ["priceFrom=9007199254740993.01&priceTo=9007199254740993.02", "9007199254740993.01", "9007199254740993.02"],
    ["priceFrom=&priceTo=", null, null],
  ]) {
    assert.equal((await handleAllegroApi(request(`?${input}`), env)).status, 200);
    assert.equal(calls.at(-1).url.searchParams.get("sellingMode.price.amount.gte"), from);
    assert.equal(calls.at(-1).url.searchParams.get("sellingMode.price.amount.lte"), to);
    assert.equal(calls.at(-1).url.searchParams.has("priceFrom"), false);
    assert.equal(calls.at(-1).url.searchParams.has("priceTo"), false);
  }
  pageSize = 200;
  const before200 = calls.length;
  const page200 = await (await handleAllegroApi(request("?limit=200&offset=9999800&priceFrom=123.45&priceTo=123.45"), env)).json();
  assert.equal(page200.offers.length, 200); assert.equal(page200.count, 200); assert.equal(page200.limit, 200); assert.equal(page200.offset, 9999800);
  assert.equal(page200.offers[199].price.amount, "123.45", "Offers at both inclusive bounds remain in the page");
  assert.equal(calls.length, before200 + 1, "200 offers require one supported upstream request");
  assert.equal(calls.at(-1).url.searchParams.get("limit"), "200");
  pageSize = 201;
  assert.equal((await handleAllegroApi(request("?limit=200"), env)).status, 502);
  pageSize = null;
  pricedRows = ["47.99", "48.00", ...Array(198).fill("50.00"), "52.00", "52.01"].map((amount, i) => ({ id: String(i + 1), amount }));
  for (const [bounds, expectedCount, first, last] of [
    [{ priceFrom: "48", priceTo: "52" }, 200, "48.00", "52.00"],
    [{ priceFrom: "48" }, 201, "48.00", "52.00"],
    [{ priceTo: "52" }, 201, "47.99", "50.00"],
  ]) {
    const before = calls.length;
    const response = await handleAllegroApi(request(`?${new URLSearchParams({ ...bounds, limit: "200", query: "1234567", searchBy: "name" })}`), env);
    assert.equal(response.status, 200);
    const page = await response.json();
    assert.equal(page.totalCount, expectedCount); assert.equal(page.count, 200);
    assert.equal(page.offers[0].price.amount, first); assert.equal(page.offers.at(-1).price.amount, last);
    assert.equal(calls.length, before + 1, "Number-first inventory search must not scan globally to fill 200 rows");
    const forwarded = calls.at(-1).url.searchParams;
    assert.equal(forwarded.get("name"), "1234567"); assert.equal(forwarded.get("limit"), "200");
    assert.deepEqual(forwarded.getAll("sellingMode.price.amount.gte"), bounds.priceFrom ? ["48.00"] : []);
    assert.deepEqual(forwarded.getAll("sellingMode.price.amount.lte"), bounds.priceTo ? ["52.00"] : []);
  }
  pricedRows = null;
  assert.equal((await handleAllegroApi(request("?priceTo=1.00&limit=200"), env)).status, 200, "Allegro's documented upper-bound minimum is inclusive");
  for (const duplicate of ["priceFrom=48&priceFrom=48&priceTo=52", "priceFrom=48&priceTo=52&priceTo=52", "priceFrom=&priceFrom=48"]) {
    const before = calls.length;
    assert.equal((await handleAllegroApi(request(`?limit=200&${duplicate}`), env)).status, 400, duplicate);
    assert.equal(calls.length, before, "Duplicate bounds must be rejected, even when identical or blank");
  }
  const invalidPrices = ["-1", "1e2", "NaN", "Infinity", "1.001", "1,000.00", "1.", ".5", "+2", "1&owner=other", "9".repeat(31)];
  for (const name of ["priceFrom", "priceTo"]) for (const value of invalidPrices) {
    const before = calls.length;
    assert.equal((await handleAllegroApi(request(`?${new URLSearchParams({ [name]: value })}`), env)).status, 400);
    assert.equal(calls.length, before, "Invalid decimals never reach Allegro");
  }
  for (const input of ["priceFrom=2&priceTo=1.99", "priceTo=0", "priceTo=0.99", "priceFrom=9007199254740993.02&priceTo=9007199254740993.01", "priceFrom=1&priceFrom=2", "priceTo=2&priceTo=3", "limit=200&offset=9999801", "limit=201"]) {
    const before = calls.length;
    assert.equal((await handleAllegroApi(request(`?${input}`), env)).status, 400, input);
    assert.equal(calls.length, before);
  }
  const count = calls.length;
  for (const invalid of ["?limit=1000", "?offset=-1", "?offset=10000000", "?offset=9999999&limit=100", "?limit=50&limit=20", "?seller.id=other", "?owner=other", "?sort=bad", "?shippingRate=other", "?status=BAD", "?searchBy=offerId&query=abc", "?query=" + "a".repeat(101)]) assert.equal((await handleAllegroApi(request(invalid), env)).status, 400, invalid);
  for (const method of ["POST", "PATCH", "DELETE", "PUT"]) assert.equal((await handleAllegroApi(request("", method), env)).status, 405);
  assert.equal(calls.length, count, "Invalid filters and write methods never reach Allegro");
  status = 429; assert.equal((await handleAllegroApi(request(), env)).status, 429);
  status = 500; assert.equal((await handleAllegroApi(request(), env)).status, 502);
  status = 200; malformed = true;
  const failure = await handleAllegroApi(request(), env); assert.equal(failure.status, 502); assert.ok(!(await failure.json()).offers, "Malformed responses are errors, never an empty successful inventory");
  malformed = false; detailMode = true;
  const sourceRequest = (id, index = 0) => new Request(`https://example.test/api/allegro/own-offers/${id}`, { headers: { Authorization: `Bearer user-${index}` } });
  assert.equal((await (await handleAllegroApi(sourceRequest("1234567890"), env)).json()).id, "1234567890");
  const detailsBefore = calls.filter(call => call.url.pathname.startsWith("/sale/product-offers/")).length;
  assert.equal((await handleAllegroApi(sourceRequest("1234567890", 1), env)).status, 404, "Foreign seller's detail cannot be used as a preparation source");
  assert.equal(calls.filter(call => call.url.pathname.startsWith("/sale/product-offers/")).length, detailsBefore, "Detail is never fetched when ownership check fails");
  assert.equal((await (await handleAllegroApi(sourceRequest("2234567890", 1), env)).json()).id, "2234567890");
  const ovokoSourceRequest = (id, index = 0) => new Request(`https://example.test/api/allegro/ovoko-source/${id}`, { headers: { Authorization: `Bearer user-${index}` } });
  assert.deepEqual(await (await handleAllegroApi(ovokoSourceRequest("1234567890"), env)).json(), { offer: { id: "1234567890", name: "Owned source preview" }, sellerId: "555" });
  assert.equal((await handleAllegroApi(ovokoSourceRequest("1234567890", 1), env)).status, 404, "The publication-specific source route also rejects a foreign seller");
  assert.equal((await handleAllegroApi(new Request("https://example.test/api/allegro/ovoko-fitment/1234567890?number=5Q0959593EA", { headers: { Authorization: "Bearer user-1" } }), env)).status, 404, "Automatic fitment also requires an owned source offer");
  assert.equal((await handleAllegroApi(new Request("https://example.test/api/allegro/ovoko-fitment/1234567890?number=../delete", { headers: { Authorization: "Bearer user-0" } }), env)).status, 400);
  assert.equal(inventoryQuery(new URLSearchParams("shippingRate=none")).remote.get("delivery.shippingRates.id.empty"), "true");
  console.log("Inventory API: 200-row number-first pages, inclusive 48..52 fixtures, single bounds, exact decimals, duplicate/invalid/reversed bounds, seller isolation and read-only failures passed. No live requests.");
} finally { globalThis.fetch = originalFetch; }
