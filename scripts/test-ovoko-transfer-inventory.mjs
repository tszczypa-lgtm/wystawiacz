import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
const root = fileURLToPath(new URL("../", import.meta.url)), native = createRequire(import.meta.url), cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  const source = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  new Function("require", "module", "exports", source)(name => name.startsWith(".") ? load(path.resolve(path.dirname(file), name + ".ts")) : native(name), module, module.exports);
  return module.exports;
}
const { handleOvokoApi } = load(path.join(root, "lib/ovoko-api.ts"));
const { sealConnection } = load(path.join(root, "lib/allegro-api.ts"));
const { ovokoWriteDigest } = load(path.join(root, "lib/ovoko-write-client.ts"));
const bytes = new Uint8Array(32).fill(7), key = await crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
const env = { BILLING_ENFORCED: "true", SUPABASE_SERVICE_ROLE_KEY: "fixture", ALLEGRO_ENCRYPTION_KEY: Buffer.from(bytes).toString("base64") };
let user = 0, admin, mode, pages, journal, seller, target, total, priceBounds, pricedRows, journalBatches, search, requestPages, stock;
const owner = () => `00000000-0000-0000-0000-${String(user).padStart(12, "0")}`;
function reset() { user++; admin = true; mode = "ok"; pages = []; journal = []; seller = "555"; target = "fixture"; total = 900; priceBounds = [null, null]; pricedRows = null; journalBatches = []; search = "ABS"; stock = {}; }
const cents = amount => BigInt(amount.replace(".", ""));
const req = (input, origin = "https://inventory.test") => new Request("https://inventory.test/api/ovoko/transfer-inventory", { method: "POST", headers: { Authorization: "Bearer fixture", Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(input) });
const query = (transfer = "transferred", offset = 0) => ({ operation: "inventory", filters: { status: "ACTIVE", limit: "20", query: "ABS", searchBy: "name", sort: "stock.available" }, transfer, offset });
const record = (id, state = "created", partId = "77") => ({ allegro_offer_id: String(id), state, part_id: partId, seller: "555", target: "fixture" });
const originalFetch = globalThis.fetch;
globalThis.fetch = async (address, options = {}) => {
  const url = new URL(address), method = options.method || "GET";
  if (url.pathname === "/rest/v1/rpc/ovoko_stock_transfer_status") {
    assert.equal(method, "POST");
    const args = JSON.parse(options.body);
    assert.equal(args.p_owner, owner()); assert.equal(args.p_account, await ovokoWriteDigest(target)); assert.equal(args.p_seller, seller);
    assert.ok(args.p_offers.length <= 200); assert.equal(new Set(args.p_offers).size, args.p_offers.length);
    if (mode === "missing-stock-rpc") return Response.json({ message: "missing" }, { status: 404 });
    return Response.json(stock);
  }
  assert.equal(method, "GET", "All mocked network calls are read-only; no marketplace or journal writes");
  if (url.pathname === "/auth/v1/user") return Response.json({ id: owner(), email_confirmed_at: "2026-01-01" });
  if (url.pathname === "/rest/v1/customer_accounts") return Response.json([{ owner_id: owner(), company: {}, suspended: false }]);
  if (url.pathname === "/rest/v1/account_admins") return Response.json(admin ? [{ owner_id: owner() }] : []);
  if (url.pathname === "/rest/v1/ovoko_connections") {
    assert.equal(url.searchParams.get("owner_id"), `eq.${owner()}`);
    return Response.json(mode === "disconnected" ? [] : [{ sealed: await sealConnection({ username: target, password: "private-password", user_token: "private-token" }, key, `ovoko:v1:${owner()}`) }]);
  }
  if (url.pathname === "/rest/v1/allegro_connections") {
    assert.equal(url.searchParams.get("owner_id"), `eq.${owner()}`);
    return Response.json([{ sealed: await sealConnection({ accessToken: "seller-token", expiresAt: Date.now() + 3600000 }, key, owner()) }]);
  }
  if (url.pathname === "/rest/v1/ovoko_single_publications") {
    assert.equal(url.searchParams.get("owner_id"), `eq.${owner()}`);
    assert.equal(url.searchParams.get("allegro_seller_id"), `eq.${seller}`);
    assert.equal(url.searchParams.get("ovoko_account"), `eq.${await ovokoWriteDigest(target)}`);
    assert.equal(url.searchParams.get("limit"), "200");
    if (mode === "db-error") return new Response("private-db-error", { status: 503 });
    const ids = url.searchParams.get("allegro_offer_id").slice(4, -1).split(",");
    assert.ok(ids.length <= 200); assert.equal(new Set(ids).size, ids.length, "Status lookup must deduplicate IDs");
    journalBatches.push(ids);
    return Response.json(mode === "bad-journal" ? [{ allegro_offer_id: "9999", state: "created", part_id: "77" }] : journal.filter(row => row.seller === seller && row.target === target && ids.includes(row.allegro_offer_id)).map(({ seller, target, ...row }) => row));
  }
  assert.equal(url.origin, "https://api.allegro.pl");
  assert.equal(new Headers(options.headers).get("Authorization"), "Bearer seller-token");
  if (url.pathname === "/me") return Response.json({ id: seller, privateProfile: "must-not-leak" });
  assert.equal(url.pathname, "/sale/offers");
  const offset = Number(url.searchParams.get("offset")), limit = Number(url.searchParams.get("limit")); pages.push(offset);
  assert.ok(++requestPages <= 5, "A transfer request may fetch at most five source pages, never an unbounded scan");
  assert.equal(limit, 200); assert.ok(offset + limit <= 10000000);
  assert.equal(url.searchParams.get("sellingMode.price.amount.gte"), priceBounds[0]);
  assert.equal(url.searchParams.get("sellingMode.price.amount.lte"), priceBounds[1]);
  assert.deepEqual(url.searchParams.getAll("sellingMode.price.amount.gte"), priceBounds[0] === null ? [] : [priceBounds[0]]);
  assert.deepEqual(url.searchParams.getAll("sellingMode.price.amount.lte"), priceBounds[1] === null ? [] : [priceBounds[1]]);
  assert.equal(url.searchParams.get("name"), search);
  assert.equal(url.searchParams.get("sort"), "stock.available");
  if (pricedRows) {
    const rows = pricedRows.filter(row => (!priceBounds[0] || cents(row.amount) >= cents(priceBounds[0])) && (!priceBounds[1] || cents(row.amount) <= cents(priceBounds[1])));
    return Response.json({ totalCount: rows.length, offers: rows.slice(offset, offset + limit).map(row => ({ id: row.id, name: search, sellingMode: { price: { amount: row.amount, currency: "PLN" } }, publication: { status: "ACTIVE" } })) });
  }
  const count = mode === "empty-source" ? 0 : Math.min(limit, Math.max(0, total - offset));
  return Response.json({ totalCount: total, offers: Array.from({ length: count }, (_, i) => ({ id: String(offset + i + 1), name: "ABS", publication: { status: "ACTIVE" } })) });
};
async function run(input, status = 200) { requestPages = 0; const response = await handleOvokoApi(req(input), env); const body = await response.json(); assert.equal(response.status, status, JSON.stringify(body)); assert.ok(!JSON.stringify(body).includes("private-")); return body; }
try {
  reset(); admin = false; await run(query(), 403); assert.deepEqual(pages, []);
  reset(); assert.equal((await handleOvokoApi(req(query(), "https://evil.test"), env)).status, 403);
  for (const input of [{ ...query(), offset: -1 }, { ...query(), offset: 10000000 }, { ...query(), transfer: "queued" }, { ...query(), filters: { seller: "other" } }, { operation: "statuses", offerIds: ["../delete"] }, { operation: "statuses", offerIds: Array(201).fill("1") }, { ...query(), owner: "other" }, ...["1e2", "-1", "1.001"].map(priceFrom => ({ ...query(), filters: { ...query().filters, priceFrom } })), { ...query(), filters: { ...query().filters, priceFrom: "2", priceTo: "1" } }]) { reset(); await run(input, 400); assert.deepEqual(pages, []); }
  reset(); mode = "disconnected"; await run(query(), 409);
  reset(); journal = [record(1), record(2, "sending"), record(3, "uncertain"), record(4, "created", null), { ...record(5), seller: "666" }, { ...record(6), target: "other" }];
  const states = await run({ operation: "statuses", offerIds: ["1", "2", "3", "4", "5", "6"] });
  assert.deepEqual(Object.fromEntries(Object.entries(states.statuses).map(([id, row]) => [id, row.state])), { "1": "transferred", "2": "sending", "3": "uncertain", "4": "uncertain", "5": "not_transferred", "6": "not_transferred" });
  assert.deepEqual(states.statuses["1"], { state: "transferred", partId: "77", partIds: ["77"], totalUnits: 1, completedUnits: 1 });
  seller = "666"; const otherSeller = await run({ operation: "statuses", offerIds: ["1", "5"] }); assert.equal(otherSeller.statuses["1"].state, "not_transferred"); assert.equal(otherSeller.statuses["5"].state, "transferred");
  reset(); mode = "db-error"; await run({ operation: "statuses", offerIds: ["1"] }, 503);
  reset(); mode = "bad-journal"; await run({ operation: "statuses", offerIds: ["1"] }, 502);
  reset(); journal = Array.from({ length: 40 }, (_, i) => record(151 + i));
  const first = await run(query()); assert.equal(first.offers.length, 20); assert.equal(first.offers[0].id, "151"); assert.equal(first.nextOffset, 170); assert.equal(first.scanned, 170); assert.equal(first.totalCount, 900); assert.deepEqual(pages, [0]);
  const second = await run(query("transferred", first.nextOffset)); assert.equal(second.offers[0].id, "171"); assert.equal(second.offers.at(-1).id, "190"); assert.equal(second.nextOffset, 190);
  reset(); total = 2000; const empty = await run(query()); assert.deepEqual(empty.offers, []); assert.equal(empty.nextOffset, 1000); assert.equal(empty.scanned, 1000); assert.equal(pages.length, 5);
  reset(); total = 0; const none = await run(query()); assert.equal(none.nextOffset, null);
  reset(); mode = "empty-source"; await run(query(), 502);
  reset(); total = 10000001; const end = await run(query("not_transferred", 9999995)); assert.equal(end.offers.length, 5); assert.equal(end.nextOffset, null); assert.deepEqual(pages, [9999800]);
  reset(); journal = Array.from({ length: 200 }, (_, i) => record(i + 1));
  const allStates = await run({ operation: "statuses", offerIds: journal.map(row => row.allegro_offer_id) });
  assert.equal(Object.keys(allStates.statuses).length, 200); assert.equal(allStates.statuses["200"].state, "transferred");
  assert.deepEqual(journalBatches, [journal.map(row => row.allegro_offer_id)], "All 200 status IDs are queried together, not truncated to 100");
  reset(); await run({ operation: "statuses", offerIds: Array.from({ length: 201 }, (_, i) => String(i + 1)) }, 400);
  assert.deepEqual(journalBatches, []); assert.deepEqual(pages, []);
  reset(); journal = [record(48)];
  const repeated = await run({ operation: "statuses", offerIds: Array(200).fill("48") });
  assert.equal(repeated.statuses["48"].state, "transferred"); assert.deepEqual(journalBatches, [["48"]]);
  reset(); journal = [record(48), record(48)];
  await run({ operation: "statuses", offerIds: ["48", "52"] }, 502);
  for (const [bounds, expectedBounds, expectedIds] of [
    [{ priceFrom: "48", priceTo: "52" }, ["48.00", "52.00"], ["2", "3", "4"]],
    [{ priceFrom: "48" }, ["48.00", null], ["2", "3", "4", "5"]],
    [{ priceTo: "52" }, [null, "52.00"], ["1", "2", "3", "4"]],
    [{ priceTo: "1.00" }, [null, "1.00"], []],
  ]) {
    reset(); priceBounds = expectedBounds;
    pricedRows = ["47.99", "48.00", "50.00", "52.00", "52.01"].map((amount, i) => ({ id: String(i + 1), amount }));
    journal = pricedRows.map(row => record(row.id));
    const input = query(); input.filters = { ...input.filters, ...bounds, limit: "200" };
    const result = await run(input);
    assert.deepEqual(result.offers.map(row => row.id), expectedIds, JSON.stringify(bounds));
    assert.equal(result.totalCount, expectedIds.length); assert.equal(result.scanned, expectedIds.length); assert.equal(result.nextOffset, null);
    assert.deepEqual(pages, [0], "Price filtering happens upstream, not via a global inventory scan");
  }
  // JSON filter objects cannot carry duplicate keys; reject repeated values encoded as arrays too.
  for (const filters of [
    { priceFrom: "52", priceTo: "48" }, { priceFrom: "48.01", priceTo: "48.00" },
    ...["priceFrom", "priceTo"].flatMap(name => ["NaN", "Infinity", "1e2", "-1", "48.001", "48&priceTo=52", ["48", "52"], 48, null].map(value => ({ [name]: value }))),
    { priceTo: "0.99" }, { priceTo: "0" }, { "priceFrom=48&priceFrom": "52" },
  ]) {
    reset(); const input = query(); input.filters = { ...input.filters, limit: "200", ...filters };
    await run(input, 400); assert.deepEqual(pages, []); assert.deepEqual(journalBatches, [], "Invalid/duplicate-shaped bounds never reach source or status reads");
  }
  reset(); search = "1234567"; priceBounds = ["48.00", "52.00"];
  pricedRows = ["47.99", "48.00", ...Array(198).fill("50.00"), "52.00", "52.01"].map((amount, i) => ({ id: String(i + 1), amount }));
  journal = pricedRows.map(row => record(row.id));
  const numberFirst = query(); numberFirst.filters = { ...numberFirst.filters, query: search, limit: "200", priceFrom: "48", priceTo: "52" };
  const range200 = await run(numberFirst);
  assert.equal(range200.count, 200); assert.equal(range200.limit, 200); assert.equal(range200.totalCount, 200);
  assert.equal(range200.offers[0].price.amount, "48.00"); assert.equal(range200.offers.at(-1).price.amount, "52.00");
  assert.equal(range200.scanned, 200); assert.equal(range200.nextOffset, null); assert.deepEqual(pages, [0]); assert.equal(journalBatches[0].length, 200);
  reset(); total = 10000000; priceBounds = ["48.00", "52.00"]; journal = [record(1001)];
  const sparseInput = query(); sparseInput.filters = { ...sparseInput.filters, limit: "200", priceFrom: "48", priceTo: "52" };
  const sparse = await run(sparseInput);
  assert.equal(sparse.count, 0); assert.equal(sparse.scanned, 1000); assert.equal(sparse.nextOffset, 1000);
  assert.deepEqual(pages, [0, 200, 400, 600, 800], "Range must propagate on all five batches without scanning onward to a known match");
  const resumed = await run({ ...sparseInput, offset: sparse.nextOffset });
  assert.equal(resumed.offers[0].id, "1001"); assert.equal(resumed.scanned, 1000); assert.equal(resumed.nextOffset, 2000);
  assert.deepEqual(pages.slice(5), [1000, 1200, 1400, 1600, 1800]);
  reset(); journal = Array.from({ length: 240 }, (_, i) => record(i + 51)); priceBounds = ["123.45", "123.45"];
  const filtered = query(); filtered.filters = { ...filtered.filters, limit: "200", priceFrom: "00123,45", priceTo: "123.45" };
  const large = await run(filtered);
  assert.equal(large.limit, 200); assert.equal(large.count, 200); assert.equal(large.offers[0].id, "51"); assert.equal(large.offers.at(-1).id, "250");
  assert.equal(large.scanned, 250); assert.equal(large.nextOffset, 250); assert.deepEqual(pages, [0, 200]);
  const continued = await run({ ...filtered, offset: large.nextOffset });
  assert.equal(continued.offers[0].id, "251"); assert.equal(continued.offers.at(-1).id, "290"); assert.equal(continued.nextOffset, null);
  reset(); total = 10000001; const tail = query("not_transferred", 9999801); tail.filters.limit = "200";
  const last200 = await run(tail); assert.equal(last200.count, 199); assert.equal(last200.nextOffset, null); assert.deepEqual(pages, [9999800]);
  reset(); stock = {
    "1": { state: "sending", stockMode: "separate", totalUnits: 3, completedUnits: 1, partIds: ["77"] },
    "2": { state: "uncertain", stockMode: "separate", totalUnits: 3, completedUnits: 2, partIds: ["78", "79"] },
    "3": { state: "transferred", stockMode: "shared", totalUnits: 1, completedUnits: 1, partIds: ["80"] },
    "4": { state: "transferred", stockMode: "separate", totalUnits: 2, completedUnits: 2, partIds: ["81", "82"] },
  };
  const grouped = await run({ operation: "statuses", offerIds: ["1", "2", "3", "4"] });
  for (const [id, row] of Object.entries(stock)) assert.deepEqual(grouped.statuses[id], { ...row, partId: row.partIds[0] });
  for (const stockMode of ["separate", "shared"]) {
    reset(); stock = { "1": { state: "sending", stockMode, totalUnits: stockMode === "shared" ? 1 : 3, completedUnits: 0, partIds: [], partId: null } };
    const pending = await run({ operation: "statuses", offerIds: ["1"] });
    assert.equal(pending.statuses["1"].partId, undefined); assert.ok(!Object.hasOwn(pending.statuses["1"], "partId"));
    assert.equal(pending.statuses["1"].stockMode, stockMode);
  }
  reset(); stock = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [String(i + 1), { state: "transferred", stockMode: "separate", totalUnits: 10000, completedUnits: 10000, partIds: Array.from({ length: 10000 }, (_, j) => String(i * 10000 + j + 1)) }]));
  const largeGroups = await run({ operation: "statuses", offerIds: Object.keys(stock) });
  assert.equal(largeGroups.statuses["200"].partIds.length, 10000, "Aggregate JSON cannot truncate nested unit lists at 1000");
  for (const invalid of [null, [], { "1": {} }, { "1": { state: "transferred", stockMode: "shared", totalUnits: 2, completedUnits: 2, partIds: ["1", "2"] } }, { "1": { state: "sending", stockMode: "separate", totalUnits: 2, completedUnits: 1, partIds: [] } }, { "1": { state: "transferred", stockMode: "separate", totalUnits: 2, completedUnits: 2, partIds: ["1", "1"] } }]) {
    reset(); stock = invalid; await run({ operation: "statuses", offerIds: ["1"] }, 502);
  }
  reset(); mode = "missing-stock-rpc"; await run({ operation: "statuses", offerIds: ["1"] }, 503);
  reset(); stock = { "1": { state: "transferred", stockMode: "shared", totalUnits: 1, completedUnits: 1, partIds: ["77"] } }; journal = [record(1)]; await run({ operation: "statuses", offerIds: ["1"] }, 409);
  reset(); for (let i = 0; i < 30; i++) await run({ operation: "statuses", offerIds: [] }); await run({ operation: "statuses", offerIds: [] }, 429);
  console.log("Ovoko transfer inventory: 200-row/status pages, inclusive 48..52 fixtures, single/invalid/reversed bounds, duplicate-shaped input and ID deduplication, five-batch range propagation, number-first search, cursors and read-only isolation passed. No live requests.");
} finally { globalThis.fetch = originalFetch; }
