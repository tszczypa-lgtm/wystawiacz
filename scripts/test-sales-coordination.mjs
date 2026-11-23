import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
function load(name, require = () => { throw new Error("Unexpected dependency"); }) {
  const text = readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), "utf8");
  const source = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} }; new Function("require", "module", "exports", source)(require, module, module.exports); return module.exports;
}
const policy = load("sales-coordination"), { decideSalesCoordination: decide, allegroSaleEvidence: parse, withdrawalPlan } = policy;
const at = "2026-11-23T12:00:00Z", sale = { source: "allegro", itemId: "item-1", eventId: "1", listingId: "10", at, quantity: 1, kind: "purchase" };
const pair = { offerId: "10", partId: "20", linked: true, allegroStatus: "ENDED", stock: 0, ovokoStatus: "stock" };
assert.equal(decide(pair, [sale]).action, "sold_ovoko");
assert.equal(decide(pair, [sale, { ...sale, orderId: "2", at: "2026-11-23T12:01:00Z" }]).action, "sold_ovoko", "BOUGHT and READY for one line item count once");
for (const change of [{ linked: false }, { partId: "" }, { stock: 1 }, { stock: 2 }, { stock: null }, { ovokoStatus: "unknown" }, { ovokoStatus: "reserved" }, { ovokoStatus: "withdrawn" }]) assert.equal(decide({ ...pair, ...change }, [sale]).action, null);
assert.equal(decide(pair, []).status, "review", "Ended or empty stock alone never proves a sale");
assert.equal(decide({ ...pair, stock: 1, allegroStatus: "ACTIVE" }, []).status, "idle");
assert.equal(decide(pair, [{ ...sale, quantity: 2 }]).action, null);
assert.equal(decide(pair, [sale, { ...sale, itemId: "another-unit" }]).action, null);
assert.equal(decide(pair, [sale, { ...sale, kind: "cancelled", at: "2026-11-23T13:00:00+01:00" }]).action, null, "Cancellation wins even for equal instants with different offsets");
const oSale = { ...sale, source: "ovoko", listingId: "20" };
assert.equal(decide({ ...pair, ovokoStatus: "sold", stock: 1, allegroStatus: "ACTIVE" }, [oSale]).action, "end_allegro");
assert.equal(decide({ ...pair, ovokoStatus: "sold", stock: 2, allegroStatus: "ACTIVE" }, [oSale]).action, null);
assert.equal(decide({ ...pair, ovokoStatus: "sold" }, [oSale]).status, "idle");
assert.equal(decide({ ...pair, ovokoStatus: "sold" }, [sale, oSale]).status, "review", "Double-sale alert cannot select a winner");
assert.equal(decide({ ...pair, ovokoStatus: "sold" }, []).action, null);
const event = { id: "1", type: "BOUGHT", occurredAt: at, order: { seller: { id: "555" }, buyer: { email: "private@test" }, lineItems: [{ id: "line-1", offer: { id: "10" }, quantity: 1 }] } };
const parsed = parse({ events: [event] }, "555"); assert.equal(parsed.length, 1); assert.doesNotMatch(JSON.stringify(parsed), /private|buyer/);
assert.equal(parsed[0].eventId, "1"); assert.equal(parsed[0].orderId, undefined, "An event ID is not an order ID");
assert.throws(() => parse({ events: [event] }, "666"));
for (const change of [{ id: "bad" }, { occurredAt: "yesterday" }, { order: {} }]) assert.throws(() => parse({ events: [{ ...event, ...change }] }, "555"));
for (const scope of ["allegro", "ovoko", "both"]) {
  const result = withdrawalPlan(scope, { allegro: true, ovoko: true, conflict: false });
  assert.equal(result.length, scope === "both" ? 2 : 1); assert.ok(result.every(item => !item.deletePhotos));
}
assert.throws(() => withdrawalPlan("both", { allegro: true, ovoko: false, conflict: false }));
assert.throws(() => withdrawalPlan("allegro", { allegro: true, ovoko: true, conflict: true }));
// Exercise the real read adapter with mocked seller identity, journal and Ovoko responses.
const read = load("ovoko-read");
let journalState = "created", duplicate = false, foreign = false, failed = false, reads = [];
const remote = async path => {
  reads.push(path); assert.ok(path.startsWith("/get/") || path.startsWith("/v2/get/"), "Review has no provider mutation path");
  if (failed) throw new Error("read failed");
  if (path === "/get/part_status") return { status_code: "R200", list: { "0": { pl: "Na stanie" }, "2": { pl: "Sprzedano" } } };
  assert.match(path, /^\/v2\/get\/parts\?external_ids=tymo%3A555%3A10&page=1&limit=2$/);
  return { status_code: "R200", data: [{ id: "20", external_id: foreign ? "tymo:666:10" : "tymo:555:10", status: "0" }, ...(duplicate ? [{ id: "21", external_id: "tymo:555:10", status: "0" }] : [])], pagination: { page: 1, limit: 2, total_count: duplicate ? 2 : 1 } };
};
const { reviewCoordination } = load("coordination-review", name => {
  if (name === "./allegro-api") return { handleAllegroApi: async () => Response.json({ sellerId: "555", offers: [{ id: "10", name: "Part", status: "ENDED", stock: 0 }], evidence: [sale], eventsRead: 1, partial: false }) };
  if (name === "./ovoko-connection") return { loadOvokoConnection: async () => ({ username: "fixture" }), ovokoConnectionKey: async () => ({}) };
  if (name === "./ovoko-write-client") return { ovokoWriteClient: () => remote, ovokoWriteDigest: async () => "a".repeat(64) };
  if (name === "./ovoko-read") return read;
  if (name === "./sales-coordination") return policy;
  throw new Error(name);
});
const context = { user: { id: "owner" }, db: async (path, options) => { assert.equal(options, undefined); assert.match(path, /owner_id=eq.owner.*ovoko_account=eq.a{64}.*allegro_seller_id=eq.555.*allegro_offer_id=eq.10/); return [{ state: journalState, part_id: "20" }]; } };
const request = new Request("https://fixture.test/api/ovoko/coordination-review", { headers: { Authorization: "Bearer fixture" } });
const result = await reviewCoordination(request, {}, context, { offerIds: ["10"] });
assert.equal(result.readOnly, true); assert.equal(result.automatic, false); assert.equal(result.rows[0].decision.action, "sold_ovoko");
for (const failure of ["uncertain", "duplicate", "foreign"]) {
  journalState = failure === "uncertain" ? "uncertain" : "created"; duplicate = failure === "duplicate"; foreign = failure === "foreign";
  const checked = await reviewCoordination(request, {}, context, { offerIds: ["10"] }); assert.equal(checked.rows[0].linked, false); assert.equal(checked.rows[0].decision.action, null);
}
failed = true; await assert.rejects(reviewCoordination(request, {}, context, { offerIds: ["10"] }));
for (const input of [{ offerIds: [] }, { offerIds: ["10", "10"] }, { offerIds: ["../10"] }, { offerIds: ["10"], action: "delete" }]) await assert.rejects(reviewCoordination(request, {}, context, input));
const actual = load("allegro-api", name => { assert.equal(name, "./sales-coordination"); return policy; });
const rawKey = new Uint8Array(32).fill(7), key = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["encrypt", "decrypt"]);
const sealed = await actual.sealConnection({ accessToken: "fixture", expiresAt: Date.now() + 3600000 }, key, "owner");
const originalFetch = globalThis.fetch;
let eventSeller = "555", ownerMatch = true;
try {
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(input); assert.equal(options.method || "GET", "GET", "Observation never mutates Allegro");
    if (url.pathname === "/auth/v1/user") return Response.json({ id: "owner" });
    if (url.pathname === "/rest/v1/allegro_connections") return Response.json([{ sealed }]);
    assert.equal(url.origin, "https://api.allegro.pl");
    if (url.pathname === "/me") return Response.json({ id: "555" });
    if (url.pathname === "/sale/offers") { assert.equal(url.searchParams.get("offer.id"), "10"); return Response.json({ offers: ownerMatch ? [{ id: "10", name: "Part", publication: { status: "ENDED" }, stock: { available: 0 } }] : [] }); }
    assert.equal(url.pathname, "/order/events"); assert.equal(url.searchParams.get("limit"), "1000");
    return Response.json({ events: [{ ...event, order: { ...event.order, seller: { id: eventSeller } } }] });
  };
  const env = { SUPABASE_SERVICE_ROLE_KEY: "fixture", ALLEGRO_ENCRYPTION_KEY: Buffer.from(rawKey).toString("base64") };
  const req = suffix => new Request(`https://fixture.test/api/allegro/coordination-snapshot?offerIds=${suffix}`, { headers: { Authorization: "Bearer session" } });
  const success = await actual.handleAllegroApi(req("10"), env); assert.equal(success.status, 200); const body = await success.text(); assert.doesNotMatch(body, /private|buyer|accessToken/);
  eventSeller = "666"; assert.equal((await actual.handleAllegroApi(req("10"), env)).status, 502);
  eventSeller = "555"; ownerMatch = false; assert.equal((await actual.handleAllegroApi(req("10"), env)).status, 409);
  for (const ids of ["10,10", "../10", "1,2,3,4,5,6"]) assert.equal((await actual.handleAllegroApi(req(ids), env)).status, 400);
} finally { globalThis.fetch = originalFetch; }
console.log("Sales coordination: evidence dedupe/cancellation, exact links, last-unit guards, double-sale alerts, scoped withdrawal plans and read-only provider review passed. No automatic writes enabled.");
