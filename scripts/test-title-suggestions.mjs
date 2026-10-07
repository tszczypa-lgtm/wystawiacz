import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import vm from "node:vm";

const source = await readFile(new URL("../lib/allegro-api.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { searchTitleSuggestions, exactPartNumber } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
assert.ok(exactPartNumber("Hak 5NA 803 881 F Volkswagen", "5NA803881F"));
assert.ok(!exactPartNumber("Hak 5NA803881FB", "5NA803881F"));
assert.ok(!exactPartNumber("Hak 5NA 803 881 FB", "5NA803881F"));
assert.ok(!exactPartNumber("Hak 5NA803881", "5NA803881F"));
let calls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async url => {
  calls++;
  const u = new URL(url);
  assert.equal(u.hostname, "serpapi.com");
  assert.equal(u.searchParams.get("q"), '"5NA803881F" -site:allegro.pl');
  assert.equal(u.searchParams.get("api_key"), "server-only");
  return Response.json({ organic_results: [
    { title: "Hak 5NA803881FB", snippet: "Pasuje takze do 5NA803881F", link: "https://parts.test/wrong" },
    { title: "Hak 5NA 803 881 F Volkswagen | Sklep", link: "https://parts.test/one" },
    { title: "Zaczep 5NA803881F Tiguan", link: "https://parts.test/two" },
    { title: "Trzeci hak 5NA803881F", link: "https://parts.test/three" },
    { title: "Hak 5NA803881F", link: "javascript:alert(1)" }
  ] });
};
const remote = async (path, options) => {
  assert.ok(path.includes("mode=MPN"));
  assert.ok(path.includes("5NA803881F"));
  assert.ok(options.signal);
  return { products: [{ name: "Hak Volkswagen" }, { name: "Hak Volkswagen" }, { name: "Zaczep Tiguan" }, { name: "Inny hak" }] };
};
try {
  const result = await searchTitleSuggestions("5NA803881F", "owner1", { SERPAPI_API_KEY: "server-only" }, remote);
  assert.equal(result.groups[0].titles.length, 2);
  assert.equal(result.groups[1].titles.length, 2);
  assert.ok(result.groups[1].titles.every(item => !item.url.endsWith("/wrong")));
  for (const group of result.groups) for (const item of group.titles) {
    assert.ok(item.title.endsWith("5NA803881F"));
    assert.ok(item.title.length <= 75);
  }
  assert.ok(!JSON.stringify(result).includes("server-only"));
  await searchTitleSuggestions("5NA803881F", "owner1", { SERPAPI_API_KEY: "server-only" }, remote);
  assert.equal(calls, 1, "Repeated number uses cached results");
  const partial = await searchTitleSuggestions("5NA803881F", "owner2", {}, remote);
  assert.equal(partial.groups[0].titles.length, 2);
  assert.equal(partial.groups[1].titles.length, 0);
  assert.ok(partial.groups[1].message.includes("SERPAPI_API_KEY"));
  const failed = await searchTitleSuggestions("5NA803881F", "owner3", {}, async () => { throw new Error("secret-token"); });
  assert.ok(!JSON.stringify(failed).includes("secret-token"));
  await assert.rejects(searchTitleSuggestions('bad?query="', "owner1", {}, remote));
} finally { globalThis.fetch = originalFetch; }
const app = await readFile(new URL("../public/wystawiacz/app.js", import.meta.url), "utf8");
const html = await readFile(new URL("../public/wystawiacz/index.html", import.meta.url), "utf8");
assert.ok(!app.includes("PartNumberOcr"));
assert.ok(!html.includes("part-number-ocr"));
const client = await readFile(new URL("../public/wystawiacz/title-suggestions.js", import.meta.url), "utf8");
vm.runInNewContext(client, { window: {} });
assert.ok(!client.includes("innerHTML"));
assert.ok(client.includes("version !== revision"));
assert.ok(client.includes("choose(item.title)"));
console.log("Title suggestions: 2+2, full suffix, MPN search, deduplication, caching, missing provider, secret protection and OCR removal passed.");
