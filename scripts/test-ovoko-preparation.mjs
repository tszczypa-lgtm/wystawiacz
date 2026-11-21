import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../lib/ovoko-preparation.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { ovokoSourcePreview, initialOvokoDraft, ovokoPreparationIssues } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const offer = { id: "123", name: "Pompa 123456", images: ["https://a.allegroimg.com/picture", "https://evil.test/x.jpg", "javascript:alert(1)", "https://a.allegroimg.com/picture"], description: { sections: [{ items: [{ type: "TEXT", content: "Text" }, { type: "IMAGE", url: "https://evil.test" }] }] }, parameters: [{ id: "p1", name: "Numer katalogowy części", values: ["ABC123"] }], productSet: [{ product: { parameters: [] }, quantity: { value: 1 } }], sellingMode: { price: { amount: "123.45", currency: "PLN" } }, stock: { available: 1 }, publication: { status: "ACTIVE" }, category: { id: "999" }, delivery: { shippingRates: { id: "rate-id" } }, external: { id: "BIN-1" } };
const preview = ovokoSourcePreview(offer, "123", html => html);
assert.deepEqual(preview.images, ["https://a.allegroimg.com/picture"]); assert.equal(preview.skippedImages, 3);
assert.equal(preview.suggestedCode, "ABC123"); assert.equal(preview.shippingRateId, "rate-id"); assert.equal(preview.bundle, false);
assert.equal(preview.description, "Text");
const draft = initialOvokoDraft(preview); assert.equal(draft.price, "123.45"); assert.equal(draft.currency, "PLN");
assert.equal(preview.condition, "");
for (const [name, expected] of [["Używany", "used"], ["Nowy", "new"], ["Uszkodzony", "damaged"], ["Regenerowany", "restored"], ["Powystawowy", ""]]) {
  assert.equal(ovokoSourcePreview({ ...offer, parameters: [{ id: "11323", name: "Stan", values: [name] }] }, "123", html => html).condition, expected);
}
assert.equal(ovokoSourcePreview({ ...offer, parameters: [{ id: "11323", valuesIds: ["11323_2"] }] }, "123", html => html).condition, "used");
assert.equal(ovokoSourcePreview({ ...offer, parameters: [{ id: "11323", valuesIds: ["11323_999"] }] }, "123", html => html).condition, "");
assert.equal(ovokoSourcePreview({ ...offer, parameters: [{ id: "11323", values: ["__proto__"] }] }, "123", html => html).condition, "");
assert.equal(ovokoSourcePreview({ ...offer, parameters: [{ id: "11323", values: ["Używany", "Uszkodzony"] }] }, "123", html => html).condition, "", "Conflicting condition claims are not guessed");
assert.equal(ovokoSourcePreview({ ...offer, parameters: [{ id: "11323", values: ["Uszkodzony"] }], productSet: [{ product: { parameters: [{ id: "11323", values: ["Nowy"] }] } }] }, "123", html => html).condition, "damaged", "Offer condition takes precedence over catalogue metadata");
assert.equal(draft.manufacturerCode, "", "MPN requires explicit user choice even when the parameter looks plausible");
assert.equal(draft.categoryId, ""); assert.equal(draft.donorId, ""); assert.equal(draft.qualityId, ""); assert.equal(draft.statusId, ""); assert.equal(draft.shippingPlan, "");
const issues = ovokoPreparationIssues(preview, draft); assert.ok(issues.some(item => item.includes("formatu"))); assert.ok(issues.some(item => item.includes("Cennik Allegro")));
const filled = { ...draft, categoryId: "3", donorId: "36", qualityId: "0", statusId: "0", shippingPlan: "Check" };
assert.ok(ovokoPreparationIssues(preview, filled).some(item => item.includes("Publikacja jest wylaczona")), "Filling every field must never enable publishing");
assert.ok(ovokoPreparationIssues(preview, filled).some(item => item.includes("nie jest zweryfikowany")));
assert.equal(initialOvokoDraft({ ...preview, currency: "CZK" }).price, "", "Never reinterpret or convert unsupported currency");
assert.equal(initialOvokoDraft({ ...preview, currency: "CZK" }).currency, "");
assert.equal(ovokoSourcePreview({ ...offer, parameters: [] }, "123", html => html).suggestedCode, "", "Never guess MPN from title");
assert.equal(ovokoSourcePreview({ ...offer, parameters: [...offer.parameters, { name: "Kod producenta", values: ["OTHER"] }] }, "123", html => html).suggestedCode, "", "Ambiguous MPN is not auto-selected");
assert.ok(ovokoPreparationIssues({ ...preview, stock: 2 }, filled).some(item => item.includes("fizyczna czescia")));
for (const value of [null, [], {}, { ...offer, id: "456" }]) assert.throws(() => ovokoSourcePreview(value, "123", html => html), /Nieprawidlowe/);
console.log("Ovoko preparation: matching source ID, safe photo hosts, explicit MPN proposal, no ID mapping, no FX conversion, stock/bundle warnings and permanently disabled publication passed.");
