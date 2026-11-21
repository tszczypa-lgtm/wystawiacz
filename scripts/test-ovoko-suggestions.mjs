import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
const compiled = ts.transpileModule(readFileSync(new URL("../lib/ovoko-suggestions.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { suggestPartNumbers, suggestOvokoCategories, suggestionSearchMatches } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const numbers = (title, parameters) => suggestPartNumbers(title, parameters).map(item => item.number);
for (const suffix of ["E", "EA", "ABCD", "e", "1"]) {
  const code = `5Q0959593${suffix}`;
  assert.deepEqual(numbers(`AUDI S3 SPORTBACK 8VA/8VF 2012 - 2020 STEROWNIK ZAMKA ${code}`), [code.toUpperCase()]);
}
for (const raw of ["5Q0 959 593 E", "5q0 959 593 e", "5Q0 959 593E", "5Q0-959-593-E", "5Q0.959.593E", "5Q0959593 E", "5Q0959593-E"]) {
  const result = suggestPartNumbers(`STEROWNIK ${raw}`);
  assert.deepEqual(result.map(item => item.number), ["5Q0959593E"], raw);
  assert.ok(result[0].evidence.some(item => item.raw === raw));
}
assert.deepEqual(numbers("POMPA ABS 5Q0959593E 5Q0959593F"), ["5Q0959593E", "5Q0959593F"]);
assert.deepEqual(numbers("5Q0959593E/5Q0959593F"), ["5Q0959593E", "5Q0959593F"]);
assert.deepEqual(numbers("5Q0959593/E"), [], "Unsupported slash index must not produce a shortened base");
assert.deepEqual(numbers("5Q0959593 (E)"), [], "Unsupported parenthesized index must not produce a shortened base");
assert.deepEqual(numbers("5Q0959593E Z AUDI"), ["5Q0959593E"], "Never append another title word to an already indexed code");
assert.deepEqual(numbers("2012-2020 2012.2020 2.0 TDI 1.9 TDI AUDI A4 B8 8VA/8VF"), []);
assert.deepEqual(numbers("BOSCH 0 281 010 038"), ["0281010038"], "Leading zero is preserved");
assert.deepEqual(numbers("MODUL 61 35 9 123 456"), ["61359123456"]);
assert.deepEqual(numbers("MODUL 98 462824 80"), ["9846282480"]);
assert.deepEqual(numbers("MODUL 5Q0959593 ABS"), ["5Q0959593"], "Part name ABS is not appended as an invented suffix");
const title = "STEROWNIK ZAMKA AUDI 5Q0959593E";
assert.deepEqual(numbers(title, [{ name: "Numer katalogowy części", values: [title, "5Q0959593"] }]), ["5Q0959593E"], "A full title in MPN is ignored and a shorter parameter cannot replace the indexed title number");
assert.deepEqual(numbers("5Q0959593 5Q0959593E"), ["5Q0959593", "5Q0959593E"], "Two explicitly written title variants remain visible");
assert.deepEqual(numbers("POMPA ABS", [{ name: "Numer katalogowy części", values: ["ABC123"] }]), ["ABC123"]);
assert.deepEqual(numbers("POMPA ABS", [{ name: "Producent", values: ["ABC123"] }]), [], "Non-MPN parameters are not guessed as codes");
assert.deepEqual(numbers("A" + "1".repeat(40)), [], "Overlong numbers are rejected whole, never truncated");
const variants = suggestPartNumbers("5Q0959593E 5Q0 959 593 E"); assert.equal(variants.length, 1); assert.equal(variants[0].evidence.length, 2);
const categories = [{ id: "1", name: "Uklad hamulcowy", level: "1", parentId: "0" }, { id: "2", name: "ABS", level: "2", parentId: "1" }, { id: "3", name: "Pompy ABS", level: "3", parentId: "2" }, { id: "4", name: "Pompa paliwa", level: "3", parentId: "0" }, { id: "5", name: "Sterownik zamka", level: "3", parentId: "0" }, { id: "6", name: "Sterowniki silnika", level: "3", parentId: "0" }, { id: "7", name: "Nadwozie", level: "3", parentId: "0" }];
const suggestions = suggestOvokoCategories("AUDI POMPA ABS 5Q0959593E", categories);
assert.equal(suggestions[0].id, "3"); assert.deepEqual(suggestions[0].matches, ["pompa", "abs"]); assert.equal(suggestions[0].weak, false); assert.match(suggestions[0].path, /Uklad hamulcowy \/ ABS \/ Pompy ABS/);
assert.ok(suggestions.every(item => !["1", "2", "7"].includes(item.id))); assert.equal(suggestions.find(item => item.id === "4").weak, true);
assert.equal(suggestOvokoCategories("STEROWNIK ZAMKA AUDI", categories)[0].id, "5");
assert.deepEqual(suggestOvokoCategories("FORmentor 5Q0959593E", categories), [], "Car model and part number alone are not category evidence");
const original = JSON.stringify(categories); suggestOvokoCategories("pompa", categories); assert.equal(JSON.stringify(categories), original, "Never mutate supplier dictionaries");
assert.equal(suggestionSearchMatches("Układ hamulcowy / Części", "uklad"), true); assert.equal(suggestionSearchMatches("Sterownik silnika", "ZAMEK"), false);
console.log("Ovoko suggestions: complete contiguous/separated suffixes, leading zeros, numeric groups, date/model exclusions, multiple candidates, title-as-MPN rejection, no shortened parameter override, category levels/evidence/ambiguity and immutable dictionaries passed.");
