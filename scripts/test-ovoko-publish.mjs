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
const { handleOvokoApi } = load(path.join(root, "lib/ovoko-api.ts"));
const { sealConnection } = load(path.join(root, "lib/allegro-api.ts"));
const keyBytes = new Uint8Array(32).fill(7), key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt", "decrypt"]);
const env = { BILLING_ENFORCED: "true", SUPABASE_SERVICE_ROLE_KEY: "fixture", ALLEGRO_ENCRYPTION_KEY: Buffer.from(keyBytes).toString("base64"), OVOKO_PUBLISH_ENABLED: "true" };
const credentials = { username: "fixture-account", password: "private-password", user_token: "private-token" };
let user = 1, admin, suspended, owns, stock, bundle, mode, donorModel, duplicate, failDb, sourceReads, lateStock, writes, categoryName, revokeAfterRead, imageMode, extraCodes, bulk, expectedPrice, credentialReads, rotateAt, ordinaryAccess = false;
let providerPresent, inventoryReads;
const owner = () => `00000000-0000-0000-0000-${String(user).padStart(12, "0")}`;
const records = new Map(), calls = [];
const snapshot = { title: "AUDI A4 POMPA 0281010038", price: "100.00", currency: "PLN", stock: 1, status: "ACTIVE", condition: "used", images: ["https://a.allegroimg.com/photo.jpg", "https://a.allegroimg.com/second.jpg", "https://a.allegroimg.com/label.jpg"] };
const payload = () => ({ offerId: "101", brandId: "1", modelId: "11", donorId: "13", categoryId: "3", qualityId: "0", statusId: "0", manufacturerCode: "0281010038", additionalCodes: extraCodes, price: "100.00", currency: "PLN", notes: "Opis & uwagi + numer", confirmSingle: true, expectedSource: { ...snapshot } });
const req = (body = payload(), headers = {}) => new Request("https://publish.test/api/ovoko/publish", { method: "POST", headers: { Authorization: "Bearer fixture", Origin: "https://publish.test", "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
function reset() {
  providerPresent = false; inventoryReads = 0;
  fitmentMode = "none";
  expectedCode = "0281010038";
  user++; admin = true; suspended = false; owns = true; stock = 1; bundle = false; mode = "ok"; donorModel = "11"; duplicate = false; failDb = ""; sourceReads = 0; lateStock = false; writes = 0; categoryName = "Pompy"; revokeAfterRead = false; imageMode = "normal"; extraCodes = ""; bulk = false; expectedPrice = "100.00"; credentialReads = 0; rotateAt = Infinity; records.clear(); calls.length = 0;
}
const originalFetch = globalThis.fetch;
let vehicleParams = [], preparedVehicle, generationTest = false, fitmentMode = "none", expectedCode = "0281010038", hyphenCode = "";
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(input), method = options.method || "GET";
  calls.push({ url: url.href, method });
  if (url.pathname === "/auth/v1/user") return Response.json({ id: owner(), email_confirmed_at: "2026-01-01" });
  if (url.pathname === "/rest/v1/customer_accounts") return Response.json([{ owner_id: owner(), company: {}, suspended, access_mode: ordinaryAccess ? "free" : "standard", free_until: null }]);
  if (url.pathname === "/rest/v1/account_admins") return Response.json(admin ? [{ owner_id: owner() }] : []);
  if (url.pathname === "/rest/v1/allegro_connections") return Response.json([{ sealed: await sealConnection({ accessToken: "seller-token", expiresAt: Date.now() + 3600000 }, key, owner()) }]);
  if (url.pathname === "/rest/v1/ovoko_connections") { credentialReads++; return Response.json([{ sealed: await sealConnection({ ...credentials, ...(credentialReads >= rotateAt ? { password: "private-changed" } : {}) }, key, `ovoko:v1:${owner()}`) }]); }
  if (url.pathname === "/rest/v1/ovoko_vehicle_creations") { assert.equal(method, "GET", "Bulk reuses the saved vehicle without creating a duplicate"); return Response.json([]); }
  if (url.pathname === "/rest/v1/ovoko_single_publications") {
    if (failDb === method) return new Response("private-db-error", { status: 503 });
    if (method === "POST") {
      assert.equal(new Headers(options.headers).get("Prefer"), "resolution=ignore-duplicates,return=representation");
      const row = JSON.parse(options.body); assert.equal(row.owner_id, owner());
      assert.ok(!options.body.includes("private-")); assert.ok(!options.body.includes("Opis"));
      const id = [row.ovoko_account, row.allegro_seller_id, row.allegro_offer_id].join(":");
      if (records.has(id)) return Response.json([]);
      records.set(id, row); return Response.json([row], { status: 201 });
    }
    if (!bulk || url.searchParams.has("owner_id")) assert.equal(url.searchParams.get("owner_id"), `eq.${owner()}`);
    const id = ["ovoko_account", "allegro_seller_id", "allegro_offer_id"].map(key => url.searchParams.get(key)?.slice(3)).join(":"), row = records.get(id);
    if (method === "GET") return Response.json(row?.owner_id === owner() ? [row] : []);
    assert.equal(method, "PATCH");
    const patch = JSON.parse(options.body);
    if (patch.state === "sending") {
      assert.equal(url.searchParams.get("state"), "eq.created");
      for (const field of ["part_id", "request_hash", "updated_at"]) assert.ok(url.searchParams.has(field), `CAS includes ${field}`);
      if (mode === "cas-race") row.state = "uncertain";
      if (mode === "cas-generation-race") row.updated_at = "2099-01-01T00:00:00Z";
      if (mode === "cas-hash-race") row.request_hash = "b".repeat(64);
    }
    if (!row || row.owner_id !== owner() || [...url.searchParams].some(([field, filter]) => filter.startsWith("eq.") && String(row[field]) !== filter.slice(3))) return Response.json([]);
    Object.assign(row, patch);
    if (patch.state === "created" && mode === "confirmation-empty") return new Response(null, { status: 204 });
    if (patch.state === "created" && mode === "confirmation-lost") throw new Error("private-db-error");
    if (patch.state === "created" && mode === "confirmation-wrong-hash") { row.state = "uncertain"; row.request_hash = "f".repeat(64); throw new Error("private-db-error"); }
    if (patch.state === "sending" && mode === "cas-no-representation") return new Response(null, { status: 204 });
    return Response.json([row]);
  }
  if (url.origin === "https://api.allegro.pl") {
    assert.equal(method, "GET", "Publishing to Ovoko never mutates Allegro");
    if (url.pathname === "/sale/offers") { assert.equal(url.searchParams.get("offer.id"), "101"); return Response.json({ offers: owns ? [{ id: "101" }] : [] }); }
    if (url.pathname === "/me") return Response.json({ id: "555" });
    if (url.pathname === "/sale/compatibility-list-suggestions") {
      assert.ok(url.searchParams.has("offer.id") || url.searchParams.has("product.id"));
      if (fitmentMode === "error") return Response.json({ errors: [{ message: "fixture-error" }] }, { status: 500 });
      return Response.json({ type: "MANUAL", items: fitmentMode === "suggestion" ? [{ type: "ID", text: "AUDI A4 2000/01-2010/12" }] : [] });
    }
    if (url.pathname === "/sale/products") {
      assert.equal(url.searchParams.get("phrase"), "0281010038"); assert.ok(["MPN", null].includes(url.searchParams.get("mode")));
      return Response.json({ products: fitmentMode.startsWith("catalog") ? [{ id: "11111111-1111-1111-1111-111111111111" }] : [] });
    }
    if (url.pathname === "/sale/products/11111111-1111-1111-1111-111111111111") return Response.json({ id: "11111111-1111-1111-1111-111111111111", name: fitmentMode === "catalog-title" ? "Pompa ABS AUDI A4 0281010038" : "Pompa ABS 0281010038", category: { id: fitmentMode === "catalog-wrong-category" ? "other" : "cat-1" }, parameters: [{ name: "Numer katalogowy czesci", values: [fitmentMode === "catalog-wrong-index" ? "0281010038A" : "0 281 010 038"] }, ...(fitmentMode === "catalog-parameters" ? [{ name: "Marka pojazdu", values: ["Audi"] }, { name: "Model pojazdu", values: ["A4"] }] : [])], compatibilityList: fitmentMode === "catalog-malformed" ? { items: "broken" } : { items: ["catalog-title", "catalog-parameters"].includes(fitmentMode) ? [] : [{ text: "AUDI A4 2000/01-2010/12" }] } });
    assert.equal(url.pathname, "/sale/product-offers/101"); sourceReads++;
    if (revokeAfterRead && sourceReads > 1) admin = false;
    const images = imageMode === "duplicates" ? [...snapshot.images, snapshot.images[0]] : imageMode === "unsafe" ? [...snapshot.images, "https://evil.test/private.jpg"] : imageMode === "changed" && sourceReads > 1 ? snapshot.images.slice(0, 1) : snapshot.images;
    return Response.json({ id: "101", name: snapshot.title, category: { id: "cat-1" }, ...(fitmentMode === "own" ? { compatibilityList: { items: [{ text: "AUDI A4 2000/01-2010/12" }] } } : {}), parameters: [{ id: "11323", valuesIds: ["11323_2"] }, ...vehicleParams], productSet: [{ quantity: { value: bundle ? 2 : 1 }, product: {} }], images, stock: { available: lateStock && sourceReads > 1 ? 0 : stock }, publication: { status: "ACTIVE" }, sellingMode: { price: { amount: mode === "price-format" && sourceReads > 1 ? "100" : mode === "price-change" && sourceReads > 1 ? "101.00" : "100.00", currency: "PLN" } } });
  }
  assert.equal(url.origin, "https://api.rrr.lt"); assert.equal(method, "POST"); assert.equal(options.redirect, "manual");
  const form = new URLSearchParams(options.body);
  for (const [key, value] of Object.entries(credentials)) assert.equal(form.get(key), value);
  if (url.pathname === "/get/categories") return Response.json({ status_code: "R200", list: [{ id: "3", parent_id: "0", level: "3", pl: categoryName }] });
  if (url.pathname === "/get/car_brands") return Response.json({ status_code: "R200", list: [{ id: "1", name: "Audi" }, { id: "2", name: "Volkswagen" }] });
  if (url.pathname === "/get/part_quality") return Response.json({ status_code: "R200", list: { "0": { pl: "Używany" } } });
  if (url.pathname === "/get/part_status") return Response.json({ status_code: "R200", list: { "0": { pl: "Na stanie" }, "2": { pl: "Sprzedano" } } });
  if (url.pathname === "/get/car_models/1") return Response.json({ status_code: "R200", list: [{ id: "11", brand: "1", name: generationTest ? "A4 (B8)" : "A4", year_start: "2000", year_end: "2010" }] });
  if (url.pathname === "/get/car_models/2") return Response.json({ status_code: "R200", list: [{ id: "22", brand: "2", name: "Golf", year_start: "2000", year_end: "2010" }] });
  if (url.pathname === "/v2/get/cars") {
    if (bulk && url.searchParams.has("model_ids")) { assert.equal(url.searchParams.get("model_ids"), donorModel); return Response.json({ status_code: "R200", data: [{ id: "13", car_model: donorModel, car_years: "2000" }], pagination: { page: 1, limit: 20, total_count: 1 } }); }
    assert.equal(url.searchParams.get("car_ids"), "13"); return Response.json({ status_code: "R200", data: [{ id: "13", car_model: donorModel }], pagination: { page: 1, limit: 1, total_count: 1 } });
  }
  if (url.pathname === "/v2/get/parts") {
    assert.equal(url.searchParams.has("part_ids"), false, "No undocumented filter can be trusted to prove absence");
    const external = url.searchParams.has("external_ids");
    if (external) assert.equal(url.searchParams.get("external_ids"), "tymo:555:101");
    else { inventoryReads++; assert.equal(url.searchParams.get("sort[id]"), "asc"); }
    if (mode === "presence-error") return new Response("private-provider-error", { status: 503 });
    if (mode === "presence-warning") return Response.json({ status_code: "R202", msg: "private-provider-error" });
    if (mode === "presence-malformed") return Response.json({ status_code: "R200", data: [] });
    if (!external && mode === "presence-large-inventory") {
      const page = Number(url.searchParams.get("page"));
      return Response.json({ status_code: "R200", data: Array.from({ length: Math.min(100, 1501 - (page - 1) * 100) }, (_, i) => ({ id: String(10000 + (page - 1) * 100 + i), external_id: null })), pagination: { page, limit: 100, total_count: 1501 } });
    }
    const present = providerPresent || (external ? mode === "presence-external-only" : mode === "presence-id-only" || (mode === "presence-reappeared" && inventoryReads >= 2));
    const data = present ? [{ id: external && mode === "presence-external-only" ? "99" : "77", external_id: mode === "presence-id-only" ? "changed" : "tymo:555:101" }] : duplicate ? [{ id: "99", external_id: "tymo:555:101" }] : [];
    if (mode === "presence-wrong-external") data.push({ id: "99", external_id: "private-wrong" });
    return Response.json({ status_code: "R200", data, pagination: { page: "1", limit: external ? "1" : "100", total_count: data.length } });
  }
  assert.equal(url.pathname, "/crm/importPart", "No arbitrary mutation, update, delete, status change, donor or warehouse operations");
  assert.equal(records.size, 1); assert.equal([...records.values()][0].state, "sending", "Durable reservation precedes every mutation");
  writes++;
  assert.equal(form.get("manufacturer_code"), expectedCode || null); assert.equal(form.get("car_id"), "13"); assert.equal(form.get("quality"), "0"); assert.equal(form.get("status"), "0");
  assert.equal(form.get("photo"), form.get("photos[0]")); assert.equal(form.get("original_currency"), "PLN"); assert.equal(form.get("price"), expectedPrice);
  assert.deepEqual([...form.entries()].filter(([name]) => /^photos\[\d+\]$/.test(name)).map(([, url]) => url), snapshot.images, "Transfer the complete gallery in source order, not just the thumbnail");
  assert.equal(form.get("notes"), "Opis & uwagi + numer"); assert.equal(form.get("place"), null); assert.equal(form.get("storage_id"), null);
  const expectedCodes = mode === "hyphen-main" ? [hyphenCode] : extraCodes.includes("JPLA-") ? ["JPLA14D617BA", "JPLA-14D617-BA"] : extraCodes ? ["A1649020300", "A1649004200BA"] : [];
  assert.deepEqual([...form.entries()].filter(([name]) => /^optional_codes\[\d+\]$/.test(name)).map(([, value]) => value), expectedCodes, "Additional numbers occupy separate fields, retaining suffixes and not duplicating the main number");
  if (mode === "timeout") throw new DOMException("private-provider-error", "TimeoutError");
  if (mode === "redirect") return new Response("private-provider-error", { status: 302, headers: { Location: "https://evil.test" } });
  if (mode === "bad") return Response.json({ status_code: "R400", msg: "private-provider-error" });
  if (mode === "http-error") return Response.json({ status_code: "R500", msg: "private-provider-error" }, { status: 503 });
  if (mode === "bad-json") return new Response("private-provider-error");
  if (mode === "transport") throw new Error("private-provider-error");
  if (mode === "unsafe-code") return Response.json({ status_code: "private-token", msg: "private-provider-error" });
  if (mode === "missing-id") return Response.json({ status_code: "R200" });
  providerPresent = true;
  return Response.json({ status_code: "R200", part_id: 77 });
};
try {
  reset(); assert.equal((await handleOvokoApi(req(), { ...env, OVOKO_PUBLISH_ENABLED: "false" })).status, 503); assert.equal(writes, 0);
  reset(); admin = false; assert.equal((await handleOvokoApi(req(), env)).status, 403); assert.equal(calls.some(call => call.url.includes("api.rrr.lt")), false);
  reset(); admin = false; ordinaryAccess = true; const ordinary = await handleOvokoApi(req(), env); assert.equal(ordinary.status, 200, await ordinary.text()); assert.equal(writes, 1, "Normal active account can publish its own part without administrator access"); ordinaryAccess = false;
  reset(); suspended = true; assert.equal((await handleOvokoApi(req(), env)).status, 403);
  reset(); assert.equal((await handleOvokoApi(req(payload(), { Origin: "https://evil.test" }), env)).status, 403);
  for (const changed of [{ confirmSingle: false }, { username: "other" }, { price: "0" }, { currency: "USD" }, { donorId: "../1" }, { photos: ["https://evil.test"] }]) {
    reset(); assert.equal((await handleOvokoApi(req({ ...payload(), ...changed }), env)).status, 400); assert.equal(writes, 0);
  }
  reset(); owns = false; assert.equal((await handleOvokoApi(req(), env)).status, 409); assert.equal(writes, 0);
  for (const quantity of [0, 2]) { reset(); stock = quantity; assert.equal((await handleOvokoApi(req(), env)).status, 409); assert.equal(writes, 0); }
  reset(); bundle = true; assert.equal((await handleOvokoApi(req(), env)).status, 409); assert.equal(writes, 0);
  reset(); imageMode = "unsafe"; assert.equal((await handleOvokoApi(req(), env)).status, 400); assert.equal(writes, 0);
  reset(); imageMode = "changed"; assert.equal((await handleOvokoApi(req(), env)).status, 409); assert.equal(writes, 0, "Never publish a partial gallery after the source changes");
  reset(); const changedSnapshot = payload(); changedSnapshot.expectedSource.price = "99.00"; assert.equal((await handleOvokoApi(req(changedSnapshot), env)).status, 409); assert.equal(writes, 0);
  reset(); donorModel = "12"; assert.equal((await handleOvokoApi(req(), env)).status, 400); assert.equal(writes, 0);
  reset(); duplicate = true; assert.equal((await handleOvokoApi(req(), env)).status, 409); assert.equal(writes, 0);
  reset(); categoryName = "Felgi"; assert.equal((await handleOvokoApi(req(), env)).status, 400); assert.equal(writes, 0);
  reset(); lateStock = true; assert.equal((await handleOvokoApi(req(), env)).status, 409); assert.equal(writes, 0, "Availability rechecked immediately before reservation");
  reset(); revokeAfterRead = true; assert.equal((await handleOvokoApi(req(), env)).status, 403); assert.equal(writes, 0, "Revoked admin privileges stop a pending publication");
  for (const method of ["GET", "POST"]) { reset(); failDb = method; assert.equal((await handleOvokoApi(req(), env)).status, 503); assert.equal(writes, 0, "Unavailable durable lock fails closed"); }
  reset(); const good = await handleOvokoApi(req(), env); assert.equal(good.status, 200, await good.clone().text());
  assert.deepEqual(await good.json(), { ok: true, partId: "77", alreadyCreated: false, visibilityConfirmed: false });
  assert.equal(writes, 1); assert.equal([...records.values()][0].state, "created");
  const replay = await handleOvokoApi(req(), env); assert.equal(replay.status, 200); assert.equal((await replay.json()).alreadyCreated, true); assert.equal(writes, 1);
  user++;
  assert.equal((await handleOvokoApi(req(), env)).status, 409, "Another Wystawiacz owner cannot bypass the target-account publication lock"); assert.equal(writes, 1);
  for (const presence of ["ok", "presence-external-only", "presence-id-only"]) {
    reset(); assert.equal((await handleOvokoApi(req(), env)).status, 200);
    providerPresent = presence === "ok"; mode = presence;
    const result = await handleOvokoApi(req(), env);
    assert.equal(result.status, 200, await result.clone().text());
    assert.equal((await result.json()).alreadyCreated, true); assert.equal(writes, 1);
    assert.equal([...records.values()][0].state, "created");
  }
  reset(); assert.equal((await handleOvokoApi(req(), env)).status, 200); providerPresent = false;
  const retransferred = await handleOvokoApi(req(), env);
  assert.equal(retransferred.status, 200, await retransferred.clone().text()); assert.equal((await retransferred.json()).alreadyCreated, false); assert.equal(writes, 2);
  assert.ok(inventoryReads >= 2, "Both initial and final absence checks inspect saved part ID before CAS");
  for (const failure of ["presence-error", "presence-warning", "presence-malformed", "presence-wrong-external", "presence-reappeared", "cas-race", "cas-generation-race", "cas-hash-race", "cas-no-representation"]) {
    reset(); assert.equal((await handleOvokoApi(req(), env)).status, 200); providerPresent = false; mode = failure;
    const response = await handleOvokoApi(req(), env);
    assert.ok([409, 502].includes(response.status), await response.clone().text());
    assert.doesNotMatch(await response.text(), /private-/); assert.equal(writes, 1, "Failed checks/CAS never import again");
    if (failure === "cas-no-representation" || failure === "cas-race") {
      assert.equal((await handleOvokoApi(req(), env)).status, 409); assert.equal(writes, 1, "Sending/uncertain CAS outcome stays locked");
    } else assert.equal([...records.values()][0].state, "created");
  }
  reset(); assert.equal((await handleOvokoApi(req(), env)).status, 200); providerPresent = false; credentialReads = 0; rotateAt = 2;
  assert.equal((await handleOvokoApi(req(), env)).status, 409); assert.equal(writes, 1); assert.equal([...records.values()][0].state, "created", "Account rotation cannot release a created record");
  reset(); assert.equal((await handleOvokoApi(req(), env)).status, 200); providerPresent = false;
  const oldHash = [...records.values()][0].request_hash;
  const concurrentRetransfers = await Promise.all([handleOvokoApi(req(), env), handleOvokoApi(req(), env)]);
  assert.equal(writes, 2, "Concurrent retransfers permit exactly one additional provider write");
  assert.ok(concurrentRetransfers.some(response => response.status === 200));
  assert.ok(concurrentRetransfers.every(response => [200, 409].includes(response.status)));
  assert.notEqual([...records.values()][0].request_hash, oldHash, "A fresh generation cannot match the old CAS even with the same payload and provider ID");
  reset(); imageMode = "duplicates"; assert.equal((await handleOvokoApi(req(), env)).status, 200); assert.equal(writes, 1, "Duplicate URLs do not block a full unique gallery");
  reset(); const formatted = payload(); formatted.expectedSource.price = "100"; assert.equal((await handleOvokoApi(req(formatted), env)).status, 200); assert.equal(writes, 1, "Equivalent decimal representations must not block publication");
  reset(); mode = "price-format"; assert.equal((await handleOvokoApi(req(), env)).status, 200); assert.equal(writes, 1, "The last source recheck also compares monetary value, not decimal spelling");
  reset(); mode = "price-change"; assert.equal((await handleOvokoApi(req(), env)).status, 409); assert.equal(writes, 0, "A true price change during recheck still blocks publication");
  reset(); extraCodes = "A1649020300\nA1649004200BA\nA1649020300\n0281010038"; assert.equal((await handleOvokoApi(req(), env)).status, 200); assert.equal(writes, 1);
  reset(); extraCodes = "JPLA14D617BA\nJPLA-14D617-BA\nJPLA-14D617-BA"; assert.equal((await handleOvokoApi(req(), env)).status, 200); assert.equal(writes, 1, "Both exact formatting variants reach separate optional_codes fields without losing the BA suffix");
  for (const code of ["0281-010-038", "8K0-959-793-BA", "DV4T-15K866-BJ"]) {
    reset(); mode = "hyphen-main"; hyphenCode = code; const before = snapshot.title; snapshot.title = `AUDI A4 POMPA ${code.replace(/-/g, "")} ${code}`; expectedCode = code.replace(/-/g, "");
    assert.equal((await handleOvokoApi(req({ ...payload(), manufacturerCode: code.replace(/-/g, "") }), env)).status, 200);
    assert.equal(writes, 1, "Actual importPart form carries compact manufacturer_code and hyphenated optional_codes separately, even from an older client"); snapshot.title = before;
  }
  for (const additionalCodes of [["A1649020300"], "<script>", Array.from({ length: 21 }, (_, index) => `CODE${100000 + index}`).join("\n")]) {
    reset(); assert.equal((await handleOvokoApi(req({ ...payload(), additionalCodes }), env)).status, 400); assert.equal(writes, 0);
  }
  reset(); const simultaneous = await Promise.all([handleOvokoApi(req(), env), handleOvokoApi(req(), env)]); assert.equal(writes, 1); assert.ok(simultaneous.some(response => response.status === 200));
  for (const failure of ["timeout", "transport", "redirect", "bad", "http-error", "bad-json", "unsafe-code", "missing-id", "log-failure", "confirmation-wrong-hash"]) {
    reset(); mode = failure; if (failure === "log-failure") failDb = "PATCH";
    const response = await handleOvokoApi(req(), env); assert.equal(response.status, 409);
    const message = await response.text(); assert.doesNotMatch(message, /private-/); assert.equal(writes, 1);
    const expected = { timeout: /Timeout/, transport: /Blad polaczenia/, redirect: /przekierowanie/, bad: /Kod R400/, "http-error": /HTTP 503.*Kod R500/, "bad-json": /JSON/, "unsafe-code": /kodem R200/, "missing-id": /odczyt part_id/, "log-failure": /zapis potwierdzenia.*ID 77/, "confirmation-wrong-hash": /zapis potwierdzenia/ };
    assert.match(message, expected[failure]);
    const retry = await handleOvokoApi(req(), env); assert.equal(retry.status, 409); assert.equal(writes, 1, "Never retry uncertain writes, including an unrecorded success");
  }
  for (const confirmation of ["confirmation-empty", "confirmation-lost"]) {
    reset(); mode = confirmation;
    const response = await handleOvokoApi(req(), env);
    assert.equal(response.status, 200, await response.clone().text()); assert.equal((await response.json()).partId, "77");
    assert.equal(writes, 1, "Lost confirmation response is recovered only by reading the durable journal");
    assert.equal([...records.values()][0].state, "created");
    assert.equal((await handleOvokoApi(req(), env)).status, 200); assert.equal(writes, 1);
  }
  const bulkReq = body => new Request("https://publish.test/api/ovoko/bulk", { method: "POST", headers: { Authorization: "Bearer fixture", Origin: "https://publish.test", "Content-Type": "application/json" }, body: JSON.stringify(body) });
  async function bulkPlan(adjustment) {
    const response = await handleOvokoApi(bulkReq({ operation: "start", adjustment }), env); assert.equal(response.status, 200, await response.clone().text());
    return { operation: "item", offerId: "101", adjustment, binding: (await response.json()).binding, notes: "Opis & uwagi + numer", expectedSource: { ...snapshot } };
  }
  async function bulkSend(item, checkBounds = true) {
    const before = calls.length;
    const preparation = await handleOvokoApi(bulkReq({ ...item, operation: "prepare" }), env);
    if (checkBounds) assert.ok(calls.length - before < 50, "Preparation uses a bounded separate Worker request");
    const data = await preparation.clone().json();
    preparedVehicle = data.vehicle;
    if (!preparation.ok || data.alreadyCreated) return preparation;
    assert.equal(data.category.id, data.prepared.categoryId); assert.ok(data.category.name, "Preparation returns the live category path for the success log");
    const ready = calls.length, result = await handleOvokoApi(bulkReq({ ...item, prepared: data.prepared }), env);
    if (checkBounds) assert.ok(calls.length - ready < 50, "Publication uses a bounded separate Worker request");
    return result;
  }
  reset(); bulk = true;
  const retransferPlan = await bulkPlan({ mode: "none", value: "0" });
  assert.equal((await bulkSend(retransferPlan)).status, 200); providerPresent = false;
  const beforePrepare = [...records.values()][0].request_hash;
  const prepareAgain = await handleOvokoApi(bulkReq({ ...retransferPlan, operation: "prepare" }), env);
  assert.equal(prepareAgain.status, 200, await prepareAgain.clone().text());
  assert.equal([...records.values()][0].state, "created"); assert.equal([...records.values()][0].request_hash, beforePrepare, "Preparation checks presence but never releases the existing record");
  mode = "presence-large-inventory";
  const bulkRetransfer = await bulkSend(retransferPlan);
  assert.equal(bulkRetransfer.status, 200, await bulkRetransfer.clone().text()); assert.equal((await bulkRetransfer.json()).alreadyCreated, false); assert.equal(writes, 2);
  for (const [adjustment, price] of [[{ mode: "none", value: "0" }, "100.00"], [{ mode: "percent", value: "-10" }, "90.00"], [{ mode: "amount", value: "+25.50" }, "125.50"], [{ mode: "fixed", value: "200" }, "200.00"]]) {
    reset(); bulk = true; expectedPrice = price; mode = "price-format";
    const item = await bulkPlan(adjustment); item.expectedSource.price = "100";
    const result = await bulkSend(item);
    assert.equal(result.status, 200, await result.clone().text()); assert.equal((await result.json()).price, price); assert.equal(writes, 1);
    const again = await bulkSend(item); assert.equal(again.status, 200); assert.equal((await again.json()).alreadyCreated, true); assert.equal(writes, 1);
  }
  reset(); bulk = true; const wrongBinding = await bulkPlan({ mode: "none", value: "0" }); wrongBinding.binding.fingerprint = "other";
  assert.equal((await handleOvokoApi(bulkReq(wrongBinding), env)).status, 409); assert.equal(writes, 0);
  reset(); bulk = true; const badPrice = await bulkPlan({ mode: "amount", value: "-100" }); assert.equal((await handleOvokoApi(bulkReq(badPrice), env)).status, 400); assert.equal(writes, 0); assert.equal(calls.some(call => call.url.includes("api.rrr.lt")), false);
  reset(); bulk = true; const outdated = await bulkPlan({ mode: "none", value: "0" }); outdated.expectedSource.price = "99.00"; assert.equal((await handleOvokoApi(bulkReq(outdated), env)).status, 409); assert.equal(writes, 0);
  reset(); bulk = true; categoryName = "Felgi"; const wheels = await bulkPlan({ mode: "none", value: "0" }); assert.equal((await bulkSend(wheels)).status, 400); assert.equal(writes, 0);
  reset(); bulk = true; const uncertain = await bulkPlan({ mode: "none", value: "0" }); mode = "timeout";
  assert.equal((await bulkSend(uncertain)).status, 409); assert.equal(writes, 1);
  const lockedPublication = await bulkSend(uncertain);
  assert.equal(lockedPublication.status, 409); assert.equal((await lockedPublication.json()).code, "publication_locked"); assert.equal(writes, 1);
  const lockedRow = [...records.values()][0];
  for (const state of ["sending", "uncertain"]) {
    lockedRow.state = state;
    const oldLock = JSON.stringify(lockedRow);
    const result = await bulkSend(uncertain);
    assert.equal(result.status, 409); assert.equal((await result.json()).code, "publication_locked");
    assert.equal(JSON.stringify(lockedRow), oldLock, "Continuing other jobs never clears or changes the locked journal row");
    assert.equal(writes, 1);
  }
  lockedRow.state = "broken";
  const invalidJournal = await bulkSend(uncertain);
  assert.equal(invalidJournal.status, 503); assert.equal((await invalidJournal.json()).code, undefined, "Malformed journal states must not be treated as a safe row-level lock"); assert.equal(writes, 1);
  reset(); bulk = true; const parallelItem = await bulkPlan({ mode: "none", value: "0" }); await Promise.all([bulkSend(parallelItem, false), bulkSend(parallelItem, false)]); assert.equal(writes, 1);
  for (const rotate of [3, 5]) {
    reset(); bulk = true; const item = await bulkPlan({ mode: "none", value: "0" }); rotateAt = rotate;
    assert.equal((await bulkSend(item)).status, 409); assert.equal(writes, 0, "Credential changes during preparation/publication stop the batch before a part write");
  }
  const originalTitle = snapshot.title;
  reset(); bulk = true; snapshot.title = "VW AUDI A4 POMPA 0281010038";
  const otherMake = await bulkPlan({ mode: "none", value: "0" });
  const otherResult = await bulkSend(otherMake); assert.equal(otherResult.status, 200, await otherResult.clone().text());
  assert.equal(preparedVehicle.brand, "Audi", "Try other mentioned makes for a recognizable model before using a fallback"); assert.equal(preparedVehicle.usedFallback, false);
  reset(); bulk = true; snapshot.title = "AUDI VW POMPA 0281010038";
  const noModel = await bulkPlan({ mode: "none", value: "0" });
  const missing = await bulkSend(noModel); assert.equal(missing.status, 400); const missingBody = await missing.json(); assert.match(missingBody.message, /Automat nie znalazl modelu/); assert.equal(missingBody.repair.needsVehicle, true); assert.equal(missingBody.repair.needsCategory, false); assert.equal(missingBody.repair.categoryId, "3"); assert.equal(writes, 0);
  reset(); bulk = true;
  const technicalPlan = { ...await bulkPlan({ mode: "none", value: "0" }), allowTechnicalModel: true };
  const technicalResult = await bulkSend(technicalPlan);
  assert.equal(technicalResult.status, 200, await technicalResult.clone().text()); assert.equal(writes, 1);
  assert.equal(preparedVehicle.brand, "Audi"); assert.match(preparedVehicle.evidence, /Model roboczy marki.*niepotwierdzona/);
  reset(); bulk = true; categoryName = "Nieznana kategoria";
  const correctedCategory = { ...await bulkPlan({ mode: "none", value: "0" }), allowTechnicalModel: true, overrides: { categoryId: "3", manufacturerCode: "0281010038" } };
  assert.equal((await bulkSend(correctedCategory)).status, 200); assert.equal(writes, 1, "Manual correction uses the same guarded publication flow");
  for (const overrides of [{ categoryId: "1" }, { categoryId: "999" }, { manufacturerCode: "brak" }, { place: "1" }, { categoryId: 3 }]) {
    reset(); bulk = true;
    const invalid = { ...await bulkPlan({ mode: "none", value: "0" }), overrides, allowTechnicalModel: true };
    assert.equal((await bulkSend(invalid)).status, 400); assert.equal(writes, 0);
  }
  for (const fitment of ["own", "suggestion", "catalog", "catalog-title", "catalog-parameters"]) {
    reset(); bulk = true; fitmentMode = fitment;
    const item = await bulkPlan({ mode: "none", value: "0" });
    const result = await bulkSend(item); assert.equal(result.status, 200, await result.clone().text());
    assert.equal(writes, 1); assert.equal(preparedVehicle.usedFallback, false); assert.equal(preparedVehicle.brand, "Audi");
    assert.match(preparedVehicle.evidence, fitment.startsWith("catalog") ? /pelny MPN/ : /Pasuje do/);
  }
  for (const fitment of ["catalog-wrong-index", "catalog-wrong-category", "catalog-malformed", "error"]) {
    reset(); bulk = true; fitmentMode = fitment;
    const item = await bulkPlan({ mode: "none", value: "0" });
    const result = await bulkSend(item); assert.equal(result.status, ["catalog-malformed", "error"].includes(fitment) ? 502 : 400); assert.equal(writes, 0);
  }
  for (const [fallbackVehicle, model, brand] of [[{ brandId: "1", modelId: "11" }, "11", "Audi"], [{ brandId: "2", modelId: "22" }, "22", "Volkswagen"]]) {
    reset(); bulk = true; donorModel = model;
    const item = { ...await bulkPlan({ mode: "none", value: "0" }), fallbackVehicle };
    const result = await bulkSend(item); assert.equal(result.status, 200, await result.clone().text()); assert.equal(writes, 1);
    assert.equal(preparedVehicle.brand, brand); assert.equal(preparedVehicle.usedFallback, true);
  }
  for (const fallbackVehicle of [{ brandId: "3", modelId: "33" }, { brandId: "1", modelId: "22" }, { brandId: "../1", modelId: "11" }]) {
    reset(); bulk = true; const item = { ...await bulkPlan({ mode: "none", value: "0" }), fallbackVehicle };
    assert.equal((await bulkSend(item)).status, 400); assert.equal(writes, 0, "Unmentioned brands, wrong model dictionaries and malformed overrides never publish");
  }
  reset(); bulk = true; vehicleParams = [{ name: "Marka pojazdu", values: ["Audi"] }];
  const explicit = { ...await bulkPlan({ mode: "none", value: "0" }), fallbackVehicle: { brandId: "2", modelId: "22" } };
  assert.equal((await bulkSend(explicit)).status, 400); assert.equal(writes, 0); vehicleParams = [];
  reset(); bulk = true; generationTest = true; snapshot.title = "AUDI A4 B9 POMPA 0281010038";
  const conflict = { ...await bulkPlan({ mode: "none", value: "0" }), fallbackVehicle: { brandId: "1", modelId: "11" }, allowTechnicalModel: true };
  assert.equal((await bulkSend(conflict)).status, 400); assert.equal(writes, 0, "A fallback cannot bypass an explicit conflicting generation");
  const technicalConflict = { ...await bulkPlan({ mode: "none", value: "0" }), allowTechnicalModel: true };
  assert.equal((await bulkSend(technicalConflict)).status, 400); assert.equal(writes, 0, "Technical models cannot bypass an explicit conflicting generation either"); generationTest = false;
  reset(); bulk = true; snapshot.title = originalTitle;
  const ignoredFallback = { ...await bulkPlan({ mode: "none", value: "0" }), fallbackVehicle: { brandId: "2", modelId: "22" } };
  assert.equal((await bulkSend(ignoredFallback)).status, 200); assert.equal(preparedVehicle.usedFallback, false); assert.equal(preparedVehicle.brand, "Audi");
  for (const manufacturerCode of [undefined, ""]) {
    reset(); expectedCode = "";
    const item = { ...payload(), manufacturerCode };
    const result = await handleOvokoApi(req(item), env); assert.equal(result.status, 200, await result.clone().text()); assert.equal(writes, 1);
    const replay = await handleOvokoApi(req(item), env); assert.equal(replay.status, 200); assert.equal((await replay.json()).alreadyCreated, true); assert.equal(writes, 1, "No-code parts keep the same source-offer duplicate lock");
  }
  for (const manufacturerCode of [null, "brak", "N/A", " ", "123", "<script>"]) {
    reset(); const result = await handleOvokoApi(req({ ...payload(), manufacturerCode }), env); assert.equal(result.status, 400); assert.equal(writes, 0, "Optional means absent, not accepting malformed or invented values");
  }
  for (const title of ["DRZWI LEWE AUDI A4", "ZDERZAK PRZEDNI AUDI A4"]) {
    reset(); bulk = true; expectedCode = ""; snapshot.title = title; categoryName = title.startsWith("DRZWI") ? "Drzwi" : "Zderzak przedni";
    const item = await bulkPlan({ mode: "none", value: "0" }), result = await bulkSend(item);
    assert.equal(result.status, 200, await result.clone().text()); assert.equal(writes, 1);
    assert.ok(!calls.some(call => call.url.includes("/sale/products?")), "No MPN lookup for an unknown number");
    assert.equal((await bulkSend(item)).status, 200); assert.equal(writes, 1);
  }
  reset(); bulk = true; expectedCode = ""; snapshot.title = "DRZWI AUDI"; categoryName = "Drzwi"; fitmentMode = "own";
  const noCodeFitment = await bulkPlan({ mode: "none", value: "0" });
  assert.equal((await bulkSend(noCodeFitment)).status, 200); assert.equal(writes, 1, "An owned compatibility list can select the model even without an OE number");
  assert.ok(!calls.some(call => call.url.includes("/sale/products?")));
  reset(); bulk = true; expectedCode = ""; snapshot.title = "DRZWI AUDI"; categoryName = "Drzwi";
  const missingCar = await bulkPlan({ mode: "none", value: "0" }); const blocked = await bulkSend(missingCar);
  assert.equal(blocked.status, 400); assert.match(await blocked.text(), /brakuje dopasowanego modelu/); assert.equal(writes, 0);
  snapshot.title = originalTitle;
  console.log("Ovoko single + bulk publication: guards, source/target binding, prices, multi-make model lookup, constrained fallback and generation/brand conflicts, car reuse, full photos, durable duplicate locks and uncertain no-retry passed. All services mocked; nothing published live.");
} finally { globalThis.fetch = originalFetch; }
