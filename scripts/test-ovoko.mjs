import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { readCases } from "./ovoko-read-fixtures.mjs";

const root = fileURLToPath(new URL("../", import.meta.url)), native = createRequire(import.meta.url), cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  const source = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  new Function("require", "module", "exports", source)(name => name.startsWith(".") ? load(path.resolve(path.dirname(file), name + ".ts")) : native(name), module, module.exports);
  return module.exports;
}
const { handleOvokoApi } = load(path.join(root, "lib/ovoko-api.ts"));
const originalFetch = globalThis.fetch;
let admin = true, suspended = false, user = 1, mode = "ok";
let expectedPath = "/get/car_brands", fixtureResult = null;
const calls = [], dbCalls = [];
const savedConnections = new Map();
let failStorage = false;
const owner = () => `00000000-0000-0000-0000-${String(user).padStart(12, "0")}`;
const env = { SUPABASE_SERVICE_ROLE_KEY: "db-fixture" };
const credentials = { username: "fixture-user", password: "private-password&+", user_token: "private-token" };
const req = (pathname = "/test", options = {}) => new Request(`https://ovoko.test/api/ovoko${pathname}`, { method: "POST", headers: { Authorization: "Bearer fixture", Origin: "https://ovoko.test", "Content-Type": "application/json", ...options.headers }, body: JSON.stringify(options.body ?? credentials), ...options.init });
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(input);
  if (url.pathname === "/auth/v1/user") return Response.json({ id: owner(), email_confirmed_at: new Date().toISOString() });
  if (url.pathname.includes("customer_accounts")) { dbCalls.push(options.method || "GET"); return Response.json([{ owner_id: owner(), suspended, company: {} }]); }
  if (url.pathname.includes("account_admins")) return Response.json(admin ? [{ owner_id: owner() }] : []);
  if (url.pathname === "/rest/v1/ovoko_connections") {
    if (failStorage) return new Response("private-storage-error", { status: 503 });
    const method = options.method || "GET";
    if (method === "POST") {
      const row = JSON.parse(options.body); assert.equal(row.owner_id, owner());
      assert.ok(!options.body.includes("private-")); assert.ok(!options.body.includes(credentials.username));
      assert.deepEqual(Object.keys(row).sort(), ["owner_id", "sealed", "updated_at", "verified_at"]);
      savedConnections.set(owner(), row); return new Response(null, { status: 204 });
    }
    assert.equal(url.searchParams.get("owner_id"), `eq.${owner()}`, "All reads/deletes scoped to authenticated owner, not request input");
    if (method === "DELETE") { savedConnections.delete(owner()); return new Response(null, { status: 204 }); }
    assert.equal(method, "GET");
    const row = savedConnections.get(owner()), select = url.searchParams.get("select");
    return Response.json(row ? [{ [select]: row[select] }] : []);
  }
  assert.equal(url.href, `https://api.rrr.lt${expectedPath}`, "Only the selected allowlisted read is permitted");
  calls.push({ url, options });
  assert.equal(options.method, "POST"); assert.equal(options.redirect, "manual");
  const form = new URLSearchParams(options.body);
  assert.deepEqual(Object.fromEntries(form), credentials, "Special characters and password are preserved in form encoding");
  if (fixtureResult) return Response.json({ status_code: "R200", ...fixtureResult, password: credentials.password });
  if (mode === "timeout") throw new DOMException("private-password&+", "TimeoutError");
  if (mode === "network") throw new TypeError("private-password&+");
  if (mode === "http") return new Response("private-token", { status: 503 });
  if (mode.startsWith("redirect")) return new Response("private-token", { status: Number(mode.slice(8)), headers: { Location: "https://evil.test/private-token" } });
  if (mode === "html") return new Response("private-token<html>");
  if (mode === "large") return new Response("x".repeat(512001));
  if (mode === "invalid") return Response.json({ status_code: "R200", list: [{ id: "1", name: null }] });
  if (mode === "missing") return Response.json({ status_code: "R200" });
  if (mode.startsWith("R")) return Response.json({ status_code: mode, msg: "private-token", password: credentials.password });
  return Response.json({ status_code: "R200", list: [{ id: "120", name: "AC" }, { id: 121, name: "Audi" }], username: "private-token", password: credentials.password });
};
try {
  assert.equal((await handleOvokoApi(new Request("https://ovoko.test/api/ovoko/status"), env)).status, 401);
  admin = false; assert.equal((await handleOvokoApi(req(), env)).status, 403); admin = true;
  suspended = true; assert.equal((await handleOvokoApi(req(), env)).status, 403); suspended = false;
  assert.equal((await handleOvokoApi(req(), { ...env, OVOKO_TEST_ENABLED: "false" })).status, 403);
  assert.equal((await handleOvokoApi(req("/crm/deletePart"), env)).status, 404);
  assert.equal((await handleOvokoApi(req("/test", { init: { method: "GET", body: undefined } }), env)).status, 405);
  assert.equal((await handleOvokoApi(req("/test", { headers: { Origin: "https://evil.test" } }), env)).status, 403);
  assert.equal((await handleOvokoApi(req("/test", { headers: { "Content-Type": "text/plain" } }), env)).status, 415);
  assert.equal((await handleOvokoApi(req("/test", { body: { ...credentials, user_token: "" } }), env)).status, 400);
  assert.equal((await handleOvokoApi(req("/test", { body: { ...credentials, password: "x".repeat(9000) } }), env)).status, 413);
  const status = await handleOvokoApi(req("/status", { init: { method: "GET", body: undefined } }), env);
  assert.equal((await status.json()).credentialsStored, false);
  assert.equal(calls.length, 0, "No upstream calls before a valid authorized explicit test");
  const good = await handleOvokoApi(req(), env); assert.equal(good.status, 200);
  const data = await good.json();
  assert.deepEqual(data.brands, [{ id: "120", name: "AC" }, { id: "121", name: "Audi" }]);
  assert.equal(data.readOnly, true); assert.equal(data.credentialsStored, false);
  assert.ok(!JSON.stringify(data).includes("private-"));
  for (const failure of ["R001", "R002", "R003", "R008", "R012", "R013", "R202", "R500", "invalid", "missing", "html", "http", "large", "timeout", "network", "redirect301", "redirect302", "redirect303", "redirect307", "redirect308"]) {
    user++; mode = failure;
    const response = await handleOvokoApi(req(), env);
    assert.ok(response.status >= 400, `${failure} is not a false successful connection`);
    const body = await response.text(); assert.ok(!body.includes("private-"), "No raw provider errors or credentials reflected");
    if (failure === "R013") assert.match(body, /adres IP/);
  }
  mode = "ok"; user++;
  for (let i = 0; i < 3; i++) assert.equal((await handleOvokoApi(req(), env)).status, 200);
  const before = calls.length; assert.equal((await handleOvokoApi(req(), env)).status, 429); assert.equal(calls.length, before);
  assert.ok(dbCalls.every(method => method === "GET"), "Credentials and listings are never written to the database");
  for (const fixture of readCases) {
    user++; expectedPath = fixture.path; fixtureResult = fixture.result;
    const before = calls.length;
    const response = await handleOvokoApi(req("/read", { body: { ...credentials, operation: fixture.operation, ...(fixture.brandId ? { brandId: fixture.brandId } : {}), ...(fixture.modelId ? { modelId: fixture.modelId } : {}), url: "https://evil.test", page: 999, limit: 100 } }), env);
    assert.equal(response.status, 200, fixture.operation);
    const body = await response.json();
    assert.deepEqual(body.rows, fixture.rows); assert.equal(body.operation, fixture.operation);
    assert.ok(!JSON.stringify(body).includes("private-"));
    assert.equal(calls.length, before + 1, "Only one read per explicit request, no auto-pagination");
    if (fixture.operation === "parts") assert.deepEqual(body.pagination, { page: 1, limit: 20, total: 1 });
  }
  for (const body of [{ operation: "deletePart" }, { operation: "https://evil.test" }, { operation: "models", brandId: "../crm/deletePart" }, { operation: "models", brandId: 120 }, { operation: "models", brandId: "" }]) {
    user++; const before = calls.length;
    assert.equal((await handleOvokoApi(req("/read", { body: { ...credentials, ...body } }), env)).status, 400);
    assert.equal(calls.length, before);
  }
  user++;
  const dictionaryFixture = readCases.find(item => item.operation === "categories");
  expectedPath = dictionaryFixture.path; fixtureResult = dictionaryFixture.result;
  for (let i = 0; i < 12; i++) assert.equal((await handleOvokoApi(req("/read", { body: { ...credentials, operation: "categories" } }), env)).status, 200);
  const beforeDictionaryLimit = calls.length;
  assert.equal((await handleOvokoApi(req("/read", { body: { ...credentials, operation: "categories" } }), env)).status, 429);
  assert.equal(calls.length, beforeDictionaryLimit, "Automatic dictionary initialization retains a bounded upstream budget");
  const partsFixture = readCases.find(item => item.operation === "parts");
  expectedPath = partsFixture.path; fixtureResult = partsFixture.result;
  for (let i = 0; i < 3; i++) assert.equal((await handleOvokoApi(req("/read", { body: { ...credentials, operation: "parts" } }), env)).status, 200);
  assert.equal((await handleOvokoApi(req("/read", { body: { ...credentials, operation: "parts" } }), env)).status, 429, "Inventory still allows only three reads per minute");
  admin = false; assert.equal((await handleOvokoApi(req("/read"), env)).status, 403); admin = true;
  for (const modelId of ["", "0", "../crm/importCar", 9]) {
    user++; const before = calls.length;
    assert.equal((await handleOvokoApi(req("/read", { body: { ...credentials, operation: "cars", modelId } }), env)).status, 400);
    assert.equal(calls.length, before, "Invalid vehicle filters never reach Ovoko");
  }
  user++; const carsFixture = readCases.find(item => item.operation === "cars");
  expectedPath = carsFixture.path; fixtureResult = carsFixture.result;
  for (let i = 0; i < 6; i++) assert.equal((await handleOvokoApi(req("/read", { body: { ...credentials, operation: "cars", modelId: "9" } }), env)).status, 200);
  assert.equal((await handleOvokoApi(req("/read", { body: { ...credentials, operation: "cars", modelId: "9" } }), env)).status, 429, "Vehicle picker has its own bounded read budget");
  const { parseOvokoRead } = load(path.join(root, "lib/ovoko-read.ts"));
  assert.deepEqual(parseOvokoRead("cars", { data: [], pagination: { page: 1, limit: 20, total_count: 0 } }, "9"), { rows: [], pagination: { page: 1, limit: 20, total: 0 } });
  assert.throws(() => parseOvokoRead("cars", { data: [{ id: "36", car_model: "10", car_years: "2013" }], pagination: { page: 1, limit: 20, total_count: 1 } }, "9"), /Nieprawidlowy/, "Cars from another model are never offered as a selection");
  assert.deepEqual(parseOvokoRead("parts", { data: [], pagination: { page: 1, limit: 20, total_count: 0 } }), { rows: [], pagination: { page: 1, limit: 20, total: 0 } });
  for (const [operation, result] of [
    ["statuses", { list: [] }], ["statuses", { list: { unknown: { en: "Bad" } } }],
    ["qualities", { list: { "0": null } }], ["categories", { list: [{ id: "1", parent_id: "0", level: "4", pl: "Bad" }] }],
    ["models", readCases[0].result], ["categories", { list: [] }],
    ["parts", { ...readCases[4].result, pagination: { pagination: { page: 1, limit: 20, total_count: 1 } } }],
    ["parts", { data: [], pagination: { page: 1, limit: 20, total_count: 99 } }],
    ["parts", { ...readCases[4].result, data: Array(21).fill(readCases[4].result.data[0]) }],
    ["parts", { ...readCases[4].result, data: [{ ...readCases[4].result.data[0], price: "NaN" }] }],
    ["parts", { ...readCases[4].result, data: [{ ...readCases[4].result.data[0], id: {} }] }],
  ]) assert.throws(() => parseOvokoRead(operation, result, "wrong-brand"), /format danych/);
  user++; expectedPath = readCases[4].path; fixtureResult = { data: [], pagination: { page: 1, limit: 20, total_count: 9 } };
  assert.equal((await handleOvokoApi(req("/read", { body: { ...credentials, operation: "parts" } }), env)).status, 502, "Malformed data never returns a successful preview");
  const secureEnv = { ...env, ALLEGRO_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") };
  user++; mode = "ok"; expectedPath = "/get/car_brands"; fixtureResult = null;
  const statusRequest = () => req("/status", { init: { method: "GET", body: undefined } });
  assert.equal((await (await handleOvokoApi(statusRequest(), secureEnv)).json()).connected, false);
  assert.equal((await handleOvokoApi(req("/connect"), env)).status, 503, "No unencrypted fallback");
  let response = await handleOvokoApi(req("/connect"), secureEnv); assert.equal(response.status, 200);
  let payload = await response.text(); assert.ok(!payload.includes("private-") && !payload.includes(credentials.username));
  const firstOwner = user, original = savedConnections.get(owner()), originalCipher = original.sealed;
  assert.equal((await (await handleOvokoApi(statusRequest(), secureEnv)).json()).connected, true);
  response = await handleOvokoApi(req("/test", { body: { useSaved: true, owner_id: "someone-else" } }), secureEnv);
  assert.equal(response.status, 200); assert.equal((await response.json()).credentialsStored, true);
  mode = "R012";
  assert.equal((await handleOvokoApi(req("/connect"), secureEnv)).status, 502);
  assert.equal(savedConnections.get(owner()).sealed, originalCipher, "Failed verification cannot replace working connection");
  user++; mode = "ok";
  const beforeSaved = calls.length;
  assert.equal((await handleOvokoApi(req("/test", { body: { useSaved: true } }), secureEnv)).status, 409, "Another owner cannot use existing secrets");
  savedConnections.set(owner(), { ...original, owner_id: owner() });
  response = await handleOvokoApi(req("/test", { body: { useSaved: true } }), secureEnv); assert.equal(response.status, 503, "Ciphertext is bound to owner by AES-GCM AAD");
  assert.equal(calls.length, beforeSaved);
  await handleOvokoApi(req("/disconnect", { body: {} }), secureEnv);
  assert.ok(savedConnections.has(`00000000-0000-0000-0000-${String(firstOwner).padStart(12, "0")}`), "Disconnect does not delete another owner's connection");
  user = firstOwner;
  const beforeDisconnect = calls.length;
  assert.equal((await handleOvokoApi(req("/disconnect", { body: {}, headers: { Origin: "https://evil.test" } }), secureEnv)).status, 403);
  admin = false; assert.equal((await handleOvokoApi(req("/disconnect", { body: {} }), secureEnv)).status, 403); admin = true;
  original.sealed = originalCipher.slice(0, -8) + "AAAAAAAA";
  assert.equal((await handleOvokoApi(req("/test", { body: { useSaved: true } }), secureEnv)).status, 503, "Tampering fails closed");
  assert.equal((await handleOvokoApi(req("/test", { body: { useSaved: true, ...credentials } }), secureEnv)).status, 400);
  failStorage = true;
  response = await handleOvokoApi(statusRequest(), secureEnv); assert.equal(response.status, 503); assert.ok(!(await response.text()).includes("private-"));
  failStorage = false;
  assert.equal((await handleOvokoApi(req("/disconnect", { body: {} }), secureEnv)).status, 200);
  assert.equal((await (await handleOvokoApi(statusRequest(), secureEnv)).json()).connected, false);
  assert.equal(calls.length, beforeDisconnect, "Disconnect and invalid ciphertext never call Ovoko");
  const migration = readFileSync(path.join(root, "supabase/011_ovoko_connections.sql"), "utf8");
  assert.match(migration, /enable row level security/); assert.match(migration, /revoke all.*public, anon, authenticated/);
  assert.match(migration, /grant select, insert, update, delete.*service_role/);
  assert.ok(readFileSync(path.join(root, "build/sites-worker.ts"), "utf8").includes('pathname.startsWith("/api/ovoko/")'));
  console.log("Ovoko: guards, CSRF, bounds, redirects, auth errors, rate limit, read-only allowlist, five read contracts, empty inventory, invalid schemas, single page and field redaction passed. All network calls mocked.");
} finally { globalThis.fetch = originalFetch; }
