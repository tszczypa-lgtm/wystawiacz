import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const source = await readFile(new URL("../lib/allegro-api.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { analyzePartEvidence, searchTitleSuggestions } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const evidence = [
  { title: "ABS Pump BMW F40 5A2EBA9", snippet: "Pump with module", url: "https://parts.test/pump" },
  { title: "ABS control unit 5A2EBA9", snippet: "Controller", url: "https://other.test/controller" },
  { title: "Wrong ABS 5A2EBA8", snippet: "", url: "https://wrong.test/part" }
];
const env = { OPENAI_API_KEY: "server-only" };
const original = globalThis.fetch;
let calls = 0;
let suggestions = [{ partName: "Pompa ABS", title: "Pompa ABS BMW F40", sourceIds: [0], note: "Jedno zrodlo opisuje pompe; drugie sterownik. Sprawdz zestaw." }];
const completed = () => Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ suggestions }) }] }] });
try {
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(url, "https://api.openai.com/v1/responses");
    assert.equal(options.headers.Authorization, "Bearer server-only");
    const body = JSON.parse(options.body);
    assert.equal(body.store, false);
    assert.equal(body.max_output_tokens, 900);
    assert.equal(body.text.format.strict, true);
    assert.equal(JSON.parse(body.input).sources.length, 2, "Exclude wrong part number before AI");
    assert.ok(!body.input.includes("server-only"));
    assert.ok(body.instructions.includes("untrusted data"));
    return completed();
  };
  assert.equal((await analyzePartEvidence("5A2EBA9", evidence, {})).errorCode, "ai_not_configured");
  assert.equal((await analyzePartEvidence("5A2EBA9", [], env)).titles.length, 0);
  assert.equal(calls, 0, "Missing key/evidence must not spend API credits");
  const result = await analyzePartEvidence("5A2EBA9", evidence, env);
  assert.equal(result.source, "ai");
  assert.equal(result.titles[0].title, "Pompa ABS BMW F40 5A2EBA9");
  assert.equal(result.titles[0].partName, "Pompa ABS");
  assert.deepEqual(result.titles[0].sources, [evidence[0].url]);
  assert.ok(!JSON.stringify(result).includes("server-only"));
  suggestions = [{ partName: "Pompa ABS", title: "Pompa ABS", sourceIds: [999], note: "Invented source" }, null];
  assert.equal((await analyzePartEvidence("5A2EBA9", evidence, env)).titles.length, 0);
  suggestions = [];
  assert.equal((await analyzePartEvidence("5A2EBA9", evidence, env)).titles.length, 0);
  for (const status of [401, 403, 429, 500]) {
    globalThis.fetch = async () => Response.json({ error: "server-only" }, { status });
    const failure = await analyzePartEvidence("5A2EBA9", evidence, env);
    assert.ok(failure.errorCode);
    assert.ok(!JSON.stringify(failure).includes("server-only"));
  }
  globalThis.fetch = async () => { throw new DOMException("server-only", "TimeoutError"); };
  assert.ok((await analyzePartEvidence("5A2EBA9", evidence, env)).errorCode);
  globalThis.fetch = async () => Response.json({ status: "incomplete" });
  assert.ok((await analyzePartEvidence("5A2EBA9", evidence, env)).errorCode);
  suggestions = [{ partName: "Pompa ABS", title: "Pompa ABS BMW F40", sourceIds: [0], note: "Sprawdz sklad zestawu." }];
  let aiCalls = 0;
  globalThis.fetch = async url => {
    if (new URL(url).hostname === "serpapi.com") return Response.json({ search_metadata: { status: "Success" }, organic_results: evidence.map(item => ({ ...item, link: item.url })) });
    aiCalls++;
    return completed();
  };
  const remote = async () => ({ products: [] });
  const configured = { ...env, SERPAPI_API_KEY: "search-only" };
  assert.equal((await searchTitleSuggestions("5A2EBA9", "ai-owner", configured, remote)).groups[1].source, "ai");
  await searchTitleSuggestions("5A2EBA9", "ai-owner", configured, remote);
  assert.equal(aiCalls, 1, "Cache avoids another paid AI call for the same number");
  console.log("AI: exact-number evidence, structured request, provenance, no unsupported sources, safe failures and paid-call caching passed. Mock API only.");
} finally { globalThis.fetch = original; }
