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
const originalFetch = globalThis.fetch;
let admin = true, suspended = false, user = 1, mode = "ok";
const calls = [], dbCalls = [];
const owner = () => `00000000-0000-0000-0000-${String(user).padStart(12, "0")}`;
const env = { SUPABASE_SERVICE_ROLE_KEY: "db-fixture" };
const credentials = { username: "fixture-user", password: "private-password&+", user_token: "private-token" };
const req = (pathname = "/test", options = {}) => new Request(`https://ovoko.test/api/ovoko${pathname}`, { method: "POST", headers: { Authorization: "Bearer fixture", Origin: "https://ovoko.test", "Content-Type": "application/json", ...options.headers }, body: JSON.stringify(options.body ?? credentials), ...options.init });
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(input);
  if (url.pathname === "/auth/v1/user") return Response.json({ id: owner(), email_confirmed_at: new Date().toISOString() });
  if (url.pathname.includes("customer_accounts")) { dbCalls.push(options.method || "GET"); return Response.json([{ owner_id: owner(), suspended, company: {} }]); }
  if (url.pathname.includes("account_admins")) return Response.json(admin ? [{ owner_id: owner() }] : []);
  assert.equal(url.href, "https://api.rrr.lt/get/car_brands", "Only the fixed dictionary read is permitted");
  calls.push({ url, options });
  assert.equal(options.method, "POST"); assert.equal(options.redirect, "error");
  const form = new URLSearchParams(options.body);
  assert.deepEqual(Object.fromEntries(form), credentials, "Special characters and password are preserved in form encoding");
  if (mode === "timeout") throw new DOMException("private-password&+", "TimeoutError");
  if (mode === "network") throw new TypeError("private-password&+");
  if (mode === "http") return new Response("private-token", { status: 503 });
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
  for (const failure of ["R001", "R002", "R003", "R008", "R012", "R013", "R202", "R500", "invalid", "missing", "html", "http", "large", "timeout", "network"]) {
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
  assert.ok(readFileSync(path.join(root, "build/sites-worker.ts"), "utf8").includes('pathname.startsWith("/api/ovoko/")'));
  console.log("Ovoko: admin/suspension/kill-switch guards, CSRF, bounded bodies, form encoding, fixed read-only endpoint, R200 validation, IP/auth errors, timeout, rate limit and secret redaction passed. All network calls mocked.");
} finally { globalThis.fetch = originalFetch; }
