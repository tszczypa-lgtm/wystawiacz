import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import vm from "node:vm";

const source = await readFile(new URL("../lib/allegro-api.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { searchTitleSuggestions } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const originalFetch = globalThis.fetch;
let externalCalls = 0;
let catalogCalls = 0;
globalThis.fetch = async () => { externalCalls++; throw new Error("Paid providers must never be called"); };
const remote = async (path, options) => {
  catalogCalls++;
  assert.ok(path.includes("mode=MPN"));
  assert.ok(path.includes("5NA803881F"));
  assert.ok(options.signal);
  return { products: [
    { name: "Hak Volkswagen" }, { name: "Hak Volkswagen" }, { name: "Wspornik Tiguan" },
    { name: "Pompa ABS" }, { name: "Sterownik ABS" }, { name: "Piaty produkt" }
  ] };
};
try {
  const result = await searchTitleSuggestions("5NA803881F", "owner1", {}, remote);
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].source, "allegro");
  assert.equal(result.groups[0].titles.length, 4);
  assert.equal(new Set(result.groups[0].titles.map(item => item.title)).size, 4);
  for (const item of result.groups[0].titles) {
    assert.ok(item.title.endsWith("5NA803881F"));
    assert.ok(item.title.length <= 75);
    assert.equal(new URL(item.url).hostname, "allegro.pl");
  }
  await searchTitleSuggestions("5NA803881F", "owner1", {}, remote);
  assert.equal(catalogCalls, 1, "Repeated number uses cached catalog results");
  const fewer = await searchTitleSuggestions("5NA803881F", "fewer", {}, async () => ({ products: [{ name: "Pompa ABS" }] }));
  assert.equal(fewer.groups[0].titles.length, 1, "Do not invent four results");
  const empty = await searchTitleSuggestions("5NA803881F", "empty", {}, async () => ({ products: [] }));
  assert.equal(empty.groups[0].titles.length, 0);
  let failedCalls = 0;
  const failedRemote = async () => { failedCalls++; throw new Error("secret-token"); };
  const failed = await searchTitleSuggestions("5NA803881F", "failed", {}, failedRemote);
  assert.equal(failed.groups[0].errorCode, "allegro");
  assert.ok(!JSON.stringify(failed).includes("secret-token"));
  await searchTitleSuggestions("5NA803881F", "failed", {}, failedRemote);
  assert.equal(failedCalls, 2, "Do not cache catalog outages");
  await assert.rejects(searchTitleSuggestions('bad?query="', "owner1", {}, remote));
  for (let i = 0; i < 8; i++) await searchTitleSuggestions(`PART000${i}`, "limited", {}, async () => ({ products: [] }));
  await assert.rejects(searchTitleSuggestions("PART0009", "limited", {}, remote), /Za duzo/);
  assert.equal(externalCalls, 0, "No Google or AI requests, even during failures");
  assert.ok(!source.includes("serpapi.com") && !source.includes("api.openai.com"));
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
console.log("Title suggestions: four Allegro candidates, full suffix, deduplication, caching, rate limit, safe failures and zero paid-provider requests passed.");
