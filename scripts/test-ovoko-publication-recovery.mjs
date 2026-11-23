import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
function load(name, require = () => { throw new Error("dependency"); }) {
  const code = ts.transpileModule(readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} }; new Function("require", "module", "exports", code)(require, module, module.exports); return module.exports;
}
const read = load("ovoko-read"), cryptoApi = load("allegro-api");
const key = await crypto.subtle.importKey("raw", new Uint8Array(32).fill(3), "AES-GCM", false, ["encrypt", "decrypt"]);
let mode, row, owner, rpcCalls, changed, providerCalls;
function reset() { mode = "absent"; row = { state: "uncertain", part_id: null, request_hash: "a".repeat(64), updated_at: "2026-01-01T00:00:00Z" }; owner = "owner"; rpcCalls = []; changed = false; providerCalls = []; }
const remote = async path => {
  providerCalls.push(path); assert.ok(path.startsWith("/v2/get/parts?"), "Recovery never mutates the provider");
  const url = new URL(`https://fixture.test${path}`), page = Number(url.searchParams.get("page")), external = url.searchParams.has("external_ids");
  if (mode === "error") throw new Error("private-provider");
  if (external) return { status_code: "R200", data: mode === "found" ? [{ id: "77", external_id: "tymo:555:10" }] : mode === "foreign" ? [{ id: "77", external_id: "tymo:666:10" }] : [], pagination: { page: 1, limit: 2, total_count: ["found", "foreign"].includes(mode) ? 1 : 0 } };
  const total = mode === "large" ? 2001 : mode === "changed" && page === 2 ? 102 : 101;
  const data = Array.from({ length: Math.min(100, 101 - (page - 1) * 100) }, (_, index) => ({ id: String((page - 1) * 100 + index + 1), external_id: null }));
  return { status_code: "R200", data, pagination: { page, limit: 100, total_count: total } };
};
const { scanPublicationRecovery: scan, recoverOvokoPublication: recover } = load("ovoko-publication-recovery", name => {
  if (name === "./allegro-api") return { ...cryptoApi, handleAllegroApi: async () => Response.json({ sellerId: "555" }) };
  if (name === "./ovoko-connection") return { ovokoConnectionKey: async () => key, loadOvokoConnection: async () => ({ username: "fixture", password: changed ? "changed" : "fixture", user_token: "fixture" }) };
  if (name === "./ovoko-write-client") return { ovokoWriteClient: () => remote, ovokoWriteDigest: async value => value.includes("changed") ? "b".repeat(64) : "c".repeat(64) };
  if (name === "./ovoko-read") return read;
  throw new Error(name);
});
const request = new Request("https://fixture.test/api/ovoko/publication-recovery", { headers: { Authorization: "Bearer fixture" } });
const context = () => ({ user: { id: owner }, db: async (path, options) => {
  if (path.startsWith("ovoko_single_publications?")) { assert.equal(options, undefined); return [{ ...row }]; }
  assert.equal(path, "rpc/resolve_ovoko_publication"); assert.equal(options.method, "POST"); const body = JSON.parse(options.body); rpcCalls.push(body); assert.equal(body.p_hash, row.request_hash); assert.equal(body.p_updated, row.updated_at); return true;
} });
const call = input => recover(request, {}, context(), { offerId: "10", ...input });
reset(); assert.deepEqual(await scan(remote, "tymo:555:10", null), { partId: null, scanned: 101 });
for (const failure of ["large", "changed", "foreign", "error"]) { reset(); mode = failure; await assert.rejects(scan(remote, "tymo:555:10", null)); }
reset(); await assert.rejects(scan(remote, "tymo:555:10", "77"), /nadal istnieje/);
reset(); mode = "found"; assert.equal((await scan(remote, "tymo:555:10", null)).partId, "77"); await assert.rejects(scan(remote, "tymo:555:10", "78"));
reset(); const absent = await call({ operation: "check" }); assert.equal(absent.readOnly, true); assert.equal(rpcCalls.length, 0);
await assert.rejects(call({ operation: "confirm", token: absent.token }), /Potwierdz/); assert.equal(rpcCalls.length, 0);
const released = await call({ operation: "confirm", token: absent.token, confirmAbsent: true }); assert.equal(released.resolved, true); assert.equal(rpcCalls[0].p_found, null); assert.equal(rpcCalls[0].p_scanned, 101);
reset(); mode = "found"; const found = await call({ operation: "check" }); const adopted = await call({ operation: "confirm", token: found.token }); assert.equal(adopted.partId, "77"); assert.equal(rpcCalls[0].p_found, "77");
for (const failure of ["owner", "hash", "connection", "new-attempt", "forged"]) {
  reset(); const proof = await call({ operation: "check" });
  if (failure === "owner") owner = "different-owner";
  if (failure === "hash") row.request_hash = "d".repeat(64);
  if (failure === "connection") changed = true;
  if (failure === "new-attempt") row.updated_at = new Date().toISOString();
  await assert.rejects(call({ operation: "confirm", token: failure === "forged" ? "forged" : proof.token, confirmAbsent: true })); assert.equal(rpcCalls.length, 0);
}
reset(); row.state = "created"; await assert.rejects(call({ operation: "check" })); assert.equal(providerCalls.length, 0);
console.log("Publication recovery: complete bounded scans, exact references, old-lock age, encrypted owner/account/generation proof, explicit absence confirmation and audited RPC-only resolution passed. No provider writes.");
