import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
const compiled = ts.transpileModule(readFileSync(new URL("../lib/allegro-api.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { handleAllegroApi, sealConnection, openConnection } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const admin = "00000000-0000-0000-0000-000000000001", normal = "00000000-0000-0000-0000-000000000002";
const raw = crypto.getRandomValues(new Uint8Array(32)), key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
const env = { SUPABASE_SERVICE_ROLE_KEY: "db-fixture", ALLEGRO_ENCRYPTION_KEY: Buffer.from(raw).toString("base64"), ALLEGRO_CLIENT_ID: "app", ALLEGRO_CLIENT_SECRET: "private-app-secret", ALLEGRO_REDIRECT_URI: "https://admin.test/api/allegro/auth/callback", ALLEGRO_PAIRING_ENFORCED: "true" };
let activeRole = true, suspended = false, failRoles = false, failAudit = false, seller = "122644437", counter = 0, refreshes = 0;
const connections = new Map(), tokens = new Map([["normal-access", "122644437"]]), audits = [], claims = [];
const bindings = new Map([["122644437", normal], ["145893185", normal]]), originalBindings = [...bindings];
connections.set(normal, await sealConnection({ clientId: "app", accessToken: "normal-access", refreshToken: "normal-refresh", expiresAt: Date.now() + 3600000 }, key, normal));
const normalConnection = connections.get(normal), originalFetch = globalThis.fetch;
let vendorCalls = 0;
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(input), headers = new Headers(options.headers), method = options.method || "GET";
  if (url.pathname === "/auth/v1/user") return Response.json({ id: headers.get("Authorization") === "Bearer normal" ? normal : admin });
  if (url.pathname === "/rest/v1/account_admins") {
    assert.equal(method, "GET"); assert.equal(headers.get("apikey"), env.SUPABASE_SERVICE_ROLE_KEY);
    if (failRoles) return Response.json({ message: "private-db-error" }, { status: 503 });
    return Response.json(activeRole && url.searchParams.get("owner_id") === `eq.${admin}` ? [{ owner_id: admin }] : []);
  }
  if (url.pathname === "/rest/v1/customer_accounts") {
    assert.equal(method, "GET"); assert.equal(url.searchParams.get("owner_id"), `eq.${admin}`);
    return Response.json([{ owner_id: admin, suspended }]);
  }
  if (url.pathname === "/rest/v1/account_audit") {
    assert.equal(method, "POST"); const row = JSON.parse(options.body);
    assert.equal(row.actor_id, admin); assert.equal(row.target_id, admin); assert.equal(row.action, "allegro_admin_oauth");
    assert.ok(row.reason.includes(seller)); assert.ok(!options.body.includes("private-"));
    if (failAudit) return Response.json({ message: "private-audit-error" }, { status: 503 });
    audits.push(row); return new Response(null, { status: 201 });
  }
  if (url.pathname === "/rest/v1/rpc/claim_allegro_seller") {
    const body = JSON.parse(options.body); claims.push(body);
    return Response.json(!suspended && bindings.get(body.p_seller) === body.p_owner);
  }
  if (url.pathname === "/rest/v1/allegro_connections") {
    if (method === "POST") { const row = JSON.parse(options.body); assert.ok([admin, normal].includes(row.owner_id)); connections.set(row.owner_id, row.sealed); return new Response(null, { status: 201 }); }
    const owner = url.searchParams.get("owner_id")?.slice(3); assert.ok([admin, normal].includes(owner));
    if (method === "DELETE") { connections.delete(owner); return new Response(null, { status: 204 }); }
    assert.equal(method, "GET"); return Response.json(connections.has(owner) ? [{ sealed: connections.get(owner) }] : []);
  }
  if (url.href === "https://allegro.pl/auth/oauth/token") {
    assert.equal(method, "POST"); const form = new URLSearchParams(options.body);
    const selected = form.get("grant_type") === "refresh_token" ? tokens.get(form.get("refresh_token")) : seller;
    if (form.get("grant_type") === "refresh_token") refreshes++; else { assert.equal(headers.get("Authorization"), null); assert.ok(form.get("code_verifier")); }
    const token = `private-token-${++counter}`, refresh = `private-refresh-${counter}`; tokens.set(token, selected); tokens.set(refresh, selected);
    return Response.json({ access_token: token, refresh_token: refresh, expires_in: 3600 });
  }
  assert.equal(url.href, "https://api.allegro.pl/me", "No offer mutation or other seller's data endpoint"); assert.equal(method, "GET");
  vendorCalls++; const id = tokens.get(headers.get("Authorization")?.slice(7)); assert.ok(id);
  return Response.json({ id });
};
const request = (path, owner = admin, method = "GET", body) => new Request(`https://admin.test/api/allegro${path}`, { method, headers: { Authorization: `Bearer ${owner === admin ? "admin" : "normal"}`, Origin: "https://admin.test", "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
async function callback(owner = admin, forged = false) {
  const pending = { owner, state: "test-state", expiresAt: Date.now() + 600000, clientId: "app", redirectUri: env.ALLEGRO_REDIRECT_URI, verifier: "test-verifier-abcdefghijklmnopqrstuvwxyz1234567890", ...(forged ? { isAdmin: true, authorizedAsAdmin: true } : {}) };
  const sealed = await sealConnection(pending, key, "allegro-oauth");
  return handleAllegroApi(new Request(`${env.ALLEGRO_REDIRECT_URI}?code=private-code&state=test-state&isAdmin=true`, { headers: { Cookie: `__Host-wystawiacz-oauth=${encodeURIComponent(sealed)}` } }), env);
}
try {
  assert.equal((await callback()).status, 200);
  let decoded = await openConnection(connections.get(admin), key, admin);
  assert.equal(decoded.authorizedAsAdmin, true); assert.equal(decoded.sellerId, seller); assert.equal(audits.length, 1); assert.equal(claims.length, 0, "Admin login does not claim or transfer ordinary seller bindings");
  assert.equal(connections.get(normal), normalConnection); assert.deepEqual([...bindings], originalBindings);
  seller = "145893185"; assert.equal((await callback()).status, 200); assert.equal((await openConnection(connections.get(admin), key, admin)).sellerId, seller);
  assert.equal(connections.get(normal), normalConnection); assert.deepEqual([...bindings], originalBindings);
  seller = "999999999"; assert.equal((await callback()).status, 200); assert.deepEqual([...bindings], originalBindings, "An unbound seller also remains unclaimed by the administrator");
  assert.equal((await (await handleAllegroApi(request("/me"), env)).json()).id, seller);
  decoded = await openConnection(connections.get(admin), key, admin); decoded.expiresAt = 0; connections.set(admin, await sealConnection(decoded, key, admin));
  assert.equal((await handleAllegroApi(request("/me"), env)).status, 200); assert.equal(refreshes, 1);
  assert.equal((await openConnection(connections.get(admin), key, admin)).authorizedAsAdmin, true, "Refresh preserves the admin-only connection marker");
  failRoles = true; const beforeRoleFailure = vendorCalls;
  assert.equal((await handleAllegroApi(request("/me"), env)).status, 503); assert.equal(vendorCalls, beforeRoleFailure, "A role lookup outage never falls back to using the admin token"); failRoles = false;
  const previous = connections.get(admin), beforeRevocation = vendorCalls;
  activeRole = false;
  assert.equal((await handleAllegroApi(request("/me"), env)).status, 403); assert.equal((await handleAllegroApi(request("/health"), env)).status, 403);
  assert.equal(vendorCalls, beforeRevocation, "Revoked admin connection is blocked before token use");
  assert.equal((await handleAllegroApi(request("/auth/start", admin, "POST", {}), env)).status, 200, "Revoked admin may start a new ordinary OAuth flow, without reusing prior token");
  assert.equal((await callback(admin, true)).status, 400); assert.equal(connections.get(admin), previous, "Client flags cannot restore revoked privileges");
  activeRole = true;
  seller = "not-a-number"; assert.equal((await callback()).status, 400); seller = "122644437";
  failRoles = true; const failed = await callback(); assert.equal(failed.status, 400); assert.ok((await failed.text()).includes("oauth_admin_check")); failRoles = false;
  failAudit = true; const unaudited = await callback(); assert.equal(unaudited.status, 400); assert.ok((await unaudited.text()).includes("oauth_admin_audit")); failAudit = false;
  assert.equal(connections.get(admin), previous, "Role/audit failures never replace the connection");
  suspended = true; assert.equal((await handleAllegroApi(request("/me"), env)).status, 403); assert.equal((await callback()).status, 400); suspended = false;
  seller = "145893185"; const normalBefore = connections.get(normal);
  bindings.set(seller, admin); const denied = await callback(normal, true); assert.equal(denied.status, 400); assert.ok((await denied.text()).includes("seller_not_allowed")); assert.equal(connections.get(normal), normalBefore);
  bindings.set(seller, normal); assert.equal((await callback(normal)).status, 200); assert.equal((await openConnection(connections.get(normal), key, normal)).authorizedAsAdmin, undefined);
  const forgedStart = await handleAllegroApi(request("/auth/start", normal, "POST", { owner: admin, isAdmin: true }), env);
  assert.equal(forgedStart.status, 200);
  const stateCookie = decodeURIComponent(forgedStart.headers.get("Set-Cookie").split(";")[0].slice("__Host-wystawiacz-oauth=".length));
  assert.equal((await openConnection(stateCookie, key, "allegro-oauth")).owner, normal, "OAuth session owner always comes from authenticated identity, not request body");
  assert.deepEqual([...bindings], originalBindings);
  activeRole = false; assert.equal((await handleAllegroApi(request("/auth/logout", admin, "POST", {}), env)).status, 200, "Revoked admin can delete own saved connection");
  assert.ok(connections.has(normal));
  console.log("Admin Allegro: OAuth consent, server role/suspension checks, any seller without binding transfer, audit-required save, isolated ciphertext, role revocation, refresh marker, forged flags and ordinary-user restrictions passed. All external calls mocked.");
} finally { globalThis.fetch = originalFetch; }
