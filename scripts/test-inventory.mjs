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
let calls = [], status = 200, malformed = false;
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
  assert.equal(url.pathname, "/sale/offers");
  assert.equal(options.method || "GET", "GET", "No seller mutations allowed");
  calls.push({ url, auth });
  if (status !== 200) return Response.json({ errors: [{ userMessage: "Odczyt niedostepny" }] }, { status });
  if (malformed) return Response.json({ totalCount: 0 });
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
  const count = calls.length;
  for (const invalid of ["?limit=1000", "?offset=-1", "?offset=10000000", "?offset=9999999&limit=100", "?limit=50&limit=20", "?seller.id=other", "?owner=other", "?sort=bad", "?shippingRate=other", "?status=BAD", "?searchBy=offerId&query=abc", "?query=" + "a".repeat(101)]) assert.equal((await handleAllegroApi(request(invalid), env)).status, 400, invalid);
  for (const method of ["POST", "PATCH", "DELETE", "PUT"]) assert.equal((await handleAllegroApi(request("", method), env)).status, 405);
  assert.equal(calls.length, count, "Invalid filters and write methods never reach Allegro");
  status = 429; assert.equal((await handleAllegroApi(request(), env)).status, 429);
  status = 500; assert.equal((await handleAllegroApi(request(), env)).status, 502);
  status = 200; malformed = true;
  const failure = await handleAllegroApi(request(), env); assert.equal(failure.status, 502); assert.ok(!(await failure.json()).offers, "Malformed responses are errors, never an empty successful inventory");
  assert.equal(inventoryQuery(new URLSearchParams("shippingRate=none")).remote.get("delivery.shippingRates.id.empty"), "true");
  console.log("Inventory API: seller isolation, read-only methods, bounded pagination beyond 100k, strict filters, shipping IDs, no-store and failure handling passed. No live requests.");
} finally { globalThis.fetch = originalFetch; }
