import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import vm from "node:vm";

const source = await readFile(new URL("../lib/allegro-api.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { handleAllegroApi, sealConnection, openConnection } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const rawKey = crypto.getRandomValues(new Uint8Array(32));
const key = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["encrypt", "decrypt"]);
const env = { SUPABASE_SERVICE_ROLE_KEY: "server-only", ALLEGRO_ENCRYPTION_KEY: Buffer.from(rawKey).toString("base64"), ALLEGRO_CLIENT_ID: "app", ALLEGRO_CLIENT_SECRET: "shared-server-secret", ALLEGRO_REDIRECT_URI: "https://example.test/api/allegro/auth/callback" };
const owner = "00000000-0000-0000-0000-000000000001";
const connection = { clientId: "app", clientSecret: "secret", accessToken: "allegro-access", refreshToken: "refresh", expiresAt: Date.now() + 3600000 };
const sealed = await sealConnection(connection, key, owner);
assert.deepEqual(await openConnection(sealed, key, owner), connection);
assert.ok(!sealed.includes("secret"));
await assert.rejects(openConnection(sealed, key, "different-user"));
const request = (path, options = {}) => new Request(`https://example.test/api/allegro${path}`, { ...options, headers: { Authorization: "Bearer user-session", ...options.headers } });
assert.equal((await handleAllegroApi(new Request("https://example.test/api/allegro/health"), env)).status, 401);
assert.equal((await handleAllegroApi(request("/health"), {})).status, 503);

const originalFetch = globalThis.fetch;
let saved = sealed;
let deleted = false;
let remoteCalls = [];
let tokenCalls = [];
let imageStatus = 200;
globalThis.fetch = async (url, options = {}) => {
  url = String(url);
  const headers = new Headers(options.headers);
  if (url.endsWith("/auth/v1/user")) {
    assert.equal(headers.get("Authorization"), "Bearer user-session");
    return Response.json({ id: owner });
  }
  if (url.includes("/rest/v1/allegro_connections")) {
    assert.equal(headers.get("apikey"), "server-only");
    if (options.method === "POST") {
      const value = JSON.parse(options.body);
      assert.equal(value.owner_id, owner);
      saved = value.sealed;
      return new Response(null, { status: 201 });
    }
    assert.ok(url.includes(`owner_id=eq.${owner}`));
    if (options.method === "DELETE") { deleted = true; return new Response(null, { status: 204 }); }
    return Response.json([{ sealed: saved }]);
  }
  if (url.includes("/auth/oauth/token")) {
    tokenCalls.push({ headers, form: new URLSearchParams(options.body) });
    return Response.json({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 });
  }
  assert.ok(url.startsWith("https://api.allegro.pl/") || url.startsWith("https://upload.allegro.pl/"));
  assert.ok(headers.get("Authorization").startsWith("Bearer "));
  assert.notEqual(headers.get("Authorization"), "Bearer user-session");
  remoteCalls.push({ url, options });
  if (url.startsWith("https://upload.allegro.pl/") && imageStatus !== 200) return Response.json({ errors: [{ userMessage: "Za duzo zapytan" }] }, { status: imageStatus, headers: { "Retry-After": "60" } });
  if (url.endsWith("/me")) return Response.json({ id: "seller" });
  if (url.endsWith("/sale/categories/123")) return Response.json({ id: "123", name: "Parts", parent: null });
  return Response.json({ ok: true, id: "test-offer" });
};
try {
  assert.equal((await (await handleAllegroApi(request("/health"), env)).json()).connected, true);
  assert.equal((await handleAllegroApi(request("/auth/credentials"), env)).status, 404);
  for (const path of ["/me", "/shipping-rates", "/return-policies", "/implied-warranties", "/warranties", "/responsible-producers", "/responsible-persons", "/matching-categories?name=door", "/categories?parentId=123", "/category-parameters/123", "/category-path?id=123"]) {
    assert.equal((await handleAllegroApi(request(path), env)).status, 200, path);
  }
  assert.equal((await handleAllegroApi(request("/category-parameters/../../me"), env)).status, 404);
  assert.equal((await handleAllegroApi(request("/unknown"), env)).status, 404);
  const post = (path, data) => handleAllegroApi(request(path, { method: "POST", body: JSON.stringify(data) }), env);
  assert.equal((await post("/upload-image", { image: { base64: Buffer.from("image").toString("base64"), contentType: "image/jpeg" } })).status, 200);
  const binary = Uint8Array.from([0, 1, 127, 128, 255]);
  const binaryPost = (body, headers = {}) => handleAllegroApi(request("/upload-image", { method: "POST", body, headers: { "Content-Type": "image/jpeg", ...headers } }), env);
  assert.equal((await binaryPost(binary)).status, 200);
  assert.deepEqual(new Uint8Array(remoteCalls.at(-1).options.body), binary, "Binary image bytes stay unchanged");
  assert.equal(new Headers(remoteCalls.at(-1).options.headers).get("Content-Type"), "image/jpeg");
  assert.equal((await binaryPost(binary, { "Content-Length": String(21 * 1024 * 1024) })).status, 413);
  assert.equal((await binaryPost(new Uint8Array())).status, 413);
  imageStatus = 429;
  const limited = await binaryPost(binary);
  assert.equal(limited.status, 429);
  assert.match((await limited.json()).message, /60 sekundach/);
  imageStatus = 200;
  assert.equal((await post("/product-offers", { offerBase64: Buffer.from(JSON.stringify({ name: "Test" })).toString("base64") })).status, 200);
  assert.equal((await post("/auth/device", { clientId: "app", clientSecret: "secret" })).status, 404);
  const start = await post("/auth/start", {});
  assert.equal(start.status, 200);
  const authorize = new URL((await start.json()).url);
  assert.equal(authorize.origin, "https://allegro.pl");
  assert.equal(authorize.searchParams.get("prompt"), "confirm");
  assert.equal(authorize.searchParams.get("code_challenge_method"), "S256");
  assert.ok(!authorize.href.includes("secret"));
  const setCookie = start.headers.get("Set-Cookie");
  assert.ok(setCookie.includes("HttpOnly; Secure; SameSite=Lax"));
  const cookieHeader = setCookie.split(";")[0];
  const pending = await openConnection(decodeURIComponent(cookieHeader.split("=")[1]), key, "allegro-oauth");
  const expectedChallenge = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pending.verifier))).toString("base64url");
  assert.equal(authorize.searchParams.get("code_challenge"), expectedChallenge);
  const callback = (state, cookieValue = cookieHeader, extra = "") => handleAllegroApi(new Request(`${env.ALLEGRO_REDIRECT_URI}?code=authorization-code&state=${state}${extra}`, { headers: { Cookie: cookieValue } }), env);
  const before = tokenCalls.length;
  assert.equal((await callback("wrong-state")).status, 400);
  assert.equal((await callback(pending.state, "")).status, 400);
  assert.equal((await callback(pending.state, cookieHeader, "&error=access_denied")).status, 400);
  assert.equal(tokenCalls.length, before);
  const invalidCookie = "__Host-wystawiacz-oauth=" + encodeURIComponent(await sealConnection({ ...pending, expiresAt: 0 }, key, "allegro-oauth"));
  assert.equal((await callback(pending.state, invalidCookie)).status, 400);
  const result = await callback(pending.state);
  assert.equal(result.status, 200);
  assert.ok(result.headers.get("Set-Cookie").includes("Max-Age=0"));
  assert.ok(!(await result.text()).includes("new-access"));
  const exchange = tokenCalls.at(-1);
  assert.equal(exchange.form.get("grant_type"), "authorization_code");
  assert.equal(exchange.form.get("code_verifier"), pending.verifier);
  assert.equal(exchange.form.get("client_id"), "app");
  assert.equal(exchange.headers.get("Authorization"), null);
  assert.equal((await openConnection(saved, key, owner)).accessToken, "new-access");
  assert.equal((await openConnection(saved, key, owner)).clientSecret, "");
  assert.equal((await post("/auth/logout", {})).status, 200);
  assert.ok(deleted);
  assert.ok(remoteCalls.some(call => call.url.includes("seller.id=seller")));
  saved = await sealConnection({ ...connection, expiresAt: 0 }, key, owner);
  assert.equal((await handleAllegroApi(request("/me"), env)).status, 200);
  assert.equal((await openConnection(saved, key, owner)).accessToken, "new-access");
  globalThis.fetch = async () => Response.json({ error: "invalid JWT" }, { status: 401 });
  assert.equal((await handleAllegroApi(request("/health"), env)).status, 401);
} finally { globalThis.fetch = originalFetch; }

