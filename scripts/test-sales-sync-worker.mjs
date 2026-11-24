import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { readdirSync } from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const { Miniflare } = await import(pathToFileURL(require.resolve("miniflare", { paths: [require.resolve("wrangler/package.json")] })).href);
const bundled = await build({ stdin: { contents: 'import {handleOvokoApi} from "./lib/ovoko-api";export default {fetch:handleOvokoApi};', resolveDir: process.cwd() }, bundle: true, write: false, format: "esm", platform: "browser", target: "es2022" });
const owner = "00000000-0000-4000-8000-000000000001";
const production = process.argv.includes("--production");
const modules = production ? ["index.js", ...readdirSync("dist/server", { recursive: true }).filter(f => f.endsWith(".js") && f !== "index.js")].map(f => ({ type: "ESModule", path: path.resolve("dist/server", f) })) : true;
const mf = new Miniflare({ modules, compatibilityDate: "2026-05-15", compatibilityFlags: ["nodejs_compat"], ...(!production ? { script: bundled.outputFiles[0].text } : {}),
  bindings: { SUPABASE_SERVICE_ROLE_KEY: "fixture", NEXT_PUBLIC_SUPABASE_URL: "https://database.test" },
  outboundService: request => {
    const url = new URL(request.url); assert.equal(url.hostname, "database.test"); assert.equal(request.method, "GET");
    if (url.pathname === "/auth/v1/user") return Response.json({ id: owner, email_confirmed_at: "2026-01-01T00:00:00Z" });
    if (url.pathname === "/rest/v1/customer_accounts") return Response.json([{ owner_id: owner, suspended: false }]);
    if (url.pathname === "/rest/v1/account_admins") return Response.json([{ owner_id: owner }]);
    assert.ok(["/rest/v1/sales_sync", "/rest/v1/sales_sync_actions", "/rest/v1/sales_sync_reverse", "/rest/v1/sales_sync_reverse_actions", "/rest/v1/inventory_operations"].includes(url.pathname)); return Response.json([]);
  } });
try {
  const response = await mf.dispatchFetch("https://fixture.test/api/ovoko/sales-sync", { method: "POST", headers: { Authorization: "Bearer fixture", Origin: "https://fixture.test", "Content-Type": "application/json" }, body: JSON.stringify({ operation: "status" }) });
  const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body)); assert.equal(body.enabled, false);
  for (const [endpoint, operation] of [["reverse-sales-sync", "status"], ["inventory-actions", "list"]]) {
    const checked = await mf.dispatchFetch(`https://fixture.test/api/ovoko/${endpoint}`, { method: "POST", headers: { Authorization: "Bearer fixture", Origin: "https://fixture.test", "Content-Type": "application/json" }, body: JSON.stringify({ operation }) });
    assert.equal(checked.status, 200, await checked.text());
    const foreign = await mf.dispatchFetch(`https://fixture.test/api/ovoko/${endpoint}`, { method: "POST", headers: { Authorization: "Bearer fixture", Origin: "https://foreign.test", "Content-Type": "application/json" }, body: JSON.stringify({ operation: "execute", confirm: true }) });
    assert.equal(foreign.status, 403);
    const wrongType = await mf.dispatchFetch(`https://fixture.test/api/ovoko/${endpoint}`, { method: "POST", headers: { Authorization: "Bearer fixture", Origin: "https://fixture.test", "Content-Type": "text/plain" }, body: "{}" });
    assert.equal(wrongType.status, 415);
    const oversized = await mf.dispatchFetch(`https://fixture.test/api/ovoko/${endpoint}`, { method: "POST", headers: { Authorization: "Bearer fixture", Origin: "https://fixture.test", "Content-Type": "application/json" }, body: JSON.stringify({ operation, payload: "x".repeat(9000) }) });
    assert.equal(oversized.status, 413);
  }
  console.log("Sales synchronization workerd: actual runtime status and operation reads, cross-origin/content-type/size guards passed, no provider mutations.");
} finally { await mf.dispose(); }
