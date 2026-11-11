import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url)), native = createRequire(import.meta.url), cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  const source = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  new Function("require", "module", "exports", source)(name => name.startsWith(".") ? load(path.resolve(path.dirname(file), name + ".ts")) : native(name), module, module.exports);
  return module.exports;
}
const { handleBetaApi } = load(path.join(root, "lib/beta-api.ts"));
const originalFetch = globalThis.fetch;
let admin = true, suspended = false, user = 1, calls = [], invalid = false;
const owner = () => `00000000-0000-0000-0000-${String(user).padStart(12, "0")}`;
const env = { SUPABASE_SERVICE_ROLE_KEY: "db-key", BETA_AI_ENABLED: "true", OPENAI_API_KEY: "fixture-secret" };
const request = (path, method = "GET", body, origin = true) => new Request(`https://beta.test/api/beta${path}`, { method, headers: { Authorization: "Bearer fixture", ...(origin ? { Origin: "https://beta.test" } : {}), ...(typeof body === "string" ? { "Content-Type": "application/json" } : {}) }, body });
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(input);
  if (url.pathname === "/auth/v1/user") return Response.json({ id: owner(), email_confirmed_at: new Date().toISOString() });
  if (url.pathname.includes("customer_accounts")) return Response.json([{ owner_id: owner(), suspended, company: {} }]);
  if (url.pathname.includes("account_admins")) return Response.json(admin ? [{ owner_id: owner() }] : []);
  assert.equal(url.origin, "https://api.openai.com"); calls.push({ url, options });
  assert.equal(options.method, "POST"); assert.equal(new Headers(options.headers).get("Authorization"), "Bearer fixture-secret");
  if (url.pathname.endsWith("/transcriptions")) return Response.json({ text: "Pompa ABS, numer 1234567, cena 200 zl." });
  const inputBody = JSON.parse(options.body);
  assert.equal(inputBody.store, false); assert.equal(inputBody.response_format.json_schema.strict, true); assert.ok(!inputBody.tools);
  return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ partName: "Pompa ABS", partNumber: "1234567", side: null, conditionNotes: null, pricePLN: invalid ? "-10" : "200", location: "B3", warnings: ["Sprawdz numer czesci"] }) } }] });
};
try {
  assert.equal((await handleBetaApi(new Request("https://beta.test/api/beta/status"), env)).status, 401);
  admin = false; assert.equal((await handleBetaApi(request("/status"), env)).status, 403); admin = true;
  suspended = true; assert.equal((await handleBetaApi(request("/status"), env)).status, 403); suspended = false;
  assert.equal((await handleBetaApi(request("/status"), { ...env, BETA_ENABLED: "false" })).status, 403);
  const status = await (await handleBetaApi(request("/status"), env)).json();
  assert.equal(status.owner, owner()); assert.equal(status.publishing, false); assert.equal(status.aiEnabled, true); assert.ok(!JSON.stringify(status).includes("fixture-secret"));
  assert.equal((await handleBetaApi(request("/suggest", "POST", JSON.stringify({ comment: "test" }), false), env)).status, 403);
  assert.equal((await handleBetaApi(request("/suggest", "POST", JSON.stringify({ comment: "test" })), { ...env, BETA_AI_ENABLED: "false" })).status, 503);
  assert.equal(calls.length, 0, "Disabled AI and unauthorized requests never reach provider");
  const response = await handleBetaApi(request("/suggest", "POST", JSON.stringify({ comment: "Pompa ABS 1234567, cena 200 zl, B3" })), env);
  assert.equal(response.status, 200); assert.equal((await response.json()).proposal.pricePLN, "200");
  invalid = true; user++; assert.equal((await handleBetaApi(request("/suggest", "POST", JSON.stringify({ comment: "Pompa" })), env)).status, 502); invalid = false;
  user++; assert.equal((await handleBetaApi(request("/suggest", "POST", JSON.stringify({ comment: "" })), env)).status, 400);
  assert.equal((await handleBetaApi(request("/suggest", "POST", JSON.stringify({ comment: "x".repeat(20000) })), env)).status, 413);
  user++;
  const form = new FormData(); form.set("audio", new Blob(["mock recording"], { type: "audio/webm" }), "voice.webm");
  assert.equal((await handleBetaApi(request("/transcribe", "POST", form), env)).status, 200);
  const audioCall = calls.at(-1); assert.equal(audioCall.options.body.get("language"), "pl");
  user++;
  for (let i = 0; i < 6; i++) assert.equal((await handleBetaApi(request("/suggest", "POST", JSON.stringify({ comment: "Pompa" })), env)).status, 200);
  assert.equal((await handleBetaApi(request("/suggest", "POST", JSON.stringify({ comment: "Pompa" })), env)).status, 429);
  assert.ok(calls.every(call => call.url.hostname === "api.openai.com"), "AI has no Allegro or workspace mutation capability");
  console.log("Beta API: admin-only access, kill switches, CSRF, size/rate limits, schema validation, audio and no listing mutations passed. Provider calls mocked.");
} finally { globalThis.fetch = originalFetch; }
