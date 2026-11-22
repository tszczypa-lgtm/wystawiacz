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
const env = { SUPABASE_SERVICE_ROLE_KEY: "fixture", ALLEGRO_ENCRYPTION_KEY: Buffer.from(keyBytes).toString("base64"), OVOKO_PUBLISH_ENABLED: "true" };
const credentials = { username: "fixture-account", password: "private-password", user_token: "private-token" };
let user = 1, admin, suspended, owns, stock, bundle, mode, donorModel, duplicate, failDb, sourceReads, lateStock, writes, categoryName, revokeAfterRead, imageMode, extraCodes, bulk, expectedPrice, credentialReads, rotateAt;
const owner = () => `00000000-0000-0000-0000-${String(user).padStart(12, "0")}`;
const records = new Map(), calls = [];
const snapshot = { title: "AUDI A4 POMPA 0281010038", price: "100.00", currency: "PLN", stock: 1, status: "ACTIVE", condition: "used", images: ["https://a.allegroimg.com/photo.jpg", "https://a.allegroimg.com/second.jpg", "https://a.allegroimg.com/label.jpg"] };
const payload = () => ({ offerId: "101", brandId: "1", modelId: "11", donorId: "13", categoryId: "3", qualityId: "0", statusId: "0", manufacturerCode: "0281010038", additionalCodes: extraCodes, price: "100.00", currency: "PLN", notes: "Opis & uwagi + numer", confirmSingle: true, expectedSource: { ...snapshot } });
const req = (body = payload(), headers = {}) => new Request("https://publish.test/api/ovoko/publish", { method: "POST", headers: { Authorization: "Bearer fixture", Origin: "https://publish.test", "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
function reset() {
  user++; admin = true; suspended = false; owns = true; stock = 1; bundle = false; mode = "ok"; donorModel = "11"; duplicate = false; failDb = ""; sourceReads = 0; lateStock = false; writes = 0; categoryName = "Pompy"; revokeAfterRead = false; imageMode = "normal"; extraCodes = ""; bulk = false; expectedPrice = "100.00"; credentialReads = 0; rotateAt = Infinity; records.clear(); calls.length = 0;
}
const originalFetch = globalThis.fetch;
let vehicleParams = [], preparedVehicle, generationTest = false;
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(input), method = options.method || "GET";
  calls.push({ url: url.href, method });
  if (url.pathname === "/auth/v1/user") return Response.json({ id: owner(), email_confirmed_at: "2026-01-01" });
  if (url.pathname === "/rest/v1/customer_accounts") return Response.json([{ owner_id: owner(), company: {}, suspended }]);
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
    if (!row || row.owner_id !== owner() || (url.searchParams.has("state") && url.searchParams.get("state") !== `eq.${row.state}`)) return Response.json([]);
    Object.assign(row, JSON.parse(options.body)); return Response.json([row]);
  }
  if (url.origin === "https://api.allegro.pl") {
    assert.equal(method, "GET", "Publishing to Ovoko never mutates Allegro");
    if (url.pathname === "/sale/offers") { assert.equal(url.searchParams.get("offer.id"), "101"); return Response.json({ offers: owns ? [{ id: "101" }] : [] }); }
    if (url.pathname === "/me") return Response.json({ id: "555" });
    assert.equal(url.pathname, "/sale/product-offers/101"); sourceReads++;
    if (revokeAfterRead && sourceReads > 1) admin = false;
    const images = imageMode === "duplicates" ? [...snapshot.images, snapshot.images[0]] : imageMode === "unsafe" ? [...snapshot.images, "https://evil.test/private.jpg"] : imageMode === "changed" && sourceReads > 1 ? snapshot.images.slice(0, 1) : snapshot.images;
    return Response.json({ id: "101", name: snapshot.title, parameters: [{ id: "11323", valuesIds: ["11323_2"] }, ...vehicleParams], productSet: [{ quantity: { value: bundle ? 2 : 1 }, product: {} }], images, stock: { available: lateStock && sourceReads > 1 ? 0 : stock }, publication: { status: "ACTIVE" }, sellingMode: { price: { amount: mode === "price-format" && sourceReads > 1 ? "100" : mode === "price-change" && sourceReads > 1 ? "101.00" : "100.00", currency: "PLN" } } });
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
  if (url.pathname === "/v2/get/parts") { assert.equal(url.searchParams.get("external_ids"), "tymo:555:101"); return Response.json({ status_code: "R200", data: duplicate ? [{ id: "99" }] : [], pagination: { page: "1", limit: "1", total_count: duplicate ? "1" : "0" } }); }
  assert.equal(url.pathname, "/crm/importPart", "No arbitrary mutation, update, delete, status change, donor or warehouse operations");
  assert.equal(records.size, 1); assert.equal([...records.values()][0].state, "sending", "Durable reservation precedes every mutation");
  writes++;
  assert.equal(form.get("manufacturer_code"), "0281010038"); assert.equal(form.get("car_id"), "13"); assert.equal(form.get("quality"), "0"); assert.equal(form.get("status"), "0");
  assert.equal(form.get("photo"), form.get("photos[0]")); assert.equal(form.get("original_currency"), "PLN"); assert.equal(form.get("price"), expectedPrice);
  assert.deepEqual([...form.entries()].filter(([name]) => /^photos\[\d+\]$/.test(name)).map(([, url]) => url), snapshot.images, "Transfer the complete gallery in source order, not just the thumbnail");
  assert.equal(form.get("notes"), "Opis & uwagi + numer"); assert.equal(form.get("place"), null); assert.equal(form.get("storage_id"), null);
  const expectedCodes = extraCodes ? ["A1649020300", "A1649004200BA"] : [];
  assert.deepEqual([...form.entries()].filter(([name]) => /^optional_codes\[\d+\]$/.test(name)).map(([, value]) => value), expectedCodes, "Additional numbers occupy separate fields, retaining suffixes and not duplicating the main number");
  if (mode === "timeout") throw new DOMException("private-provider-error", "TimeoutError");
  if (mode === "redirect") return new Response("private-provider-error", { status: 302, headers: { Location: "https://evil.test" } });
  if (mode === "bad") return Response.json({ status_code: "R400", msg: "private-provider-error" });
  if (mode === "missing-id") return Response.json({ status_code: "R200" });
  return Response.json({ status_code: "R200", part_id: 77 });
};
try {
  reset(); assert.equal((await handleOvokoApi(req(), { ...env, OVOKO_PUBLISH_ENABLED: "false" })).status, 503); assert.equal(writes, 0);
  reset(); admin = false; assert.equal((await handleOvokoApi(req(), env)).status, 403); assert.equal(calls.some(call => call.url.includes("api.rrr.lt")), false);
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
  reset(); imageMode = "duplicates"; assert.equal((await handleOvokoApi(req(), env)).status, 200); assert.equal(writes, 1, "Duplicate URLs do not block a full unique gallery");
  reset(); const formatted = payload(); formatted.expectedSource.price = "100"; assert.equal((await handleOvokoApi(req(formatted), env)).status, 200); assert.equal(writes, 1, "Equivalent decimal representations must not block publication");
  reset(); mode = "price-format"; assert.equal((await handleOvokoApi(req(), env)).status, 200); assert.equal(writes, 1, "The last source recheck also compares monetary value, not decimal spelling");
  reset(); mode = "price-change"; assert.equal((await handleOvokoApi(req(), env)).status, 409); assert.equal(writes, 0, "A true price change during recheck still blocks publication");
  reset(); extraCodes = "A1649020300\nA1649004200BA\nA1649020300\n0281010038"; assert.equal((await handleOvokoApi(req(), env)).status, 200); assert.equal(writes, 1);
  for (const additionalCodes of [["A1649020300"], "<script>", Array.from({ length: 21 }, (_, index) => `CODE${100000 + index}`).join("\n")]) {
    reset(); assert.equal((await handleOvokoApi(req({ ...payload(), additionalCodes }), env)).status, 400); assert.equal(writes, 0);
  }
  reset(); const simultaneous = await Promise.all([handleOvokoApi(req(), env), handleOvokoApi(req(), env)]); assert.equal(writes, 1); assert.ok(simultaneous.some(response => response.status === 200));
  for (const failure of ["timeout", "redirect", "bad", "missing-id", "log-failure"]) {
    reset(); mode = failure; if (failure === "log-failure") failDb = "PATCH";
    const response = await handleOvokoApi(req(), env); assert.equal(response.status, 409); assert.ok(!(await response.text()).includes("private-")); assert.equal(writes, 1);
    const retry = await handleOvokoApi(req(), env); assert.equal(retry.status, 409); assert.equal(writes, 1, "Never retry uncertain writes, including an unrecorded success");
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
    const ready = calls.length, result = await handleOvokoApi(bulkReq({ ...item, prepared: data.prepared }), env);
    if (checkBounds) assert.ok(calls.length - ready < 50, "Publication uses a bounded separate Worker request");
    return result;
  }
  for (const [adjustment, price] of [[{ mode: "none", value: "0" }, "100.00"], [{ mode: "percent", value: "-10" }, "90.00"], [{ mode: "amount", value: "+25.50" }, "125.50"]]) {
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
  assert.equal((await bulkSend(uncertain)).status, 409); assert.equal(writes, 1);
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
  const missing = await bulkSend(noModel); assert.equal(missing.status, 400); assert.match(await missing.text(), /model pomocniczy/); assert.equal(writes, 0);
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
  const conflict = { ...await bulkPlan({ mode: "none", value: "0" }), fallbackVehicle: { brandId: "1", modelId: "11" } };
  assert.equal((await bulkSend(conflict)).status, 400); assert.equal(writes, 0, "A fallback cannot bypass an explicit conflicting generation"); generationTest = false;
  reset(); bulk = true; snapshot.title = originalTitle;
  const ignoredFallback = { ...await bulkPlan({ mode: "none", value: "0" }), fallbackVehicle: { brandId: "2", modelId: "22" } };
  assert.equal((await bulkSend(ignoredFallback)).status, 200); assert.equal(preparedVehicle.usedFallback, false); assert.equal(preparedVehicle.brand, "Audi");
  console.log("Ovoko single + bulk publication: guards, source/target binding, prices, multi-make model lookup, constrained fallback and generation/brand conflicts, car reuse, full photos, durable duplicate locks and uncertain no-retry passed. All services mocked; nothing published live.");
} finally { globalThis.fetch = originalFetch; }
