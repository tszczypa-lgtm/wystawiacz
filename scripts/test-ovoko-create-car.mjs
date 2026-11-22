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
const bytes = new Uint8Array(32).fill(7), key = await crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
const env = { SUPABASE_SERVICE_ROLE_KEY: "fixture", ALLEGRO_ENCRYPTION_KEY: Buffer.from(bytes).toString("base64"), OVOKO_PUBLISH_ENABLED: "true" };
let user = 0, admin, mode, failDb, mutations, remoteCalls, prior, revoked;
const rows = new Map(), owner = () => `00000000-0000-0000-0000-${String(user).padStart(12, "0")}`;
const credentials = { username: "fixture", password: "private-password", user_token: "private-token" };
const payload = () => ({ brandId: "1", modelId: "164", year: "2009", confirmCreate: true });
const req = (body = payload(), headers = {}) => new Request("https://cars.test/api/ovoko/create-car", { method: "POST", headers: { Authorization: "Bearer fixture", Origin: "https://cars.test", "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
function reset() { user++; admin = true; mode = "ok"; failDb = ""; mutations = 0; remoteCalls = 0; prior = false; revoked = false; rows.clear(); }
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(input), method = options.method || "GET";
  if (url.pathname === "/auth/v1/user") return Response.json({ id: owner(), email_confirmed_at: "2026-01-01" });
  if (url.pathname === "/rest/v1/customer_accounts") return Response.json([{ owner_id: owner(), company: {}, suspended: false }]);
  if (url.pathname === "/rest/v1/account_admins") return Response.json(admin ? [{ owner_id: owner() }] : []);
  if (url.pathname === "/rest/v1/ovoko_connections") return Response.json([{ sealed: await sealConnection(credentials, key, `ovoko:v1:${owner()}`) }]);
  if (url.pathname === "/rest/v1/ovoko_vehicle_creations") {
    if (failDb === method) return new Response("private-db-error", { status: 503 });
    if (method === "POST") {
      const row = JSON.parse(options.body); assert.equal(row.owner_id, owner()); assert.equal(row.model_id, "164"); assert.equal(row.vehicle_year, "2009");
      assert.equal(new Headers(options.headers).get("Prefer"), "resolution=ignore-duplicates,return=representation");
      assert.ok(!options.body.includes("private-"));
      const id = `${row.ovoko_account}:${row.model_id}:${row.vehicle_year}`;
      if (rows.has(id)) return Response.json([]);
      rows.set(id, row); return Response.json([row], { status: 201 });
    }
    assert.equal(url.searchParams.get("owner_id"), `eq.${owner()}`);
    const id = ["ovoko_account", "model_id", "vehicle_year"].map(key => url.searchParams.get(key)?.slice(3)).join(":"), row = rows.get(id);
    if (method === "GET") return Response.json(row?.owner_id === owner() ? [row] : []);
    assert.equal(method, "PATCH");
    if (!row || row.owner_id !== owner() || (url.searchParams.has("state") && url.searchParams.get("state") !== `eq.${row.state}`)) return Response.json([]);
    Object.assign(row, JSON.parse(options.body)); return Response.json([row]);
  }
  assert.equal(url.origin, "https://api.rrr.lt"); remoteCalls++; assert.equal(method, "POST"); assert.equal(options.redirect, "manual");
  const form = new URLSearchParams(options.body);
  for (const [name, value] of Object.entries(credentials)) assert.equal(form.get(name), value);
  if (url.pathname === "/get/cars") {
    assert.ok(mode.startsWith("legacy-"));
    return Response.json({ status_code: "R200", list: mode === "legacy-bad" ? null : mode === "legacy-saved" ? [{ id: "88", car_model: "164", car_years: "2009" }] : [] });
  }
  if (url.pathname === "/get/car_models/1") return Response.json({ status_code: mode === "bad-metadata" ? "R404" : "R200", list: [{ id: "164", brand: "1", name: "M-Class (W164)", year_start: "2005", year_end: "2011" }] });
  if (url.pathname === "/v2/get/cars") {
    if (mode.startsWith("legacy-")) return Response.json({ status_code: "R200", data: [] });
    if (mode === "no-cars") return Response.json({ status_code: "R004", msg: "No cars found" });
    if (url.searchParams.has("model_ids")) {
      assert.equal(url.searchParams.get("model_ids"), "164");
      const data = mode === "saved-car" ? [{ id: 88, car_model: 164, car_years: 2008 }] : mode === "wrong-car" ? [{ id: "89", car_model: "163", car_years: "2009" }] : [];
      return Response.json({ status_code: "R200", data, pagination: { page: 1, limit: 20, total_count: data.length } });
    }
    assert.equal(url.searchParams.get("external_ids"), "tymo:car:164:2009");
    return Response.json({ status_code: "R200", data: prior ? [{ id: "77", car_model: "164", car_years: "2009" }] : [], pagination: { page: "1", limit: "1", total_count: prior ? "1" : "0" } });
  }
  if (url.pathname === "/get/car_status") {
    if (revoked) admin = false;
    return Response.json({ status_code: "R200", list: mode === "missing-status" ? { "1": { pl: "Kupiony" } } : { "1": { pl: "Kupiony" }, "6": { pl: "Dodano" } } });
  }
  assert.equal(url.pathname, "/crm/importCar", "The only mutation creates one vehicle; no part, purchase, warehouse, update or delete operations");
  assert.equal(rows.size, 1); assert.equal([...rows.values()][0].state, "sending"); mutations++;
  assert.deepEqual([...form.keys()].sort(), ["username", "password", "user_token", "car_model", "car_years", "status", "external_id"].sort());
  assert.equal(form.get("car_model"), "164"); assert.equal(form.get("car_years"), "2009"); assert.equal(form.get("status"), "6", "Use Added, never invent Purchased/Disassembled");
  if (mode === "timeout") throw new DOMException("private-error", "TimeoutError");
  if (mode === "redirect") return new Response("private-error", { status: 302, headers: { Location: "https://evil.test" } });
  if (mode === "reject") return Response.json({ status_code: "R400", msg: "private-error" });
  if (mode === "missing-id") return Response.json({ status_code: "R200" });
  return Response.json({ status_code: "R200", car_id: 77 });
};
try {
  reset(); admin = false; assert.equal((await handleOvokoApi(req(), env)).status, 403); assert.equal(remoteCalls, 0);
  reset(); assert.equal((await handleOvokoApi(req(payload(), { Origin: "https://evil.test" }), env)).status, 403); assert.equal(remoteCalls, 0);
  reset(); assert.equal((await handleOvokoApi(req(), { ...env, OVOKO_PUBLISH_ENABLED: "false" })).status, 503); assert.equal(mutations, 0);
  for (const patch of [{ year: "" }, { year: "1800" }, { year: "9999" }, { modelId: "../crm/deleteCar" }, { confirmCreate: false }, { car_body_number: "invented-vin" }]) {
    reset(); assert.equal((await handleOvokoApi(req({ ...payload(), ...patch }), env)).status, 400); assert.equal(mutations, 0);
  }
  reset(); assert.equal((await handleOvokoApi(req({ ...payload(), year: "2020" }), env)).status, 400); assert.equal(mutations, 0);
  reset(); revoked = true; assert.equal((await handleOvokoApi(req(), env)).status, 403); assert.equal(mutations, 0);
  reset(); mode = "missing-status"; assert.equal((await handleOvokoApi(req(), env)).status, 400); assert.equal(mutations, 0);
  reset(); mode = "bad-metadata"; assert.equal((await handleOvokoApi(req(), env)).status, 502); assert.equal(mutations, 0);
  for (const method of ["GET", "POST"]) { reset(); failDb = method; assert.equal((await handleOvokoApi(req(), env)).status, 503); assert.equal(mutations, 0); }
  reset(); prior = true; const reused = await handleOvokoApi(req(), env); assert.equal(reused.status, 200); assert.equal((await reused.json()).reused, true); assert.equal(mutations, 0);
  reset(); mode = "saved-car"; const manual = await handleOvokoApi(req(), env); assert.equal(manual.status, 200); assert.equal((await manual.json()).carId, "88"); assert.equal(mutations, 0, "Reuse manually added same-model car, even with a different year, never create another");
  reset(); mode = "wrong-car"; assert.equal((await handleOvokoApi(req(), env)).status, 502); assert.equal(mutations, 0, "Untrusted model-filter response blocks creation");
  reset(); mode = "no-cars"; assert.equal((await handleOvokoApi(req(), env)).status, 200); assert.equal(mutations, 1, "Documented R004 empty lookup allows one guarded creation, never a retry");
  reset(); mode = "legacy-empty"; const legacyCreated = await handleOvokoApi(req(), env); assert.equal(legacyCreated.status, 200, await legacyCreated.clone().text()); assert.equal(mutations, 1, "Missing V2 pagination is recovered by the complete legacy export before creating");
  reset(); mode = "legacy-saved"; const legacyReused = await handleOvokoApi(req(), env); assert.equal(legacyReused.status, 200); assert.equal((await legacyReused.json()).carId, "88"); assert.equal(mutations, 0, "Fallback finds an existing vehicle instead of creating a duplicate");
  reset(); mode = "legacy-bad"; assert.equal((await handleOvokoApi(req(), env)).status, 502); assert.equal(mutations, 0, "A broken fallback never means empty stock");
  reset(); const good = await handleOvokoApi(req(), env); assert.equal(good.status, 200, await good.clone().text()); assert.equal((await good.json()).carId, "77"); assert.equal(mutations, 1);
  const replay = await handleOvokoApi(req(), env); assert.equal(replay.status, 200); assert.equal((await replay.json()).reused, true); assert.equal(mutations, 1);
  user++; assert.equal((await handleOvokoApi(req(), env)).status, 409); assert.equal(mutations, 1, "Another owner cannot bypass a lock on the same Ovoko account/model/year");
  reset(); const concurrent = await Promise.all([handleOvokoApi(req(), env), handleOvokoApi(req(), env)]); assert.equal(mutations, 1); assert.ok(concurrent.some(response => response.status === 200));
  for (const failure of ["timeout", "redirect", "reject", "missing-id", "log-failure"]) {
    reset(); mode = failure; if (failure === "log-failure") failDb = "PATCH";
    const response = await handleOvokoApi(req(), env); assert.equal(response.status, 409); assert.ok(!(await response.text()).includes("private-")); assert.equal(mutations, 1);
    assert.equal((await handleOvokoApi(req(), env)).status, 409); assert.equal(mutations, 1, "Uncertain vehicle creation is never retried");
  }
  console.log("Ovoko vehicle creation: explicit confirmation, model/year validation, Added status, no invented attributes, RLS-backed reservation, replay/concurrency, existing record reuse and uncertain no-retry passed. All services mocked; no live records created.");
} finally { globalThis.fetch = originalFetch; }
