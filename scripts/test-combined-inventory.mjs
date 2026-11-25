import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
const compiled = ts.transpileModule(readFileSync(new URL("../lib/combined-inventory.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { combineInventory, filterCombinedInventory, sortCombinedInventory, emptyCombinedSnapshot, expandInventoryWithdrawal, isStockGroup } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const a = id => ({ id, name: "Radio ABC123456", image: "same-photo", externalId: "", status: "ACTIVE", stock: 1, price: { amount: "50.00", currency: "PLN" } });
const o = (id, externalId) => ({ id, name: "Radio", manufacturerCode: "ABC123456", image: "same-photo", externalId, status: "0", price: "100.00" });
const snapshot = { ...emptyCombinedSnapshot(), sellerId: "555", allegroComplete: true, ovokoComplete: true, statuses: { "0": "Na stanie", "1": "Sprzedano" }, allegro: [a("1"), a("2")], ovoko: [o("10", "tymo:555:1"), o("11", ""), { ...o("12", ""), status: "1" }], transfers: { "2": { state: "transferred", partId: "999" } } };
const rows = combineInventory(snapshot);
assert.equal(rows.length, 4); assert.equal(rows[0].ovoko.id, "10"); assert.equal(rows[1].ovoko, undefined, "A stale journal is not current presence");
assert.equal(rows.filter(row => row.ovoko && !row.allegro).length, 2, "Same OEM and photo never merge different physical parts");
const filter = { allegro: true, ovoko: true, coverage: "all", query: "", priceFrom: "", priceTo: "", allStatuses: false };
assert.equal(filterCombinedInventory(rows, filter, snapshot).length, 3, "Both portal switches mean union, not intersection");
for (const [coverage, expected] of [["both", 1], ["allegro", 1], ["ovoko", 1]]) assert.equal(filterCombinedInventory(rows, { ...filter, coverage }, snapshot).length, expected);
assert.equal(filterCombinedInventory(rows, { ...filter, allegro: false }, snapshot).length, 2);
assert.equal(filterCombinedInventory(rows, { ...filter, ovoko: false }, snapshot).length, 2);
assert.equal(filterCombinedInventory(rows, { ...filter, allStatuses: true }, snapshot).length, 4);
assert.equal(filterCombinedInventory(rows, { ...filter, query: "ABC123456", priceFrom: "48", priceTo: "52" }, snapshot).length, 2);
assert.throws(() => filterCombinedInventory(rows, { ...filter, priceFrom: "52", priceTo: "48" }, snapshot));
for (const query of ["ABC123 radio", "radio ABC123", "RADIO    abc123", "abc-123 radio"]) assert.equal(filterCombinedInventory(rows, { ...filter, query }, snapshot).length, 3, query);
assert.equal(filterCombinedInventory(rows, { ...filter, query: "ABC123 zderzak" }, snapshot).length, 0);
const prices = [{ ...rows[0], ovoko: { ...rows[0].ovoko, price: "20" } }, { ...rows[2], ovoko: { ...rows[2].ovoko, price: "5" } }, rows[1]];
assert.deepEqual(sortCombinedInventory(prices, "ovoko_price").map(r => r.key), [prices[1].key, prices[0].key, prices[2].key]);
assert.deepEqual(sortCombinedInventory(prices, "-ovoko_price").map(r => r.key), [prices[0].key, prices[1].key, prices[2].key]);
assert.deepEqual(sortCombinedInventory(rows.slice(0,2), "-age").map(r => r.allegro.id), ["2", "1"]);
assert.deepEqual(sortCombinedInventory(rows.slice(0,2), "age").map(r => r.allegro.id), ["1", "2"]);
assert.equal(filterCombinedInventory(rows, { ...filter, coverage: "allegro" }, { ...snapshot, ovokoComplete: false }).length, 0, "Partial reads cannot prove exclusivity");
assert.equal(filterCombinedInventory([{ ...rows[0], ovoko: { ...rows[0].ovoko, status: "unknown" } }], { ...filter, coverage: "allegro" }, snapshot).length, 0, "An unknown Ovoko status is not proof of Allegro-only presence");
assert.equal(combineInventory({ ...snapshot, sellerId: "other", transfers: {} }).length, 5, "Foreign seller references do not merge");
const conflicting = combineInventory({ ...snapshot, transfers: { "2": { state: "transferred", partId: "10" } } });
assert.equal(conflicting.length, 5); assert.equal(conflicting.filter(row => row.conflict).length, 3, "Conflicting external and journal references stay separate");
const duplicates = combineInventory({ ...snapshot, ovoko: [o("10", "tymo:555:1"), o("11", "tymo:555:1")] });
assert.equal(duplicates.length, 4); assert.ok(duplicates[0].conflict); assert.ok(!duplicates[0].ovoko);
assert.deepEqual(snapshot.allegro.map(row => row.id), ["1", "2"], "Merge does not mutate source snapshots");
const lifecycleRows = [
  { key: "manual", name: "Recznie zakonczona", conflict: false, allegro: { ...a("31"), status: "ENDED", stock: 1, sold: 0 } },
  { key: "sale", name: "Sprzedana Allegro", conflict: false, allegro: { ...a("32"), status: "ENDED", stock: 0, sold: 1 } },
  { key: "partial", name: "Aktywna po czesciowej sprzedazy", conflict: false, allegro: { ...a("33"), sold: 1 } },
  { key: "ovoko", name: "Sprzedana Ovoko", conflict: false, ovoko: { ...o("34", ""), status: "1" } },
];
assert.deepEqual(filterCombinedInventory(lifecycleRows, { ...filter, lifecycle: "ended" }, snapshot).map(r => r.key), ["manual"]);
assert.deepEqual(filterCombinedInventory(lifecycleRows, { ...filter, lifecycle: "sold" }, snapshot).map(r => r.key), ["sale", "ovoko"]);
assert.deepEqual(filterCombinedInventory(lifecycleRows, { ...filter, lifecycle: "sold", ovoko: false }, snapshot).map(r => r.key), ["sale"]);
assert.deepEqual(filterCombinedInventory(lifecycleRows, { ...filter, lifecycle: "available" }, snapshot).map(r => r.key), ["partial"]);
const separate = { state: "transferred", stockMode: "separate", partIds: ["10", "11"], totalUnits: 2, completedUnits: 2 };
const multi = { ...snapshot, allegro: [a("1")], ovoko: [{ ...o("10", "tymo:555:1:u:1"), status: "1" }, o("11", "tymo:555:1:u:2")], transfers: { "1": separate } };
let grouped = combineInventory(multi);
assert.equal(grouped.length, 1); assert.equal(grouped[0].conflict, false); assert.equal(grouped[0].ovoko.id, "11", "Sold first unit cannot hide available sibling");
assert.equal(grouped[0].ovokoUnits.length, 2);
assert.equal(filterCombinedInventory(grouped, filter, multi).length, 1);
assert.equal(filterCombinedInventory(grouped, { ...filter, query: "10" }, multi).length, 1, "All unit IDs are searchable");
assert.deepEqual(expandInventoryWithdrawal(grouped, "both").map(j => [j.offerId, j.partId, j.targets]), [["1", "10", ["allegro", "ovoko"]], ["1", "11", ["ovoko"]]]);
assert.deepEqual(expandInventoryWithdrawal(grouped, "allegro").map(j => j.targets), [["allegro"]]);
assert.deepEqual(expandInventoryWithdrawal(grouped, "ovoko").map(j => j.targets), [["ovoko"], ["ovoko"]]);
const partial = { ...multi, ovoko: [multi.ovoko[0]], transfers: { "1": { ...separate, state: "sending", completedUnits: 1, partIds: ["10"] } } };
grouped = combineInventory(partial); assert.equal(grouped.length, 1); assert.equal(grouped[0].ovokoUnits.length, 1);
assert.throws(() => expandInventoryWithdrawal(grouped, "both"), /calej potwierdzonej/);
assert.throws(() => expandInventoryWithdrawal(combineInventory({ ...multi, ovoko: [multi.ovoko[0]] }), "both"), /calej potwierdzonej/);
for (const unknown of [o("12", "tymo:555:1:u:3"), o("12", "tymo:555:1:u:2"), o("12", "tymo:555:1:u:bad"), o("12", "tymo:555:1"), o("12", "tymo:555:1:unknown")]) {
  const conflict = combineInventory({ ...multi, ovoko: [...multi.ovoko, unknown] });
  assert.ok(conflict[0].conflict, unknown.externalId); assert.equal(conflict[0].ovokoUnits.length, 0);
}
const overlap = combineInventory({ ...multi, allegro: [a("1"), a("2")], transfers: { ...multi.transfers, "2": { state: "transferred", partId: "10" } } });
assert.ok(overlap[0].conflict); assert.ok(overlap[1].conflict);
const shared = combineInventory({ ...multi, ovoko: [o("10", "tymo:555:1:u:1")], transfers: { "1": { ...separate, stockMode: "shared", totalUnits: 1, completedUnits: 1, partIds: ["10"] } } });
assert.equal(shared.length, 1); assert.ok(isStockGroup(shared[0]), "Shared group remains a group with stock one and listing one");
assert.deepEqual(expandInventoryWithdrawal(shared, "both").map(j => j.targets), [["allegro", "ovoko"]]);
console.log("Combined inventory: legacy links, separate/shared groups, partial journals, representative availability, conflicts, bulk expansion and filters passed.");
