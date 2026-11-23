import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(fileURLToPath(new URL("../dist/server/", import.meta.url)));
const files = await readdir(root, { recursive: true });
let tested = 0;
for (const file of files.filter(file => file.endsWith(".js"))) {
  const caller = path.join(root, file), source = await readFile(caller, "utf8");
  const match = source.match(/\{allegroSaleEvidence:(\w+)\}=await import\([`"']([^`"']+)[`"']\)/);
  if (!match) continue;
  const target = path.resolve(path.dirname(caller), match[2]);
  assert.ok(target.startsWith(root + path.sep), "Parser chunk stays in the built worker");
  const code = await readFile(target, "utf8");
  assert.ok(/export\{[^}]*\ballegroSaleEvidence\b/.test(code), `Missing parser export in ${path.relative(root, target)}`);
  // Load the exact chunk requested by the built adapter, not a TS source mock.
  const parser = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
  assert.equal(typeof parser.allegroSaleEvidence, "function", `Missing parser export in ${path.relative(root, target)}`);
  const event = { id: "1532603898317497", type: "READY_FOR_PROCESSING", occurredAt: "2026-11-24T00:12:32.321Z", order: { seller: { id: "555" }, buyer: { email: "private@test" }, lineItems: [{ id: "62ae358b-8f65-4fc4-9c77-bedf604a2e2b", offer: { id: "10" }, quantity: 1 }] } };
  const evidence = parser.allegroSaleEvidence({ events: [event] }, "555");
  assert.equal(evidence[0].listingId, "10");
  assert.doesNotMatch(JSON.stringify(evidence), /private|buyer/);
  assert.throws(() => parser.allegroSaleEvidence({ events: [event] }, "666"));
  assert.deepEqual(parser.allegroSaleEvidence({ events: [] }, "555"), []);
  tested++;
}
assert.ok(tested > 0, "No production adapter dynamic import was tested; run the production build first");
console.log("Production coordination parser: actual worker import target exports a callable parser; empty events, valid sales, seller isolation and no buyer data passed.");
