import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
const require = createRequire(import.meta.url);
const { Miniflare } = await import(pathToFileURL(require.resolve("miniflare", { paths: [require.resolve("wrangler/package.json")] })).href);
const bundled = await build({ stdin: { contents: 'import { handleAllegroApi } from "./lib/allegro-api"; export default {fetch:handleAllegroApi};', resolveDir: process.cwd(), sourcefile: "oauth-fixture.ts" }, bundle: true, write: false, format: "esm", platform: "browser", target: "es2022" });
const owner = "00000000-0000-0000-0000-000000000001", raw = Buffer.alloc(32, 7), origin = "https://oauth.test";
const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt"]), iv = crypto.getRandomValues(new Uint8Array(12));
const pending = { owner, state: "fixture-state", verifier: "fixture-verifier-abcdefghijklmnopqrstuvwxyz1234567890", expiresAt: Date.now() + 600000, clientId: "app", redirectUri: `${origin}/api/allegro/auth/callback` };
const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode("allegro-oauth") }, key, new TextEncoder().encode(JSON.stringify(pending)));
const cookie = `__Host-wystawiacz-oauth=${encodeURIComponent(`${Buffer.from(iv).toString("base64")}.${Buffer.from(encrypted).toString("base64")}`)}`;
let mode = "ok", saved = "previous-connection", administrative = false, activeAdmin = true, audits = 0; const calls = [];
const mf = new Miniflare({ modules: true, compatibilityDate: "2026-05-15", compatibilityFlags: ["nodejs_compat"], script: bundled.outputFiles[0].text,
  bindings: { SUPABASE_SERVICE_ROLE_KEY: "fixture", NEXT_PUBLIC_SUPABASE_URL: "https://database.test", ALLEGRO_ENCRYPTION_KEY: raw.toString("base64"), ALLEGRO_CLIENT_ID: "app", ALLEGRO_CLIENT_SECRET: "private-app-secret", ALLEGRO_REDIRECT_URI: pending.redirectUri, ALLEGRO_PAIRING_ENFORCED: "true" },
  outboundService: async request => {
    const url = new URL(request.url); calls.push(url.href);
    if (url.href === "https://allegro.pl/auth/oauth/token") {
      assert.equal(request.method, "POST"); assert.equal(request.headers.get("Authorization"), null);
      const form = new URLSearchParams(await request.text()); assert.equal(form.get("code_verifier"), pending.verifier); assert.equal(form.get("client_id"), "app");
      if (mode === "redirect") return new Response(null, { status: 307, headers: { Location: "https://evil.test/private" } });
      if (mode === "token") return Response.json({ error: "invalid_grant", error_description: "private-provider-text" }, { status: 400 });
      return Response.json({ access_token: "private-new-access", refresh_token: "private-refresh", expires_in: 3600 });
    }
    if (url.href === "https://api.allegro.pl/me") { assert.equal(request.method, "GET"); return Response.json({ id: "123" }); }
    if (url.pathname === "/auth/v1/user") return Response.json({ id: owner });
    if (url.pathname === "/rest/v1/account_admins") return Response.json(administrative && activeAdmin ? [{ owner_id: owner }] : []);
    if (url.pathname === "/rest/v1/customer_accounts") { assert.equal(url.searchParams.get("owner_id"), `eq.${owner}`); return Response.json([{ owner_id: owner, suspended: false }]); }
    if (url.pathname === "/rest/v1/account_audit") {
      const row = await request.json(); assert.equal(row.actor_id, owner); assert.equal(row.target_id, owner); assert.equal(row.action, "allegro_admin_oauth"); assert.ok(!JSON.stringify(row).includes("private-"));
      if (mode === "audit") return new Response(null, { status: 503 });
      audits++; return new Response(null, { status: 201 });
    }
    if (url.pathname === "/rest/v1/allegro_connections" && request.method === "GET") { assert.equal(url.searchParams.get("owner_id"), `eq.${owner}`); return Response.json([{ sealed: saved }]); }
    if (url.href === "https://database.test/rest/v1/rpc/claim_allegro_seller") {
      assert.equal(request.method, "POST"); assert.deepEqual(await request.json(), { p_owner: owner, p_seller: "123" }); return Response.json(mode !== "binding");
    }
    assert.equal(url.href, "https://database.test/rest/v1/allegro_connections?on_conflict=owner_id", "No offer operations, foreign URLs or redirected credentials");
    assert.equal(request.method, "POST");
    const row = await request.json(); assert.equal(row.owner_id, owner); assert.ok(!JSON.stringify(row).includes("private-"));
    if (mode === "save") return Response.json({ message: "private-storage-error" }, { status: 503 });
    saved = row.sealed; return new Response(null, { status: 201 });
  },
});
try {
  for (const [failure, code] of [["ok", ""], ["token", "oauth_invalid_grant"], ["redirect", "oauth_token_rejected"], ["binding", "seller_not_allowed"], ["save", "oauth_connection_save"]]) {
    mode = failure; const previous = saved;
    const response = await mf.dispatchFetch(`${pending.redirectUri}?code=private-auth-code&state=${pending.state}`, { headers: { Cookie: cookie } });
    assert.equal(response.status, mode === "ok" ? 200 : 400);
    const html = await response.text(); assert.ok(!html.includes("private-")); assert.ok(!html.includes(pending.verifier));
    if (mode !== "ok") { assert.ok(html.includes(`code:"${code}"`)); assert.equal(saved, previous); }
  }
  const before = calls.length;
  const missing = await mf.dispatchFetch(`${pending.redirectUri}?code=private-auth-code&state=${pending.state}`);
  assert.ok((await missing.text()).includes('code:"oauth_cookie_missing"')); assert.equal(calls.length, before);
  administrative = true; mode = "audit"; const previous = saved;
  const failedAudit = await mf.dispatchFetch(`${pending.redirectUri}?code=private-auth-code&state=${pending.state}`, { headers: { Cookie: cookie } });
  assert.ok((await failedAudit.text()).includes('code:"oauth_admin_audit"')); assert.equal(saved, previous);
  mode = "ok";
  const bindingCalls = calls.filter(url => url.includes("claim_allegro_seller")).length;
  assert.equal((await mf.dispatchFetch(`${pending.redirectUri}?code=private-auth-code&state=${pending.state}`, { headers: { Cookie: cookie } })).status, 200);
  assert.equal(audits, 1); assert.equal(calls.filter(url => url.includes("claim_allegro_seller")).length, bindingCalls, "Admin consent does not claim another user's binding");
  const health = () => mf.dispatchFetch(`${origin}/api/allegro/health`, { headers: { Authorization: "Bearer fixture-user" } });
  const healthy = await health(); assert.equal(healthy.status, 200); assert.equal((await healthy.json()).adminMode, true);
  activeAdmin = false; assert.equal((await health()).status, 403, "Revoked admin cannot use the saved exception in real workerd");
  console.log("Allegro OAuth workerd: PKCE callback, AES-GCM session, explicit rejection stages, redirects blocked, previous connections preserved and no offer operations passed. All outbound services mocked.");
} finally { await mf.dispose(); }