const html = await readFile(new URL("../public/wystawiacz/index.html", import.meta.url), "utf8");
const app = await readFile(new URL("../public/wystawiacz/app.js", import.meta.url), "utf8");
const ast = ts.createSourceFile("app.js", app, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const automaticFunctions = ast.statements.filter(ts.isFunctionDeclaration).map(fn => fn.getText(ast)).join("\n");
const offline = vm.createContext({
  state: { appendedPartNumber: "", vehicles: [{ id: "golf", full: "Volkswagen Golf VII" }], selectedVehicleId: "golf", descriptionManuallyEdited: false, requiredParameters: [], parameterValues: {} },
  partNumber: { value: "5G0907044G" }, titleInput: { value: "" }, partNumberHint: { textContent: "" },
  suggestionPanel: { classList: { remove() {} } }, summaryCard: { classList: { remove() {} } },
});
vm.runInContext(automaticFunctions, offline);
vm.runInContext("updateSummary = () => {}; scheduleAllegroCategoryLookup = () => {};", offline);
vm.runInContext("appendPartNumberToTitle(); updatePartNumberHint();", offline);
assert.equal(offline.titleInput.value, "", "A part number alone must not invent a title");
assert.ok(offline.partNumberHint.textContent.includes("Teraz wpisz nazwę części"));
offline.titleInput.value = "Panel klimatyzacji VW Golf";
vm.runInContext("appendPartNumberToTitle(); appendPartNumberToTitle(); updateAutomaticDescriptionText();", offline);
assert.equal(offline.titleInput.value, "Panel klimatyzacji VW Golf 5G0907044G");
assert.ok(offline.state.descriptionText.includes("Pasuje do: Volkswagen Golf VII"));
offline.state.descriptionManuallyEdited = true;
offline.state.descriptionText = "Własny opis";
vm.runInContext("updateAutomaticDescriptionText();", offline);
assert.equal(offline.state.descriptionText, "Własny opis");
offline.connectionTitle = { textContent: "" };
offline.connectionDescription = { textContent: "" };
offline.apiRequest = async () => ({ id: "seller", login: "TymoGarage", company: { name: "Tymo Garage" } });
await vm.runInContext("refreshConnectedAccountInfo()", offline);
assert.equal(offline.connectionTitle.textContent, "Połączono z Allegro: TymoGarage");
offline.apiRequest = async () => { throw new Error("Disconnected"); };
await vm.runInContext("refreshConnectedAccountInfo()", offline);
assert.equal(offline.connectionTitle.textContent, "Konto Allegro połączone", "Do not show a stale seller name when account lookup fails");
offline.state.requiredParameters = [{ id: "condition", name: "Stan", type: "dictionary", dictionary: [{ id: "used", value: "Używany" }] }];
vm.runInContext('applyAutomaticParameterValues("Volkswagen");', offline);
assert.equal(offline.state.parameterValues.condition, "used");
const dashboard = await readFile(new URL("../app/panel/page.tsx", import.meta.url), "utf8");
const offers = await readFile(new URL("../app/panel/offers/page.tsx", import.meta.url), "utf8");
assert.ok(dashboard.includes('href="/panel/offers"'));
assert.ok(!dashboard.includes("<OriginalWystawiacz"));
assert.ok(offers.includes("<OriginalWystawiacz"));
console.log("Offline automatics: number/title, description, manual edits and condition passed; account and offers routes separated.");
for (const match of app.matchAll(/document\.querySelector\("#([^\"]+)"\)/g)) assert.ok(html.includes(`id="${match[1]}"`), match[1]);
assert.ok(!app.includes('confirm(`Wystawić tę jedną aukcję'), "Publication does not ask for confirmation");
assert.ok(!html.includes("clientSecretInput"));
assert.ok(!app.includes("/api/auth/device"));
const originalDirectory = new URL("../../outputs/allegro-assistant/", import.meta.url);
try {
  const originalApp = await readFile(new URL("app.js", originalDirectory), "utf8");
  const functions = (text) => {
    const ast = ts.createSourceFile("app.js", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    return new Map(ast.statements.filter(ts.isFunctionDeclaration).map(fn => [fn.name.text, fn.getText(ast).replace(/\r\n/g, "\n")]));
  };
  const portFunctions = functions(app);
  const listingFunctions = ["renderProducts", "splitOfferParameters"];
  for (const [name, implementation] of functions(originalApp)) {
    if (![...listingFunctions, "apiRequest", "checkConnectionStatus", "checkLoginStatus", "refreshConnectedAccountInfo", "closeConnectionModal", "prefillAllegroCredentials", "renderPhotos", "saveSession", "loadSession", "uploadProductImages", "publishProduct", "updateSummary", "validateProductBeforePublish", "resetForm", "addVehicle", "renderVehicles", "applyAutomaticParameterValues", "loadCategoryDetails", "renderRequiredParameters", "loadComplianceData", "renderDescriptionPreview", "buildAllegroOfferPayload", "findResponsibleProducerForProduct", "editProduct", "saveActiveProductDraft"].includes(name)) assert.equal(portFunctions.get(name), implementation, `Original function changed: ${name}`);
  }
  const originalCss = await readFile(new URL("styles.css", originalDirectory), "utf8");
  const portCss = await readFile(new URL("../public/wystawiacz/styles.css", import.meta.url), "utf8");
  assert.equal(portCss, originalCss);
  console.log("Original source parity: styling and business functions unchanged except web auth and photo rotation integration.");
} catch (error) { if (error.code !== "ENOENT") throw error; }
console.log("Allegro port: encryption, user isolation, auth, routes, OAuth, image/offer mock calls and original DOM checks passed. No live requests.");
