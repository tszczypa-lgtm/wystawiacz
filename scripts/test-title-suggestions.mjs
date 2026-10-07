import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import vm from "node:vm";

const source = await readFile(new URL("../lib/allegro-api.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { searchTitleSuggestions, exactPartNumber, matchesTitleResult } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
assert.ok(matchesTitleResult("Hak Volkswagen Tiguan", "Numer OE: 5NA 803 881 F", "5NA803881F"));
assert.ok(!matchesTitleResult("Hak 5NA803881J", "Pasuje tez do 5NA803881F", "5NA803881F"));
assert.ok(!matchesTitleResult("Hak 5NA803881FB", "5NA803881F", "5NA803881F"));
assert.ok(!matchesTitleResult("Hak Volkswagen", "5NA803881", "5NA803881F"));
assert.ok(matchesTitleResult("BMW F40 ABS Pump + Module -5A2EBA9", "", "5A2EBA9"));
assert.ok(matchesTitleResult("ABS PUMP UNIT ATE BMW F40", "Ref. 5A2EBA9 5A2EBA8", "5A2EBA9"));
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
  assert.equal(u.searchParams.get("q"), '5NA803881F -site:allegro.pl');
  assert.equal(u.searchParams.get("api_key"), "server-only");
  return Response.json({ organic_results: [
    { title: "Hak 5NA803881FB", snippet: "Pasuje takze do 5NA803881F", link: "https://parts.test/wrong" },
    { title: "Hak 5NA 803 881 F Volkswagen | Sklep", link: "https://parts.test/one" },
    { title: "Zaczep Tiguan", snippet: "Czesc numer 5NA 803 881 F", link: "https://parts.test/two" },
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
  for (const [status, code] of [[401, "invalid_key"], [403, "account_denied"], [429, "quota"], [400, "request"], [503, "provider"]]) {
    let attempts = 0;
    globalThis.fetch = async () => { attempts++; return Response.json({ error: "secret-token server-only" }, { status }); };
    const owner = `status-${status}`;
    const first = await searchTitleSuggestions("5NA803881F", owner, { SERPAPI_API_KEY: "server-only" }, remote);
    assert.equal(first.groups[1].errorCode, code);
    assert.ok(!JSON.stringify(first).includes("server-only"));
    assert.ok(!JSON.stringify(first).includes("secret-token"));
    await searchTitleSuggestions("5NA803881F", owner, { SERPAPI_API_KEY: "server-only" }, remote);
    assert.equal(attempts, 2, "Failed provider requests must not be cached for five minutes");
  }
  globalThis.fetch = async () => Response.json({ search_metadata: { status: "Success" }, error: "Google hasn't returned any results for this query." });
  const empty = await searchTitleSuggestions("5NA803881F", "empty", { SERPAPI_API_KEY: "server-only" }, remote);
  assert.equal(empty.groups[1].titles.length, 0);
  assert.equal(empty.groups[1].errorCode, undefined, "Successful empty results are not a provider outage");
  assert.ok(empty.groups[1].message.includes("nie znalazlo"));
  globalThis.fetch = async url => {
    assert.equal(new URL(url).searchParams.get("api_key"), "server-only");
    throw new DOMException("secret-token", "TimeoutError");
  };
  const timeout = await searchTitleSuggestions("5NA803881F", "timeout", { SERPAPI_API_KEY: " server-only\n" }, remote);
  assert.equal(timeout.groups[1].errorCode, "timeout");
  assert.ok(!JSON.stringify(timeout).includes("secret-token"));
} finally { globalThis.fetch = originalFetch; }
const app = await readFile(new URL("../public/wystawiacz/app.js", import.meta.url), "utf8");
const html = await readFile(new URL("../public/wystawiacz/index.html", import.meta.url), "utf8");
assert.ok(!app.includes("PartNumberOcr"));
assert.ok(!html.includes("part-number-ocr"));
const client = await readFile(new URL("../public/wystawiacz/title-suggestions.js", import.meta.url), "utf8");
const sandbox = { window: {} };
vm.runInNewContext(client, sandbox);
assert.equal(sandbox.window.TitleSuggestions.partName("VW Tiguan Hak holowniczy 5NA803881F"), "Hak holowniczy");
assert.equal(sandbox.window.TitleSuggestions.partName("Pół oś"), "");
assert.equal(sandbox.window.TitleSuggestions.partName("Półoś Volkswagen Golf"), "Półoś");
assert.equal(sandbox.window.TitleSuggestions.partName("Volkswagen Golf 5NA803881F"), "");
assert.equal(sandbox.window.TitleSuggestions.partName("BMW F40 ABS Pump + Module -5A2EBA9"), "Pompa ABS");
assert.equal(sandbox.window.TitleSuggestions.partName("BMW ABS control unit 5A2EBA9"), "Sterownik ABS");
assert.equal(sandbox.window.TitleSuggestions.partName("Referencia 5A2EBA9 ABS"), "");
assert.ok(!client.includes("innerHTML"));
assert.ok(client.includes("version !== revision"));
assert.ok(client.includes("choose(candidate, snapshot.mode)"));
const ast = ts.createSourceFile("app.js", app, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const functions = ast.statements.filter(ts.isFunctionDeclaration).map(fn => fn.getText(ast)).join("\n");
const mount = ast.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(item => item.name.getText(ast) === "titleSuggestions"));
let choose;
let append;
const editor = vm.createContext({
  window: { TitleSuggestions: { mount: options => { choose = options.choose; append = options.append; return {}; } } },
  state: { vehicles: [{ id: "golf", short: "VW Golf VII" }, { id: "tiguan", short: "VW Tiguan" }], selectedVehicleId: "golf", appendedPartNumber: "", descriptionManuallyEdited: true },
  partNumber: { value: "5NA803881F" }, titleInput: { value: "", dispatchEvent() {} },
  suggestionPanel: { classList: { remove() {} } }, summaryCard: { classList: { remove() {} } },
  Event: class {}, activeProductId: ""
});
vm.runInContext(functions, editor);
vm.runInContext("renderVehicleButtons = () => {}; updateSummary = () => {}; scheduleAllegroCategoryLookup = () => {}; detectProductDetails = () => {};", editor);
vm.runInContext(mount.getText(ast), editor);
choose("Hak holowniczy", "part");
assert.equal(editor.state.selectedVehicleId, "");
assert.equal(editor.titleInput.value, "Hak holowniczy 5NA803881F");
vm.runInContext('useVehicle("golf"); useVehicle("tiguan");', editor);
assert.equal(editor.titleInput.value, "Hak holowniczy VW Tiguan 5NA803881F");
choose("Pompa ABS", "part");
vm.runInContext('useVehicle("tiguan");', editor);
editor.state.descriptionManuallyEdited = true;
append("Sterownik ABS");
append("Sterownik ABS");
assert.equal(editor.titleInput.value, "Pompa ABS + Sterownik ABS VW Tiguan 5NA803881F");
assert.equal(editor.state.selectedVehicleId, "tiguan");
assert.equal(editor.state.descriptionManuallyEdited, true, "Appending a component preserves manual description edits");
assert.equal(sandbox.window.TitleSuggestions.partName("Sterownik Volkswagen 5NA803881F"), "Sterownik");
console.log("Part-only integration: source model removed, own vehicle selection/replacement and one complete part number passed.");
console.log("Title suggestions: 2+2, full suffix, MPN search, deduplication, caching, missing provider, secret protection and OCR removal passed.");
