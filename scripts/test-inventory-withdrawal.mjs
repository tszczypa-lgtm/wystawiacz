import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
function load(name, require = () => { throw new Error("dependency"); }) {
  const source = ts.transpileModule(readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} }; new Function("require", "module", "exports", source)(require, module, module.exports); return module.exports;
}
const read = load("ovoko-read");
let jobs, writes, a, o, mode, seller, generation, credentials;
const hash = "a".repeat(64), owner = "owner";
function reset() { jobs = new Map(); writes = []; a = "ACTIVE"; o = "0"; mode = "ok"; seller = "555"; generation = hash; credentials = { username: "fixture", password: "private", user_token: "private" }; }
const db = async (path, options = {}) => {
  const url = new URL(`https://db.test/${path}`), table = url.pathname.slice(1), method = options.method || "GET";
  if (table === "ovoko_connections") { assert.equal(method, "GET"); return [{ sealed: "fixture" }]; }
  if (table === "ovoko_single_publications") { assert.equal(method, "GET"); assert.equal(url.searchParams.get("owner_id"), "eq.owner"); assert.equal(url.searchParams.get("allegro_seller_id"), `eq.${seller}`); return [{ state: "created", part_id: "20", request_hash: generation }]; }
  assert.equal(table, "inventory_withdrawals");
  if (mode === "db-error") throw new Error("private-db");
  if (method === "POST") { const row = JSON.parse(options.body); assert.doesNotMatch(options.body, /private/); jobs.set(row.id, row); return [row]; }
  const row = jobs.get(url.searchParams.get("id")?.slice(3));
  if (!row || row.owner_id !== url.searchParams.get("owner_id")?.slice(3)) return [];
  if (method === "GET") return [{ ...row }];
  assert.equal(method, "PATCH");
  if (row.state !== url.searchParams.get("state")?.slice(3)) return [];
  const patch = JSON.parse(options.body); Object.assign(row, patch);
  return mode === "claim-empty" && patch.state === "running" ? [] : [{ ...row }];
};
const allegro = async (path, options = {}) => {
  if (path === "/me") return { id: seller };
  if (path === "/sale/offers?offer.id=10&limit=1") return { offers: mode === "foreign" ? [] : [{ id: "10", publication: { status: a } }] };
  assert.match(path, /^\/sale\/offer-publication-commands\/[a-f0-9-]{36}$/); assert.equal(options.method, "PUT");
  assert.deepEqual(JSON.parse(options.body), { publication: { action: "END" }, offerCriteria: [{ offers: [{ id: "10" }], type: "CONTAINS_OFFERS" }] });
  assert.equal([...jobs.values()].at(-1).state, "running"); writes.push("allegro"); a = "ENDED";
  if (mode === "rotate-midway") generation = "c".repeat(64);
  if (mode === "sold-midway") o = "2";
  if (mode === "a-timeout") throw new Error("private-timeout");
  return { id: path.split("/").at(-1) };
};
const ovoko = async (path, form) => {
  if (path === "/get/part_status") return { status_code: "R200", list: { "0": { pl: "Na stanie" }, "4": { pl: "Wycofany" }, "2": { pl: "Sprzedano" } } };
  if (path.startsWith("/v2/get/parts?")) return { status_code: "R200", data: [{ id: "20", status: o, external_id: mode === "wrong-link" ? "tymo:666:10" : "tymo:555:10" }], pagination: { page: 1, limit: 2, total_count: 1 } };
  assert.equal(path, "/crm/changePartStatus", "Never delete a part, photos, a car or a warehouse");
  assert.equal(form.get("part_id"), "20"); assert.equal(form.get("status"), "4");
  assert.equal([...jobs.values()].at(-1).state, "running"); writes.push("ovoko"); o = "4";
  if (mode === "o-timeout") throw new Error("private-timeout");
  return { status_code: "R200" };
};
const { manageWithdrawal: manage } = load("inventory-withdrawal", name => {
  if (name === "./allegro-api") return { openConnection: async () => credentials };
  if (name === "./ovoko-connection") return { ovokoConnectionKey: async () => ({}), validateOvokoCredentials: value => value };
  if (name === "./ovoko-write-client") return { ovokoWriteClient: () => ovoko, ovokoWriteDigest: async value => value.includes("changed") ? "b".repeat(64) : hash };
  if (name === "./ovoko-read") return read;
  throw new Error(name);
});
const env = { INVENTORY_WITHDRAW_ENABLED: "true" };
const call = input => manage(input, owner, env, db, allegro);
const prepare = scope => call({ operation: "prepare", offerId: "10", ...(scope !== "allegro" ? { partId: "20" } : {}), scope });
for (const scope of ["allegro", "ovoko", "both"]) {
  reset(); const plan = await prepare(scope); assert.equal(writes.length, 0, "Preparing never changes provider data");
  await assert.rejects(call({ operation: "execute", jobId: plan.id }), /Potwierdz/); assert.equal(writes.length, 0);
  const result = await call({ operation: "execute", jobId: plan.id, confirm: true }); assert.equal(result.state, "settled");
  assert.deepEqual(writes, scope === "both" ? ["allegro", "ovoko"] : [scope]);
  assert.equal(result.allegro, scope === "ovoko" ? "not_requested" : "submitted");
  await call({ operation: "execute", jobId: plan.id, confirm: true }); assert.equal(writes.length, scope === "both" ? 2 : 1, "Second click never repeats writes");
  const checked = await call({ operation: "status", jobId: plan.id });
  assert.equal(checked.allegro, scope === "ovoko" ? "not_requested" : "done"); assert.equal(checked.ovoko, scope === "allegro" ? "not_requested" : "done");
}
for (const failure of ["a-timeout", "o-timeout"]) {
  reset(); const plan = await prepare("both"); mode = failure;
  const result = await call({ operation: "execute", jobId: plan.id, confirm: true });
  assert.equal(result[failure.startsWith("a") ? "allegro" : "ovoko"], "uncertain"); assert.equal(writes.length, 2, "Independent target still proceeds after a provider failure");
  await call({ operation: "execute", jobId: plan.id, confirm: true }); assert.equal(writes.length, 2);
  const checked = await call({ operation: "status", jobId: plan.id }); assert.equal(checked.allegro, "done"); assert.equal(checked.ovoko, "done"); assert.equal(writes.length, 2, "Readback resolves timeouts without repeating a mutation");
}
for (const failure of ["claim-empty", "generation", "connection", "account", "expired", "foreign", "wrong-link", "sold"]) {
  reset(); const plan = await prepare("both");
  mode = failure;
  if (failure === "generation") generation = "c".repeat(64);
  if (failure === "connection") credentials.password = "changed";
  if (failure === "account") seller = "666";
  if (failure === "expired") jobs.get(plan.id).expires_at = "2020-01-01T00:00:00Z";
  if (failure === "sold") o = "2";
  await assert.rejects(call({ operation: "execute", jobId: plan.id, confirm: true })); assert.equal(writes.length, 0, failure);
}
reset(); const plan = await prepare("both");
await assert.rejects(manage({ operation: "execute", jobId: plan.id, confirm: true }, "other-owner", env, db, allegro)); assert.equal(writes.length, 0);
reset(); a = "ENDED"; o = "4"; const already = await prepare("both"); await call({ operation: "execute", jobId: already.id, confirm: true }); assert.equal(writes.length, 0);
reset(); await assert.rejects(manage({ operation: "prepare", offerId: "10", scope: "allegro" }, owner, {}, db, allegro)); assert.equal(writes.length, 0);
reset(); const parallel = await prepare("both"); await Promise.allSettled([call({ operation: "execute", jobId: parallel.id, confirm: true }), call({ operation: "execute", jobId: parallel.id, confirm: true })]); assert.equal(writes.length, 2, "CAS permits one two-target execution");
for (const change of ["rotate-midway", "sold-midway"]) {
  reset(); const plan = await prepare("both"); mode = change;
  const result = await call({ operation: "execute", jobId: plan.id, confirm: true });
  assert.deepEqual(writes, ["allegro"]); assert.equal(result.ovoko, "uncertain", "Changed/sold target after the first leg cannot be overwritten");
}
// Real HTTP perimeter: admin role/suspension, CSRF, input bounds and no unauthenticated mutation.
let allowed = false, suspended = false, dispatched = 0;
const api = load("allegro-api", name => { assert.equal(name, "./inventory-withdrawal"); return { manageWithdrawal: async () => { dispatched++; return { ok: true }; }, WithdrawalError: class extends Error {} }; });
const keyBytes = new Uint8Array(32).fill(8), key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt", "decrypt"]);
const sealed = await api.sealConnection({ accessToken: "fixture", expiresAt: Date.now() + 3600000 }, key, owner);
const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async (input, options = {}) => {
    const path = new URL(input).pathname; assert.equal(options.method || "GET", "GET");
    if (path === "/auth/v1/user") return Response.json({ id: owner });
    if (path === "/rest/v1/allegro_connections") return Response.json([{ sealed }]);
    if (path === "/rest/v1/account_admins") return Response.json(allowed ? [{ owner_id: owner }] : []);
    if (path === "/rest/v1/customer_accounts") return Response.json([{ owner_id: owner, suspended }]);
    throw new Error(path);
  };
  const apiEnv = { SUPABASE_SERVICE_ROLE_KEY: "fixture", ALLEGRO_ENCRYPTION_KEY: Buffer.from(keyBytes).toString("base64") };
  const req = (body = {}, headers = {}) => new Request("https://fixture.test/api/allegro/inventory-withdrawal", { method: "POST", headers: { Authorization: "Bearer fixture", Origin: "https://fixture.test", "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  assert.equal((await api.handleAllegroApi(req(), apiEnv)).status, 403);
  allowed = true; suspended = true; assert.equal((await api.handleAllegroApi(req(), apiEnv)).status, 403);
  suspended = false; assert.equal((await api.handleAllegroApi(req({}, { Origin: "https://evil.test" }), apiEnv)).status, 403);
  assert.equal((await api.handleAllegroApi(req({}, { "Content-Length": "8193" }), apiEnv)).status, 413);
  assert.equal((await api.handleAllegroApi(req([]), apiEnv)).status, 400); assert.equal(dispatched, 0);
  assert.equal((await api.handleAllegroApi(req(), apiEnv)).status, 200); assert.equal(dispatched, 1);
} finally { globalThis.fetch = originalFetch; }
console.log("Manual withdrawal: exact scopes, durable CAS, owner/account/generation binding, confirmation, expiry, no delete, partial outcomes, timeout readback, concurrency and no-replay passed. All services mocked.");
