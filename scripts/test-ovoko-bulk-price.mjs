import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const source = await readFile(new URL("../lib/ovoko-bulk-price.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { adjustedOvokoPrice: price, validateOvokoAdjustment: validate } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
for (const [source, mode, value, expected] of [["100", "none", "0", "100.00"], ["100.00", "amount", "-10.25", "89.75"], ["100.00", "amount", "+10.25", "110.25"], ["220.00", "percent", "-10", "198.00"], ["100.10", "percent", "15.5", "115.62"], ["0.05", "percent", "-10", "0.05"], ["1", "percent", "1000", "11.00"], ["9999999999.99", "none", "0", "9999999999.99"]]) {
  assert.equal(price(source, "PLN", { mode, value }), expected);
  assert.equal(price(source, "EUR", { mode, value }), expected);
}
for (const adjustment of [null, {}, { mode: "absolute", value: "1" }, { mode: "percent", value: "-100" }, { mode: "percent", value: "1001" }, { mode: "amount", value: "NaN" }, { mode: "amount", value: "1e3" }, { mode: "amount", value: "0.001" }, { mode: "amount", value: "1", price: "1" }, { mode: "none", value: "10" }]) assert.throws(() => validate(adjustment));
for (const [source, currency, adjustment] of [["10", "USD", { mode: "none", value: "0" }], ["100", "PLN", { mode: "amount", value: "-100" }], ["0.01", "PLN", { mode: "percent", value: "-99.99" }], ["9999999999.99", "PLN", { mode: "amount", value: "0.01" }], ["1.234", "PLN", { mode: "none", value: "0" }]]) assert.throws(() => price(source, currency, adjustment));
console.log("Ovoko bulk prices: exact cents, signed amount/percent, rounding, PLN/EUR without conversion, limits and invalid/nonpositive values passed.");
