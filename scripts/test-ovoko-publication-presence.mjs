import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url)), native = createRequire(import.meta.url), cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const loaded = { exports: {} }; cache.set(file, loaded);
  const source = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("require", "module", "exports", source)(name => name.startsWith(".") ? load(path.resolve(path.dirname(file), `${name}.ts`)) : native(name), loaded, loaded.exports);
  return loaded.exports;
}
const { ovokoPublicationPresent, createdPublication, publicationCas } = load(path.join(root, "lib/ovoko-publication-presence.ts"));
const externalId = "tymo:555:101";
let calls;
function fixture(rows = [], change = value => value) {
  calls = [];
  return async request => {
    const url = new URL(request, "https://api.rrr.lt"); calls.push(url);
    assert.equal(url.pathname, "/v2/get/parts");
    assert.equal(url.searchParams.has("part_ids"), false);
    const external = url.searchParams.has("external_ids"), page = Number(url.searchParams.get("page")), limit = Number(url.searchParams.get("limit"));
    assert.ok(limit <= 100, "Documented maximum page size is 100, not 1000");
    if (external) assert.equal(url.searchParams.get("external_ids"), externalId);
    else assert.equal(url.searchParams.get("sort[id]"), "asc");
    const filtered = external ? rows.filter(row => row.external_id === externalId) : rows;
    return change({ status_code: "R200", data: filtered.slice((page - 1) * limit, page * limit), pagination: { page, limit, total_count: filtered.length } }, { external, page });
  };
}
assert.equal(await ovokoPublicationPresent(fixture(), "77", externalId), false);
assert.equal(calls.length, 2);
assert.equal(await ovokoPublicationPresent(fixture([{ id: "77", external_id: null }]), "77", externalId), true);
assert.equal(await ovokoPublicationPresent(fixture([{ id: "99", external_id: externalId }]), "77", externalId), true);
assert.equal(calls.length, 1, "Confirmed external reference alone retains the lock");

const large = Array.from({ length: 1501 }, (_, index) => ({ id: String(10000 + index * 2), external_id: null }));
assert.equal(await ovokoPublicationPresent(fixture(large), "77", externalId), false);
assert.equal(calls.length, 2, "1500+ newly recreated parts: old low ID is absent after one sorted inventory page");
for (const target of ["10001", "11001", "12999", "14000"]) {
  assert.equal(await ovokoPublicationPresent(fixture(large), target, externalId), false);
  assert.ok(calls.length <= 6, "Exact ID range search is logarithmic, including absent high IDs");
}
for (const target of ["10000", "11000", "12998", "13000"]) {
  assert.equal(await ovokoPublicationPresent(fixture(large), target, externalId), true);
  assert.ok(calls.length <= 6);
}
for (const change of [
  () => ({ status_code: "R404", msg: "private-error" }),
  value => ({ ...value, status_code: "R202" }),
  value => ({ ...value, pagination: undefined }),
  value => ({ ...value, pagination: { ...value.pagination, page: 2 } }),
  value => ({ ...value, pagination: { ...value.pagination, limit: 1000 } }),
  value => ({ ...value, data: [], pagination: { ...value.pagination, total_count: 1 } }),
  value => ({ ...value, data: [{ id: "99", external_id: "private-wrong" }], pagination: { ...value.pagination, total_count: 1 } }),
]) {
  await assert.rejects(ovokoPublicationPresent(fixture([], change), "77", externalId), error => error.status === 502 && !error.message.includes("private-"));
}
for (const change of [
  (value, { external }) => external ? value : { ...value, data: value.data.slice().reverse() },
  (value, { external }) => external ? value : { ...value, data: value.data.map((row, i) => i === 1 ? value.data[0] : row) },
  (value, { external }) => external ? value : { ...value, data: value.data.map((row, i) => i === 0 ? null : row) },
  (value, { external, page }) => external || page === 1 ? value : { ...value, pagination: { ...value.pagination, total_count: 1502 } },
  (value, { external, page }) => external || page === 1 ? value : { ...value, data: large.slice(0, value.data.length) },
]) await assert.rejects(ovokoPublicationPresent(fixture(large, change), "14000", externalId), /Nie potwierdzono obecnosci/);
await assert.rejects(ovokoPublicationPresent(async () => { throw new Error("private-token"); }, "77", externalId), error => !error.message.includes("private-"));

const row = { state: "created", part_id: "77", request_hash: "a".repeat(64), updated_at: "2026-11-23T01:02:03.123456+00:00", owner_id: "owner" };
assert.equal(createdPublication(row, "owner"), row);
const cas = new URLSearchParams(publicationCas(row));
for (const key of ["state", "part_id", "request_hash", "updated_at"]) assert.equal(cas.get(key), `eq.${row[key]}`);
for (const patch of [{ state: "sending" }, { state: "uncertain" }, { part_id: null }, { request_hash: "invalid" }, { updated_at: "bad&state=eq.sending" }, { owner_id: "other" }]) assert.throws(() => createdPublication({ ...row, ...patch }, "owner"));
console.log("Publication presence: provider-contract bounds, 1500+ inventory, logarithmic sorted ID lookup, exact external references, strict shapes/pagination, errors and generation CAS passed. All calls mocked.");
