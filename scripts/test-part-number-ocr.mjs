import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../public/wystawiacz/part-number-ocr.js", import.meta.url), "utf8");
const context = vm.createContext({ window: {} });
vm.runInContext(source, context);
const { extractCandidates, rankCandidates, sameSelection } = context.window.PartNumberOcr;
const found = extractCandidates("VW\n5NA 803 881 F\nP/N: 5Q0959857\nA 211 820 15 85\n0 281 015 009\n12V\n2026-10-06\n5901234123457", "label.jpg");
const numbers = Array.from(found, item => item.number);
for (const expected of ["5NA803881F", "5Q0959857", "A2118201585", "0281015009"]) assert.ok(numbers.includes(expected), expected);
assert.ok(!numbers.includes("5901234123457"), "EAN must not be suggested as a part number");
assert.ok(!numbers.includes("20261006"), "Dates must not be suggested");
const ranked = rankCandidates([
  { name: "one.jpg", text: "S/N: 123456789\nP/N: 5Q0 959 857" },
  { name: "two.jpg", text: "5Q0959857\nP/N: 0281015009" }
]);
assert.equal(ranked[0].number, "5Q0959857");
assert.deepEqual(Array.from(ranked[0].photos), ["one.jpg", "two.jpg"]);
assert.equal(ranked.filter(item => item.number === "5Q0959857").length, 1);
assert.ok(!ranked.some(item => item.number === "123456789"), "Serial numbers must be excluded, not offered lower down");
assert.equal(extractCandidates("S/N: 5Q0959857\nVIN: A2118201585\nLOT: 0281015009\nABCD123\n12345678", "noise.jpg").length, 0);
assert.ok(extractCandidates("P/N: 5Q0959857 S/N: 123456789", "mixed.jpg").some(item => item.number === "5Q0959857"));
assert.equal(extractCandidates("S/N:\n0281015009", "serial-newline.jpg").length, 0);
assert.ok(extractCandidates("P/N:\n12345678", "part-newline.jpg").some(item => item.number === "12345678"));
const six = rankCandidates([{ name: "many.jpg", text: Array.from({ length: 9 }, (_, i) => `P/N: 5Q09598${50 + i}`).join("\n") }]);
assert.equal(six.length, 6, "Offer six distinct candidates when enough plausible numbers exist");
assert.equal(extractCandidates("<script>alert(1)</script>\nMADE IN GERMANY", "unsafe.jpg").length, 0);
const correction = extractCandidates("SNA 803 881 F", "label.jpg");
assert.ok(correction.some(item => item.number === "SNA803881F"));
assert.equal(correction.find(item => item.number === "5NA803881F").correction, "SNA803881F");
const file = {};
const snapshot = { productId: "one", photos: [{ name: "a.jpg", file }] };
assert.equal(sameSelection(snapshot, snapshot), true);
assert.equal(sameSelection(snapshot, { ...snapshot, productId: "two" }), false);
assert.equal(sameSelection(snapshot, { ...snapshot, photos: [{ name: "a.jpg", file: {} }] }), false);
assert.equal(sameSelection(snapshot, { ...snapshot, photos: [{ name: "a.jpg", file, rotating: true }] }), false);
assert.ok(!source.includes("innerHTML"), "OCR output must be rendered as text");
assert.ok(source.includes("worker.recognize(image)"));
assert.ok(source.includes("choose(item.number)"));
const app = await readFile(new URL("../public/wystawiacz/app.js", import.meta.url), "utf8");
assert.ok(app.includes('partNumber.dispatchEvent(new Event("input", { bubbles: true }))'));
console.log("OCR candidate extraction: grouped OEM formats, ranking, deduplication, dates/EAN, safe output and stale-selection guards passed.");
