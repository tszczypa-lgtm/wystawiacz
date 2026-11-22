import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";
const root = fileURLToPath(new URL("../", import.meta.url)), native = createRequire(import.meta.url), cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  const source = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("require", "module", "exports", source)(name => name.startsWith(".") ? load(path.resolve(path.dirname(file), name + ".ts")) : native(name), module, module.exports);
  return module.exports;
}
const { ovokoCarsResponse } = load(path.join(root, "lib/ovoko-cars.ts"));
const query = "/v2/get/cars?model_ids=164&page=1&limit=20";
const rows = [{ id: "88", car_model: "164", car_years: "2009", external_id: "tymo:car:164:2009" }, { id: "89", car_model: "163", car_years: "2001", external_id: null }];
let reads = 0;
const fallback = async () => { reads++; return { status_code: "R200", list: rows }; };
const valid = { status_code: "R200", data: [rows[0]], pagination: { page: 1, limit: 20, total_count: 1 } };
assert.deepEqual(await ovokoCarsResponse(valid, query, fallback), valid); assert.equal(reads, 0);
for (const pagination of [undefined, null, { page: 1, limit: 100, total_count: 0 }, { pagination: { page: 1, limit: 20, total_count: 0 } }]) {
  const result = await ovokoCarsResponse({ status_code: "R200", data: [], pagination }, query, fallback);
  assert.deepEqual(result.data, [rows[0]]); assert.deepEqual(result.pagination, { page: 1, limit: 20, total_count: 1 });
}
assert.equal(reads, 4, "One bounded read fallback, never infinite pagination or retries");
for (const [filter, expected] of [["car_ids=89", rows[1]], ["external_ids=tymo%3Acar%3A164%3A2009", rows[0]]]) {
  assert.deepEqual((await ovokoCarsResponse({ status_code: "R200" }, `/v2/get/cars?${filter}&page=1&limit=1`, fallback)).data, [expected]);
}
const empty = await ovokoCarsResponse({ status_code: "R200" }, query, async () => ({ status_code: "R200", list: [] })); assert.equal(empty.pagination.total_count, 0);
for (const list of [null, {}, [{ id: "88" }], [rows[0], rows[0]], Array(10001).fill(rows[0])]) {
  await assert.rejects(ovokoCarsResponse({ status_code: "R200" }, query, async () => ({ status_code: "R200", list })), /Nie potwierdzono/);
}
await assert.rejects(ovokoCarsResponse({ status_code: "R200" }, query, async () => { throw new Error("private-token"); }), error => !error.message.includes("private-token"));
await assert.rejects(ovokoCarsResponse({ status_code: "R200" }, "/v2/get/cars?external_ids=x&page=1&limit=1", async () => ({ status_code: "R200", list: [{ id: "1", car_model: "164" }] })), /cars.legacy.external/);
const beforeError = reads; assert.equal((await ovokoCarsResponse({ status_code: "R002" }, query, fallback)).status_code, "R002"); assert.equal(reads, beforeError, "Authentication errors never trigger fallback");
console.log("Ovoko cars: missing/mismatched/nested pagination fallback, complete model/car/external filtering, reuse, real empty list and malformed/auth failure guards passed. No live calls.");
