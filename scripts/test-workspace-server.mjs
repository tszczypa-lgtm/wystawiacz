import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString("base64")}`;
const validation = moduleUrl(await readFile(new URL("../lib/account-validation.ts", import.meta.url), "utf8"));
const account = moduleUrl((await readFile(new URL("../lib/account-api.ts", import.meta.url), "utf8")).replace('"./account-validation"', JSON.stringify(validation)));
const { accountAccess } = await import(account);
const pricing = moduleUrl(await readFile(new URL("../lib/price-comparison.ts", import.meta.url), "utf8"));
const { handleWorkspaceApi } = await import(moduleUrl((await readFile(new URL("../lib/workspace-api.ts", import.meta.url), "utf8")).replace('"./account-api"', JSON.stringify(account)).replace('"./price-comparison"', JSON.stringify(pricing))));
const { handleAllegroApi, sealConnection } = await import(moduleUrl(await readFile(new URL("../lib/allegro-api.ts", import.meta.url), "utf8")));
const owner = "00000000-0000-0000-0000-000000000001", other = "00000000-0000-0000-0000-000000000002";
const productId = "10000000-0000-0000-0000-000000000001";
const keyBytes = crypto.getRandomValues(new Uint8Array(32));
const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt", "decrypt"]);
let connection = await sealConnection({ clientId: "app", accessToken: "seller-token", refreshToken: "refresh", expiresAt: Date.now() + 3600000 }, key, owner);
const env = { SUPABASE_SERVICE_ROLE_KEY: "secret", ALLEGRO_ENCRYPTION_KEY: Buffer.from(keyBytes).toString("base64"), ALLEGRO_CLIENT_ID: "app", ALLEGRO_CLIENT_SECRET: "secret", ALLEGRO_REDIRECT_URI: "https://example.test/api/allegro/auth/callback", PUBLICATION_DEDUP_ENABLED: "true", ALLEGRO_PAIRING_ENFORCED: "true" };
const request = (path, method = "GET", payload, extra = {}) => new Request(`https://example.test${path}`, { method, headers: { Authorization: "Bearer user", Origin: "https://example.test", "Content-Type": "application/json", ...extra }, body: payload ? JSON.stringify(payload) : undefined });
const ledger = new Map(), calls = [];
let creationCount = 0, rejection = false, uncertain = false, recovered = false, storedDescriptionTemplate = null;
const previousFetch = globalThis.fetch;
globalThis.fetch = async (input, options = {}) => {
  const url = String(input); calls.push({ url, options });
  if (url.endsWith("/auth/v1/user")) return Response.json({ id: owner, email_confirmed_at: "2026-01-01" });
  if (url.includes("/rest/v1/customer_accounts")) return Response.json([{ owner_id: owner, suspended: false }]);
  if (url.includes("/rest/v1/account_admins")) return Response.json([]);
  if (url.includes("/rest/v1/workspace_preferences")) {
    if (options.method === "POST") {
      const body = JSON.parse(options.body); assert.equal(body.owner_id, owner); storedDescriptionTemplate = body.description_template;
      assert.ok(options.headers.Prefer.includes("return=representation"), "PostgREST upsert must return JSON, not an empty 201 response");
      return Response.json([{ description_template: storedDescriptionTemplate }], { status: 201 });
    }
    return Response.json([{ description_template: storedDescriptionTemplate }]);
  }
  if (url.includes("/rest/v1/workspace_sessions") || url.includes("/rest/v1/workspace_session_versions")) {
    assert.ok(url.includes(`owner_id=eq.${owner}`)); assert.ok(!url.includes(`owner_id=eq.${other}`)); return Response.json([]);
  }
  if (url.includes("/rpc/save_workspace_session")) {
    const body = JSON.parse(options.body); assert.equal(body.p_owner, owner); assert.equal(body.p_revision, 1); assert.equal(body.p_payload.products[0].image, undefined); return Response.json({ conflict: true });
  }
  if (url.includes("/rest/v1/allegro_connections")) {
    if (options.method === "POST") { connection = JSON.parse(options.body).sealed; return new Response(null, { status: 201 }); }
    return Response.json([{ sealed: connection }]);
  }
  if (url.includes("/rpc/claim_allegro_seller")) return Response.json(JSON.parse(options.body).p_seller === "123");
  if (url.includes("/rpc/claim_listing_publication")) {
    const body = JSON.parse(options.body); assert.equal(body.p_owner, owner);
    if (ledger.has(body.p_product)) return Response.json({ claimed: false, ...ledger.get(body.p_product) });
    ledger.set(body.p_product, { status: "pending", seller: "123" }); return Response.json({ claimed: true });
  }
  if (url.includes("/rest/v1/listing_publications")) {
    assert.ok(url.includes(`owner_id=eq.${owner}`)); const id = new URL(url).searchParams.get("product_id").slice(3);
    if (options.method === "DELETE") ledger.delete(id);
    if (options.method === "PATCH") ledger.set(id, { status: "done", id: JSON.parse(options.body).offer_id });
    return new Response(null, { status: 204 });
  }
  if (url.includes("/auth/oauth/token")) return Response.json({ access_token: "new-seller", refresh_token: "refresh", expires_in: 3600 });
  if (url.endsWith("/me")) return Response.json({ id: new Headers(options.headers).get("Authorization") === "Bearer new-seller" ? "987" : "123" });
  if (url.includes("/sale/shipping-rates?seller.id=")) { assert.ok(url.endsWith("seller.id=123")); return Response.json({ shippingRates: [{ id: "own", name: "Moj cennik", features: { managedByAllegro: false, isFulfillment: false } }] }); }
  if (url.includes("/sale/offers?offer.id=")) return Response.json({ offers: [] });
  if (url.includes("/sale/offers?external.id=")) return Response.json({ offers: recovered ? [{ id: "123456789" }] : [] });
  if (url.includes("/sale/offers?name=")) return Response.json({ offers: [{ id: "123456789", name: "Pompa 1234567" }] });
  if (url.endsWith("/sale/product-offers")) {
    creationCount++;
    if (uncertain) throw Error("Lost response");
    if (rejection) return Response.json({ errors: [{ userMessage: "Invalid data" }] }, { status: 400 });
    await new Promise(resolve => setTimeout(resolve, 30)); return Response.json({ id: "123456789" });
  }
  throw Error(`Unexpected request: ${url}`);
};
try {
  const trial = { suspended: false, access_mode: "standard", subscription_status: "none", trial_until: new Date(Date.now() + 86400000).toISOString() };
  assert.equal(accountAccess(trial, true).allowed, true);
  assert.equal(accountAccess({ ...trial, trial_until: "2020-01-01" }, true).allowed, false);
  assert.equal(accountAccess({ ...trial, suspended: true }, true, true).allowed, false);
  assert.equal((await handleWorkspaceApi(request("/api/workspace/sessions?owner_id=" + other), env)).status, 200);
  assert.equal((await handleWorkspaceApi(request("/api/workspace/price-comparison?number=https://evil.test"), env)).status, 400);
  assert.equal((await handleAllegroApi(request("/api/allegro/shipping-rates"), env)).status, 200);
  assert.equal((await handleWorkspaceApi(request(`/api/workspace/session?id=${productId}`), env)).status, 404);
  assert.equal((await handleWorkspaceApi(request("/api/workspace/session?id=bad"), env)).status, 400);
  const visualTemplate = JSON.stringify({ format: "wystawiacz-description-v2", text: "Uwagi\n{{TYTUL}}\n{{AUTO}}" });
  assert.equal((await handleWorkspaceApi(request("/api/workspace/preferences", "PUT", { descriptionTemplate: visualTemplate }), env)).status, 200);
  assert.equal((await (await handleWorkspaceApi(request("/api/workspace/preferences"), env)).json()).descriptionTemplate, visualTemplate);
  const duplicateTitle = JSON.stringify({ format: "wystawiacz-description-v2", text: "{{TYTUL}}\n{{TYTUL}}" });
  assert.equal((await handleWorkspaceApi(request("/api/workspace/preferences", "PUT", { descriptionTemplate: duplicateTitle }), env)).status, 400);
  assert.equal((await handleWorkspaceApi(request("/api/workspace/preferences", "PUT", { descriptionTemplate: "Stary opis\n{{AUTO}}" }), env)).status, 200);
  const templates = { format: "wystawiacz-description-templates-v3", selectedId: owner, templates: [
    { id: owner, name: "Pierwszy", text: "{{TYTUL}}\n{{AUTO}}" }, { id: other, name: "Drugi", text: "{{CZESC}}\n{{AUTO}}" },
  ] };
  assert.equal((await handleWorkspaceApi(request("/api/workspace/preferences", "PUT", { descriptionTemplate: JSON.stringify(templates) }), env)).status, 200);
  assert.equal((await (await handleWorkspaceApi(request("/api/workspace/preferences"), env)).json()).descriptionTemplate, JSON.stringify(templates));
  assert.equal((await handleWorkspaceApi(request("/api/workspace/preferences", "PUT", { descriptionTemplate: JSON.stringify({ ...templates, selectedId: "invalid" }) }), env)).status, 400);
  assert.equal((await handleWorkspaceApi(request("/api/workspace/preferences", "PUT", { descriptionTemplate: JSON.stringify({ ...templates, templates: [templates.templates[0], templates.templates[0]] }) }), env)).status, 400);
  const expressions = { format: templates.format, templates: [], selectedId: null, snippets: [{ id: owner, name: "Sprawdzone", text: "Czesc sprawdzona na aucie." }] };
  assert.equal((await handleWorkspaceApi(request("/api/workspace/preferences", "PUT", { descriptionTemplate: JSON.stringify(expressions) }), env)).status, 200);
  assert.equal((await (await handleWorkspaceApi(request("/api/workspace/preferences"), env)).json()).descriptionTemplate, JSON.stringify(expressions));
  for (const snippets of [[...expressions.snippets, ...expressions.snippets], [{ ...expressions.snippets[0], text: "{{AUTO}}" }], [{ ...expressions.snippets[0], name: "" }], [{ ...expressions.snippets[0], text: "x".repeat(2001) }]]) {
    assert.equal((await handleWorkspaceApi(request("/api/workspace/preferences", "PUT", { descriptionTemplate: JSON.stringify({ ...expressions, snippets }) }), env)).status, 400);
  }
  const payload = { id: productId, revision: 1, payload: { format: "wystawiacz-allegro-session", products: [{ photoNames: [], image: "not stored" }] } };
  assert.equal((await handleWorkspaceApi(request("/api/workspace/session", "PUT", payload, { Origin: "https://evil.test" }), env)).status, 403);
  assert.equal((await handleWorkspaceApi(request("/api/workspace/session", "PUT", payload), env)).status, 409);
  assert.equal((await handleAllegroApi(request("/api/allegro/own-offers?number=1234567"), env)).status, 200);
  assert.equal((await handleAllegroApi(request("/api/allegro/own-offers/999999"), env)).status, 404, "Never fetch detail from another seller");
  const offer = { name: "Pompa ABS", productSet: [] };
  const publish = () => handleAllegroApi(request("/api/allegro/product-offers", "POST", { productId, offer }), env);
  const concurrent = await Promise.all([publish(), publish()]);
  assert.deepEqual(concurrent.map(r => r.status).sort(), [200, 409]); assert.equal(creationCount, 1);
  assert.equal((await (await publish()).json()).id, "123456789"); assert.equal(creationCount, 1);
  ledger.clear(); rejection = true; assert.equal((await publish()).status, 400); assert.equal(ledger.size, 0, "Definite rejection releases the claim");
  rejection = false; uncertain = true; assert.equal((await publish()).status, 500); assert.equal(ledger.size, 1);
  const count = creationCount; assert.equal((await publish()).status, 409); assert.equal(creationCount, count, "Ambiguous response never creates a duplicate");
  recovered = true;
  assert.equal((await (await publish()).json()).id, "123456789"); assert.equal(creationCount, count, "A lost response is recovered by technical reference, not by another POST");
  const start = await handleAllegroApi(request("/api/allegro/auth/start", "POST", {}), env);
  const auth = new URL((await start.json()).url), cookie = start.headers.get("Set-Cookie").split(";")[0], oldConnection = connection;
  const callback = await handleAllegroApi(new Request(`https://example.test/api/allegro/auth/callback?code=test&state=${auth.searchParams.get("state")}`, { headers: { Cookie: cookie } }), env);
  assert.equal(callback.status, 400); assert.equal(connection, oldConnection, "Rejected pairing preserves the existing encrypted connection");
  console.log("Workspace server: owner isolation, origin/validation, revision conflict, trial expiry, own-offer ownership, atomic claim mock concurrency/replay, uncertain publication and rejected seller pairing passed. No real SQL/API calls.");
} finally { globalThis.fetch = previousFetch; }
