import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { readdirSync } from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const { Miniflare } = await import(pathToFileURL(require.resolve("miniflare", { paths: [require.resolve("wrangler/package.json")] })).href);
const bundled = await build({ stdin: { contents: 'import {handleOvokoApi} from "./lib/ovoko-api";import{handleAllegroApi}from"./lib/allegro-api";export default {fetch:(r,e)=>new URL(r.url).pathname.startsWith("/api/allegro/")?handleAllegroApi(r,e):handleOvokoApi(r,e)};', resolveDir: process.cwd() }, bundle: true, write: false, format: "esm", platform: "browser", target: "es2022" });
const owner = "00000000-0000-4000-8000-000000000001";
const production = process.argv.includes("--production");
let admin = true, active = true, suspended = false;
const rawKey = new Uint8Array(32).fill(7), iv = crypto.getRandomValues(new Uint8Array(12)), key = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["encrypt"]);
const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(owner) }, key, new TextEncoder().encode(JSON.stringify({ accessToken: "fixture", clientId: "fixture-client", expiresAt: Date.now()+3600000 })));
const sealed = `${Buffer.from(iv).toString("base64")}.${Buffer.from(encrypted).toString("base64")}`;
const modules = production ? ["index.js", ...readdirSync("dist/server", { recursive: true }).filter(f => f.endsWith(".js") && f !== "index.js")].map(f => ({ type: "ESModule", path: path.resolve("dist/server", f) })) : true;
const mf = new Miniflare({ port: 19877, modules, compatibilityDate: "2026-05-15", compatibilityFlags: ["nodejs_compat"], ...(!production ? { script: bundled.outputFiles[0].text } : {}),
  bindings: { BILLING_ENFORCED: "true", SUPABASE_SERVICE_ROLE_KEY: "fixture", NEXT_PUBLIC_SUPABASE_URL: "https://database.test", ALLEGRO_CLIENT_ID: "fixture-client", ALLEGRO_ENCRYPTION_KEY: Buffer.from(rawKey).toString("base64") },
  outboundService: request => {
    const url = new URL(request.url); assert.equal(url.hostname, "database.test"); assert.equal(request.method, "GET");
    if (url.pathname === "/auth/v1/user") return Response.json({ id: owner, email_confirmed_at: "2026-01-01T00:00:00Z" });
    if (url.pathname === "/rest/v1/customer_accounts") return Response.json([{ owner_id: owner, suspended, access_mode: active ? "free" : "standard", free_until: null }]);
    if (url.pathname === "/rest/v1/account_admins") return Response.json(admin ? [{ owner_id: owner }] : []);
    if (url.pathname === "/rest/v1/allegro_connections") return Response.json([{ sealed }]);
    assert.ok(["/rest/v1/sales_sync", "/rest/v1/sales_sync_actions", "/rest/v1/sales_sync_reverse", "/rest/v1/sales_sync_reverse_actions", "/rest/v1/inventory_operations", "/rest/v1/inventory_link_recovery"].includes(url.pathname)); return Response.json([]);
  } });
try {
  const response = await mf.dispatchFetch("https://fixture.test/api/ovoko/sales-sync", { method: "POST", headers: { Authorization: "Bearer fixture", Origin: "https://fixture.test", "Content-Type": "application/json" }, body: JSON.stringify({ operation: "status" }) });
  const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body)); assert.equal(body.enabled, false);
  for (const [endpoint, operation] of [["reverse-sales-sync", "status"], ["inventory-actions", "list"], ["link-recovery", "plans"]]) {
    const checked = await mf.dispatchFetch(`https://fixture.test/api/ovoko/${endpoint}`, { method: "POST", headers: { Authorization: "Bearer fixture", Origin: "https://fixture.test", "Content-Type": "application/json" }, body: JSON.stringify({ operation }) });
    assert.equal(checked.status, 200, await checked.text());
    const foreign = await mf.dispatchFetch(`https://fixture.test/api/ovoko/${endpoint}`, { method: "POST", headers: { Authorization: "Bearer fixture", Origin: "https://foreign.test", "Content-Type": "application/json" }, body: JSON.stringify({ operation: "execute", confirm: true }) });
    assert.equal(foreign.status, 403);
    const wrongType = await mf.dispatchFetch(`https://fixture.test/api/ovoko/${endpoint}`, { method: "POST", headers: { Authorization: "Bearer fixture", Origin: "https://fixture.test", "Content-Type": "text/plain" }, body: "{}" });
    assert.equal(wrongType.status, 415);
    const oversized = await mf.dispatchFetch(`https://fixture.test/api/ovoko/${endpoint}`, { method: "POST", headers: { Authorization: "Bearer fixture", Origin: "https://fixture.test", "Content-Type": "application/json" }, body: JSON.stringify({ operation, payload: "x".repeat(9000) }) });
    assert.equal(oversized.status, 413);
  }
  admin = false;
  for (const [headers, body, status] of [
    [{ Origin: "https://foreign.test", "Content-Type": "application/json" }, "{}", 403],
    [{ Origin: "https://fixture.test", "Content-Type": "text/plain" }, "{}", 415],
    [{ Origin: "https://fixture.test", "Content-Type": "application/json" }, JSON.stringify({payload:"x".repeat(21000)}), 413],
    [{ Origin: "https://fixture.test", "Content-Type": "application/json" }, "{}", 400],
  ]) {
    const checked = await mf.dispatchFetch("https://fixture.test/api/ovoko/manual-override", { method:"POST", headers:{Authorization:"Bearer fixture",...headers}, body });
    assert.equal(checked.status,status,await checked.text());
  }
  const invalidWithdrawal = await mf.dispatchFetch("https://fixture.test/api/allegro/inventory-withdrawal", { method: "POST", headers: { Authorization: "Bearer fixture", Origin: "https://fixture.test", "Content-Type": "application/json" }, body: "{}" });
  assert.equal(invalidWithdrawal.status, 400, await invalidWithdrawal.text()); // Reaches the real dynamic account guard/validator, never provider writes.
  for (const [endpoint, operation] of [["sales-sync", "status"], ["reverse-sales-sync", "status"], ["inventory-actions", "list"], ["link-recovery", "plans"]]) {
    const request = () => mf.dispatchFetch(`https://fixture.test/api/ovoko/${endpoint}`, { method: "POST", headers: { Authorization: "Bearer fixture", Origin: "https://fixture.test", "Content-Type": "application/json" }, body: JSON.stringify({ operation }) });
    const regular = await request(); assert.equal(regular.status, 200, "Active normal accounts have access to their own operations");
    active = false; assert.equal((await request()).status, 403, "Expired ordinary account is denied"); active = true;
    suspended = true; assert.equal((await request()).status, 403, "Suspended accounts remain denied"); suspended = false;
  }
  console.log("Sales synchronization workerd: actual runtime status and operation reads, cross-origin/content-type/size guards passed, no provider mutations.");
} finally { await mf.dispose(); }
