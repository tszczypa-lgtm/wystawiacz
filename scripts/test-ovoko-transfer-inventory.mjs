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
const env = { SUPABASE_SERVICE_ROLE_KEY: "fixture", ALLEGRO_ENCRYPTION_KEY: Buffer.from(bytes).toString("base64") };
let user = 0, admin, mode, pages, journal, seller, target, total;
const owner = () => `00000000-0000-0000-0000-${String(user).padStart(12, "0")}`;
function reset() { user++; admin = true; mode = "ok"; pages = []; journal = []; seller = "555"; target = "fixture"; total = 900; }
const req = (input, origin = "https://inventory.test") => new Request("https://inventory.test/api/ovoko/transfer-inventory", { method: "POST", headers: { Authorization: "Bearer fixture", Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(input) });
const query = (transfer = "transferred", offset = 0) => ({ operation: "inventory", filters: { status: "ACTIVE", limit: "20", query: "ABS", searchBy: "name", sort: "stock.available" }, transfer, offset });
const record = (id, state = "created", partId = "77") => ({ allegro_offer_id: String(id), state, part_id: partId, seller: "555", target: "fixture" });
const originalFetch = globalThis.fetch;
globalThis.fetch = async (address, options = {}) => {
  const url = new URL(address), method = options.method || "GET";
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
    assert.equal(url.searchParams.get("allegro_seller_id"), `eq.${seller}`);
    assert.equal(url.searchParams.get("ovoko_account"), `eq.${await ovokoWriteDigest(target)}`);
    assert.equal(url.searchParams.get("limit"), "100");
    if (mode === "db-error") return new Response("private-db-error", { status: 503 });
    const ids = url.searchParams.get("allegro_offer_id").slice(4, -1).split(",");
    return Response.json(mode === "bad-journal" ? [{ allegro_offer_id: "9999", state: "created", part_id: "77" }] : journal.filter(row => row.seller === seller && row.target === target && ids.includes(row.allegro_offer_id)).map(({ seller, target, ...row }) => row));
  }
  assert.equal(url.origin, "https://api.allegro.pl");
  assert.equal(new Headers(options.headers).get("Authorization"), "Bearer seller-token");
  if (url.pathname === "/me") return Response.json({ id: seller, privateProfile: "must-not-leak" });
  assert.equal(url.pathname, "/sale/offers");
  const offset = Number(url.searchParams.get("offset")), limit = Number(url.searchParams.get("limit")); pages.push(offset);
  assert.equal(limit, 100); assert.ok(offset + limit <= 10000000);
  assert.equal(url.searchParams.get("name"), "ABS");
  assert.equal(url.searchParams.get("sort"), "stock.available");
  const count = mode === "empty-source" ? 0 : Math.min(limit, Math.max(0, total - offset));
  return Response.json({ totalCount: total, offers: Array.from({ length: count }, (_, i) => ({ id: String(offset + i + 1), name: "ABS", publication: { status: "ACTIVE" } })) });
};
async function run(input, status = 200) { const response = await handleOvokoApi(req(input), env); const body = await response.json(); assert.equal(response.status, status, JSON.stringify(body)); assert.ok(!JSON.stringify(body).includes("private-")); return body; }
try {
  reset(); admin = false; await run(query(), 403); assert.deepEqual(pages, []);
  reset(); assert.equal((await handleOvokoApi(req(query(), "https://evil.test"), env)).status, 403);
  for (const input of [{ ...query(), offset: -1 }, { ...query(), offset: 10000000 }, { ...query(), transfer: "queued" }, { ...query(), filters: { seller: "other" } }, { operation: "statuses", offerIds: ["../delete"] }, { operation: "statuses", offerIds: Array(101).fill("1") }, { ...query(), owner: "other" }]) { reset(); await run(input, 400); assert.deepEqual(pages, []); }
  reset(); mode = "disconnected"; await run(query(), 409);
  reset(); journal = [record(1), record(2, "sending"), record(3, "uncertain"), record(4, "created", null), { ...record(5), seller: "666" }, { ...record(6), target: "other" }];
  const states = await run({ operation: "statuses", offerIds: ["1", "2", "3", "4", "5", "6"] });
  assert.deepEqual(states.statuses, { "1": { state: "transferred", partId: "77" }, "2": { state: "sending" }, "3": { state: "uncertain" }, "4": { state: "uncertain" }, "5": { state: "not_transferred" }, "6": { state: "not_transferred" } });
  seller = "666"; const otherSeller = await run({ operation: "statuses", offerIds: ["1", "5"] }); assert.equal(otherSeller.statuses["1"].state, "not_transferred"); assert.equal(otherSeller.statuses["5"].state, "transferred");
  reset(); mode = "db-error"; await run({ operation: "statuses", offerIds: ["1"] }, 503);
  reset(); mode = "bad-journal"; await run({ operation: "statuses", offerIds: ["1"] }, 502);
  reset(); journal = Array.from({ length: 40 }, (_, i) => record(151 + i));
  const first = await run(query()); assert.equal(first.offers.length, 20); assert.equal(first.offers[0].id, "151"); assert.equal(first.nextOffset, 170); assert.equal(first.scanned, 170); assert.equal(first.totalCount, 900); assert.deepEqual(pages, [0, 100]);
  const second = await run(query("transferred", first.nextOffset)); assert.equal(second.offers[0].id, "171"); assert.equal(second.offers.at(-1).id, "190"); assert.equal(second.nextOffset, 190);
  reset(); const empty = await run(query()); assert.deepEqual(empty.offers, []); assert.equal(empty.nextOffset, 500); assert.equal(empty.scanned, 500); assert.equal(pages.length, 5);
  reset(); total = 0; const none = await run(query()); assert.equal(none.nextOffset, null);
  reset(); mode = "empty-source"; await run(query(), 502);
  reset(); total = 10000001; const end = await run(query("not_transferred", 9999995)); assert.equal(end.offers.length, 5); assert.equal(end.nextOffset, null); assert.deepEqual(pages, [9999900]);
  reset(); for (let i = 0; i < 30; i++) await run({ operation: "statuses", offerIds: [] }); await run({ operation: "statuses", offerIds: [] }, 429);
  console.log("Ovoko transfer inventory: authentication, admin/CSRF, target/seller isolation, strict inputs, journal states/errors, bounded global scan, cursor continuation, cap and read-only network passed. No live requests.");
} finally { globalThis.fetch = originalFetch; }
