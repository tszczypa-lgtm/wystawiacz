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
const { sealConnection, openConnection } = load(path.join(root, "lib/allegro-api.ts"));
const { ovokoWriteDigest } = load(path.join(root, "lib/ovoko-write-client.ts"));
const workspaceCarId="30000000-0000-4000-8000-000000000001";
const workspaceCar={manufacturer:"Audi",short:"Audi A4",buttonLabel:"A4",full:"Audi A4 2005",ovoko:{brandId:"1",modelId:"11",year:"2005",vin:"WAUZZZ8K0AA000001",engineCode:"",capacity:"",power:"",mileage:"",color:"",place:""}};
const keyBytes = new Uint8Array(32).fill(7), key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt", "decrypt"]);
const env = { BILLING_ENFORCED: "true", SUPABASE_SERVICE_ROLE_KEY: "fixture", ALLEGRO_ENCRYPTION_KEY: Buffer.from(keyBytes).toString("base64"), OVOKO_PUBLISH_ENABLED: "true" };
const credentials = { username: "fixture-account", password: "private-password", user_token: "private-token" };
let user = 1, admin, suspended, owns, stock, bundle, mode, donorModel, duplicate, failDb, sourceReads, lateStock, writes, categoryName, revokeAfterRead, imageMode, extraCodes, bulk, expectedPrice, credentialReads, rotateAt, ordinaryAccess = false;
let providerPresent, inventoryReads;
const owner = () => `00000000-0000-0000-0000-${String(user).padStart(12, "0")}`;
const records = new Map(), calls = [];
let stockGroup = null, stockUnits = [], missingStockSchema = false, nativeRow=null;
const snapshot = { title: "AUDI A4 POMPA 0281010038", price: "100.00", currency: "PLN", stock: 1, status: "ACTIVE", condition: "used", images: ["https://a.allegroimg.com/photo.jpg", "https://a.allegroimg.com/second.jpg", "https://a.allegroimg.com/label.jpg"] };
const payload = () => ({ offerId: "101", brandId: "1", modelId: "11", donorId: "13", categoryId: "3", qualityId: "0", statusId: "0", manufacturerCode: "0281010038", additionalCodes: extraCodes, price: "100.00", currency: "PLN", notes: "Opis & uwagi + numer", confirmSingle: true, expectedSource: { ...snapshot } });
const req = (body = payload(), headers = {}) => new Request("https://publish.test/api/ovoko/publish", { method: "POST", headers: { Authorization: "Bearer fixture", Origin: "https://publish.test", "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
function reset() {
  nativeRow=null;
  stockGroup = null; stockUnits = []; missingStockSchema = false;
  providerPresent = false; inventoryReads = 0;
  fitmentMode = "none";
  expectedCode = "0281010038";
  user++; admin = true; suspended = false; owns = true; stock = 1; bundle = false; mode = "ok"; donorModel = "11"; duplicate = false; failDb = ""; sourceReads = 0; lateStock = false; writes = 0; categoryName = "Pompy"; revokeAfterRead = false; imageMode = "normal"; extraCodes = ""; bulk = false; expectedPrice = "100.00"; credentialReads = 0; rotateAt = Infinity; records.clear(); calls.length = 0;
}
const originalFetch = globalThis.fetch;
const originalNow = Date.now;
let clockOffset = 0;
Date.now = () => originalNow() + clockOffset;
let vehicleParams = [], preparedVehicle, generationTest = false, fitmentMode = "none", expectedCode = "0281010038", hyphenCode = "";
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(input), method = options.method || "GET";
  calls.push({ url: url.href, method });
  if (url.pathname === "/auth/v1/user") return Response.json({ id: owner(), email_confirmed_at: "2026-01-01" });
  if (url.pathname === "/rest/v1/customer_accounts") return Response.json([{ owner_id: owner(), company: {}, suspended, access_mode: ordinaryAccess ? "free" : "standard", free_until: null }]);
  if (url.pathname === "/rest/v1/account_admins") return Response.json(admin ? [{ owner_id: owner() }] : []);
  if (url.pathname === "/rest/v1/allegro_connections") return Response.json([{ sealed: await sealConnection({ accessToken: "seller-token", expiresAt: Date.now() + 3600000 }, key, owner()) }]);
  if (url.pathname === "/rest/v1/ovoko_connections") { credentialReads++; return Response.json([{ sealed: await sealConnection({ ...credentials, ...(credentialReads >= rotateAt ? { password: "private-changed" } : {}) }, key, `ovoko:v1:${owner()}`) }]); }
  if(url.pathname==="/rest/v1/workspace_vehicles"){
    assert.equal(url.searchParams.get("owner_id"),`eq.${owner()}`);
    return Response.json(url.searchParams.get("id")===`eq.${workspaceCarId}`?[{id:workspaceCarId,revision:1,payload:workspaceCar}]:[]);
  }
  if(url.pathname==="/rest/v1/workspace_vehicle_ovoko"){
    assert.equal(url.searchParams.get("owner_id"),`eq.${owner()}`);assert.equal(url.searchParams.get("vehicle_id"),`eq.${workspaceCarId}`);
    return Response.json([{state:"created",car_id:"13",request_hash:await ovokoWriteDigest(JSON.stringify(workspaceCar.ovoko))}]);
  }
  if(url.pathname==="/rest/v1/workspace_ovoko_drafts"){
    if(method==="POST"){
      const data=JSON.parse(options.body);assert.equal(data.owner_id,owner());
      if(nativeRow)return Response.json([]);
      nativeRow={...data,state:"ready",completed:0,part_ids:[]};return Response.json([nativeRow]);
    }
    assert.equal(url.searchParams.get("owner_id"),`eq.${owner()}`);
    if(method==="GET")return Response.json(nativeRow?[nativeRow]:[]);
    const filters=[...url.searchParams].filter(([,value])=>value.startsWith("eq."));
    if(!nativeRow||filters.some(([key,value])=>String(nativeRow[key])!==value.slice(3)))return Response.json([]);
    Object.assign(nativeRow,JSON.parse(options.body));return Response.json([nativeRow]);
  }
  if (url.pathname === "/rest/v1/ovoko_vehicle_creations") { assert.equal(method, "GET", "Bulk reuses the saved vehicle without creating a duplicate"); return Response.json([]); }
  if (url.pathname === "/rest/v1/ovoko_stock_groups") return missingStockSchema ? new Response("missing", { status: 404 }) : Response.json(stockGroup ? [stockGroup] : []);
  if (url.pathname === "/rest/v1/rpc/prepare_ovoko_stock_group") {
    const args = JSON.parse(options.body);
    assert.deepEqual(Object.keys(args).sort(), ["p_account", "p_mode", "p_offer", "p_owner", "p_quantity", "p_seller"]);
    if (!stockGroup) {
      stockGroup = { id: "10000000-0000-0000-0000-000000000001", owner_id: args.p_owner, ovoko_account: args.p_account, seller_id: args.p_seller, offer_id: args.p_offer, quantity: args.p_quantity, mode: args.p_mode };
      stockUnits = Array.from({ length: args.p_mode === "shared" ? 1 : args.p_quantity }, (_, i) => ({ id: `20000000-0000-0000-0000-${String(i + 1).padStart(12, "0")}`, group_id: stockGroup.id, ovoko_account: args.p_account, ordinal: i + 1, external_id: `tymo:${args.p_seller}:${args.p_offer}:u:${i + 1}`, state: "pending", part_id: null, request_hash: null }));
    }
    return Response.json([stockGroup]);
  }
  if (url.pathname === "/rest/v1/ovoko_stock_units") {
    const matches = row => [...url.searchParams].every(([key, filter]) => filter.startsWith("eq.") ? String(row[key]) === filter.slice(3) : filter === "is.null" ? row[key] === null : true);
    const rows = stockUnits.filter(matches);
    if (method === "PATCH") {
      const patch = JSON.parse(options.body);
      if (patch.state === "sending" && mode === "unit-cas-race") return Response.json([]);
      rows.forEach(row => Object.assign(row, patch));
      if (patch.state === "created" && mode === "confirmation-lost") throw new Error("private-db-error");
      if (patch.state === "created" && mode === "stock-confirmation-failed") { rows.forEach(row => { row.state = "sending"; row.part_id = null; }); throw new Error("private-db-error"); }
    }
    return Response.json(rows.slice(Number(url.searchParams.get("offset") || 0), Number(url.searchParams.get("offset") || 0) + 1000));
  }
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
  if(url.pathname==="/get/car/13")return Response.json({status_code:"R200",list:[[{id:"13",car_model:"11",car_years:"2005",car_body_number:workspaceCar.ovoko.vin}]]});
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
    if(url.searchParams.get("external_ids")?.startsWith("tymo:draft:"))return Response.json({status_code:"R200",data:[],pagination:{page:1,limit:1,total_count:0}});
    assert.equal(url.searchParams.has("part_ids"), false, "No undocumented filter can be trusted to prove absence");
    const external = url.searchParams.has("external_ids");
    if (external) assert.match(url.searchParams.get("external_ids"), /^tymo:555:101(?::u:\d+)?$/);
    else { inventoryReads++; assert.equal(url.searchParams.get("sort[id]"), "asc"); }
    if (mode === "presence-error") return new Response("private-provider-error", { status: 503 });
    if (mode === "presence-warning") return Response.json({ status_code: "R202", msg: "private-provider-error" });
    if (mode === "presence-malformed") return Response.json({ status_code: "R200", data: [] });
    if (!external && mode === "presence-large-inventory") {
      const page = Number(url.searchParams.get("page"));
      return Response.json({ status_code: "R200", data: Array.from({ length: Math.min(100, 1501 - (page - 1) * 100) }, (_, i) => ({ id: String(10000 + (page - 1) * 100 + i), external_id: null })), pagination: { page, limit: 100, total_count: 1501 } });
    }
    const present = !stockGroup && (providerPresent || (external ? mode === "presence-external-only" : mode === "presence-id-only" || (mode === "presence-reappeared" && inventoryReads >= 2)));
    const data = present ? [{ id: external && mode === "presence-external-only" ? "99" : "77", external_id: mode === "presence-id-only" ? "changed" : "tymo:555:101" }] : duplicate ? [{ id: "99", external_id: "tymo:555:101" }] : [];
    if (mode === "presence-wrong-external") data.push({ id: "99", external_id: "private-wrong" });
    return Response.json({ status_code: "R200", data, pagination: { page: "1", limit: external ? "1" : "100", total_count: data.length } });
  }
  assert.equal(url.pathname, "/crm/importPart", "No arbitrary mutation, update, delete, status change, donor or warehouse operations");
  if(nativeRow){
    assert.equal(nativeRow.state,"sending");assert.match(form.get("external_id"),/^tymo:draft:[a-f0-9-]+:[a-f0-9-]+:u:\d+$/);
  } else if (stockGroup) {
    assert.equal(records.size, 0, "Groups never create a legacy single journal row");
    assert.equal(stockUnits.find(row => row.external_id === form.get("external_id"))?.state, "sending");
    assert.match(form.get("external_id"), /^tymo:555:101:u:\d+$/);
  } else { assert.equal(records.size, 1); assert.equal([...records.values()][0].state, "sending", "Durable reservation precedes every mutation"); }
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
  return Response.json({ status_code: "R200", part_id: stockGroup || nativeRow ? 77 + writes : 77 });
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
  const multiPayload = (stockMode = "separate") => {
    // Advance between explicit resume requests; API rate-limit coverage lives in the worker tests.
    clockOffset += 61000;
    return { ...payload(), stockMode, expectedSource: { ...snapshot, stock } };
  };
  reset(); stock = 3;
  const firstUnit = await handleOvokoApi(req(multiPayload()), env);
  assert.equal(firstUnit.status, 200, await firstUnit.clone().text());
  const firstData = await firstUnit.json();
  assert.equal(firstData.completedUnits, 1); assert.equal(firstData.totalUnits, 3); assert.equal(firstData.moreUnits, true);
  assert.equal(firstData.binding.sellerId, "555"); assert.match(firstData.binding.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(writes, 1); assert.equal(stockUnits[0].external_id, "tymo:555:101:u:1"); assert.equal(stockUnits[1].state, "pending");
  const secondUnit = await handleOvokoApi(req(multiPayload()), env);
  assert.equal(secondUnit.status, 200, await secondUnit.clone().text()); assert.equal((await secondUnit.json()).completedUnits, 2); assert.equal(writes, 2);
  stock = 1;
  const changedStock = await handleOvokoApi(req(multiPayload()), env);
  assert.equal(changedStock.status, 409); assert.equal((await changedStock.json()).code, "stock_changed"); assert.equal(writes, 2, "Existing partial group cannot fall through to legacy when stock becomes one");
  stock = 3;
  const changedMode = await handleOvokoApi(req(multiPayload("shared")), env);
  assert.equal(changedMode.status, 409); assert.equal((await changedMode.json()).code, "stock_changed"); assert.equal(writes, 2);
  providerPresent = false;
  const finalUnit = await handleOvokoApi(req(multiPayload()), env);
  assert.equal(finalUnit.status, 200); assert.equal((await finalUnit.json()).moreUnits, false); assert.equal(writes, 3);
  const completedGroup = await handleOvokoApi(req(multiPayload()), env);
  assert.equal(completedGroup.status, 200); assert.equal((await completedGroup.json()).alreadyCreated, true); assert.equal(writes, 3, "Sold/absent completed units are never silently recreated");
  stock = 1;
  const completedWithDefaultMode = await handleOvokoApi(req({ ...multiPayload(), stockMode: undefined }), env);
  assert.equal(completedWithDefaultMode.status, 200, await completedWithDefaultMode.clone().text());
  const completedDefaultData = await completedWithDefaultMode.json();
  assert.equal(completedDefaultData.alreadyCreated, true); assert.equal(completedDefaultData.stockMode, "separate"); assert.equal(completedDefaultData.completedUnits, 3); assert.match(completedDefaultData.message, /separate/); assert.equal(writes, 3, "Completed separate group with stock one and hidden/default shared selector is a safe skip, not a conversion");
  for (const selectedMode of [undefined, "shared"]) {
    reset(); stock = 5;
    const sharedPayload = { ...multiPayload("shared"), stockMode: selectedMode };
    const response = await handleOvokoApi(req(sharedPayload), env);
    assert.equal(response.status, 200, await response.clone().text());
    const data = await response.json();
    assert.equal(data.totalUnits, 1); assert.equal(data.completedUnits, 1); assert.equal(data.initialStock, 5); assert.equal(data.moreUnits, false); assert.equal(data.stockMode, "shared");
    assert.equal(stockGroup.mode, "shared"); assert.equal(stockUnits.length, 1); assert.equal(writes, 1);
    providerPresent = false; stock = 1;
    const already = await handleOvokoApi(req({ ...sharedPayload, expectedSource: { ...snapshot, stock } }), env);
    assert.equal(already.status, 200); assert.equal((await already.json()).alreadyCreated, true); assert.equal(writes, 1, "Shared publication does not renew sold records; only sync may reactivate the same ID");
    const sharedWithOtherSelection = await handleOvokoApi(req(multiPayload("separate")), env);
    assert.equal(sharedWithOtherSelection.status, 200); assert.equal((await sharedWithOtherSelection.json()).stockMode, "shared"); assert.equal(writes, 1);
  }
  for (const selectedMode of [null, "unknown", {}, 1]) {
    reset(); stock = 2;
    assert.equal((await handleOvokoApi(req({ ...multiPayload(), stockMode: selectedMode }), env)).status, 400); assert.equal(writes, 0);
  }
  for (const failure of ["timeout", "missing-id", "confirmation-lost", "stock-confirmation-failed", "unit-cas-race"]) {
    reset(); stock = 2; mode = failure;
    const response = await handleOvokoApi(req(multiPayload()), env);
    assert.equal(response.status, failure === "confirmation-lost" ? 200 : 409, await response.clone().text());
    assert.equal(writes, failure === "unit-cas-race" ? 0 : 1);
    if (["timeout", "missing-id", "stock-confirmation-failed"].includes(failure)) {
      mode = "ok";
      const blocked = await handleOvokoApi(req(multiPayload()), env);
      assert.equal(blocked.status, 409); assert.equal((await blocked.json()).code, "stock_publication_locked"); assert.equal(writes, 1);
      assert.equal(stockUnits[1].state, "pending", "Never skip an uncertain unit to send later units");
    }
  }
  reset(); stock = 2; lateStock = true;
  assert.equal((await handleOvokoApi(req(multiPayload()), env)).status, 409); assert.equal(stockGroup, null, "Prepare only after source freshness checks"); assert.equal(writes, 0);
  reset(); stock = 2; rotateAt = 2;
  assert.equal((await handleOvokoApi(req(multiPayload()), env)).status, 409); assert.equal(stockGroup, null); assert.equal(writes, 0);
  reset(); stock = 2;
  const boundFirst = await (await handleOvokoApi(req(multiPayload()), env)).json();
  rotateAt = credentialReads + 1;
  const driftedConnection = await handleOvokoApi(req({ ...multiPayload(), binding: boundFirst.binding }), env);
  assert.equal(driftedConnection.status, 409); assert.equal((await driftedConnection.json()).code, "account_changed"); assert.equal(writes, 1, "Single UI continuation carries a credential binding across requests");
  reset(); stock = 2;
  assert.equal((await handleOvokoApi(req(multiPayload()), env)).status, 200);
  stockGroup.paused = true;
  const paused = await handleOvokoApi(req(multiPayload()), env);
  assert.equal(paused.status, 409); assert.equal((await paused.json()).code, "stock_changed"); assert.equal(writes, 1, "Manual pause blocks pending units");
  stockGroup.paused = false;
  assert.equal((await handleOvokoApi(req(multiPayload()), env)).status, 200);
  stockGroup.paused = true;
  const pausedCompleted = await (await handleOvokoApi(req(multiPayload()), env)).json();
  assert.equal(pausedCompleted.alreadyCreated, true); assert.equal(pausedCompleted.paused, true); assert.match(pausedCompleted.message, /wstrzymana/); assert.equal(writes, 2);
  reset(); stock = 2;
  await Promise.all([handleOvokoApi(req(multiPayload()), env), handleOvokoApi(req(multiPayload()), env)]);
  assert.equal(writes, 1, "Concurrent group preparation/CAS cannot import the same unit twice");
  reset(); stock = 2;
  assert.equal((await handleOvokoApi(req(multiPayload()), env)).status, 200);
  user++;
  assert.equal((await handleOvokoApi(req(multiPayload()), env)).status, 409); assert.equal(writes, 1, "Another owner cannot resume the physical group");
  reset(); missingStockSchema = true;
  const missingSchema = await handleOvokoApi(req(), env);
  assert.equal(missingSchema.status, 503); assert.match(await missingSchema.text(), /ovoko_stock_groups/); assert.equal(writes, 0);
  reset(); bulk = true; stock = 2;
  const partialPlan = { ...await bulkPlan({ mode: "none", value: "0" }), stockMode: "separate", expectedSource: { ...snapshot, stock } };
  assert.equal((await bulkSend(partialPlan)).status, 200); assert.equal(writes, 1);
  const partialPreparation = await handleOvokoApi(bulkReq({ ...partialPlan, operation: "prepare" }), env);
  assert.equal(partialPreparation.status, 200); assert.notEqual((await partialPreparation.json()).alreadyCreated, true, "Bulk precheck does not skip a partially completed group");
  stock = 1;
  const partialDrift = await bulkSend({ ...partialPlan, expectedSource: { ...snapshot, stock } });
  assert.equal(partialDrift.status, 409); assert.equal((await partialDrift.json()).code, "stock_changed"); assert.equal(writes, 1);
  stock = 2;
  assert.equal((await bulkSend(partialPlan)).status, 200); assert.equal(writes, 2);
  const bulkCompleted = await bulkSend(partialPlan); assert.equal((await bulkCompleted.json()).alreadyCreated, true); assert.equal(writes, 2);
  reset(); bulk = true; stock = 4;
  const sharedPlan = { ...await bulkPlan({ mode: "none", value: "0" }), stockMode: "shared", expectedSource: { ...snapshot, stock } };
  const bulkShared = await bulkSend(sharedPlan); assert.equal(bulkShared.status, 200, await bulkShared.clone().text()); assert.equal((await bulkShared.json()).totalUnits, 1); assert.equal(writes, 1);
  assert.equal((await bulkSend(sharedPlan)).status, 200); assert.equal(writes, 1);
  reset(); bulk = true; stock = 10000;
  const largePlan = { ...await bulkPlan({ mode: "none", value: "0" }), stockMode: "separate", expectedSource: { ...snapshot, stock } };
  assert.equal((await bulkSend(largePlan)).status, 200); assert.equal(writes, 1);
  const resumedLarge = await bulkSend(largePlan);
  assert.equal(resumedLarge.status, 200, await resumedLarge.clone().text()); assert.equal((await resumedLarge.json()).completedUnits, 2); assert.equal(writes, 2, "Even a 10000-record group imports exactly one unit per bounded Worker request");
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
  const missing = await bulkSend(noModel); assert.equal(missing.status, 400); const missingBody = await missing.json(); assert.match(missingBody.message, /Nie rozpoznano modelu/); assert.equal(missingBody.repair.needsVehicle, true); assert.equal(missingBody.repair.needsCategory, false); assert.equal(missingBody.repair.categoryId, "3"); assert.equal(writes, 0);
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
  assert.equal((await bulkSend(technicalConflict)).status, 400); assert.equal(writes, 0, "Technical models cannot bypass an explicit conflicting generation either");
  const explicitManual={...conflict,manualVehicle:true};fitmentMode="error";
  assert.equal((await bulkSend(explicitManual)).status,200,"A deliberate one-row model choice is used instead of repeating a failed automatic catalog lookup");
  assert.equal(writes,1);assert.equal(preparedVehicle.evidence,"Wybor reczny");generationTest=false;fitmentMode="none";
  reset(); bulk = true; snapshot.title = originalTitle;
  const ignoredFallback = { ...await bulkPlan({ mode: "none", value: "0" }), fallbackVehicle: { brandId: "2", modelId: "22" } };
  assert.equal((await bulkSend(ignoredFallback)).status, 200); assert.equal(preparedVehicle.usedFallback, false); assert.equal(preparedVehicle.brand, "Audi");
  reset();bulk=true;donorModel="22";
  const manualInstead={...await bulkPlan({mode:"none",value:"0"}),manualVehicle:true,fallbackVehicle:{brandId:"2",modelId:"22",year:"2005"}};
  assert.equal((await bulkSend(manualInstead)).status,400,"Manual brand cannot contradict the only make in the source title");assert.equal(writes,0);
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
  assert.equal(blocked.status, 400); assert.match(await blocked.text(), /Nie rozpoznano modelu/); assert.equal(writes, 0);
  snapshot.title = originalTitle;
  {
  reset();bulk=true;expectedPrice="125.00";
  const listingBody={operation:"prepare",offerId:"101",vehicleId:workspaceCarId,price:"125.00",stockMode:"shared",categoryId:"3",notes:"Opis & uwagi + numer",binding:{sellerId:"555",fingerprint:await ovokoWriteDigest(JSON.stringify(credentials))}};
  const listing=body=>handleOvokoApi(new Request("https://publish.test/api/ovoko/workspace-listing",{method:"POST",headers:{Authorization:"Bearer fixture",Origin:"https://publish.test","Content-Type":"application/json"},body:JSON.stringify(body)}),env);
  const planResponse=await listing(listingBody);assert.equal(planResponse.status,200,await planResponse.clone().text());
  const plan=await planResponse.json();assert.equal(plan.prepared.donorId,"13");assert.equal(plan.expectedSource.price,"100.00");
  assert.ok(!calls.some(call=>call.url.includes("compatibility-list")||call.url.includes("api.openai.com")||call.url.includes("/crm/importCar")),"A selected physical donor bypasses model guessing and never creates a generic car");
  const publishBody={...listingBody,operation:"item",prepared:plan.prepared,expectedSource:plan.expectedSource};
  const forged=await listing({...publishBody,prepared:{...plan.prepared,donorId:"999"}});assert.equal(forged.status,409);assert.equal(writes,0);
  const listed=await listing(publishBody);assert.equal(listed.status,200,await listed.clone().text());assert.equal(writes,1);
  assert.equal((await listing(publishBody)).status,200);assert.equal(writes,1,"Dual-listing uses the existing durable source lock");
  const missing=await listing({...listingBody,vehicleId:"30000000-0000-4000-8000-000000000002"});assert.equal(missing.status,404);
  const stale=await listing({...publishBody,expectedSource:{...plan.expectedSource,stock:2}});assert.equal(stale.status,409);assert.equal(writes,1);
  const foreign=await listing({...listingBody,binding:{...listingBody.binding,sellerId:"666"}});assert.equal(foreign.status,409);
  console.log("Workspace listing: exact physical donor, separate price, owned source snapshot, no model guessing, forged donor rejection, durable replay and account/source change guards passed.");
  reset();bulk=true;
  const autoListing=await listing({...listingBody,vehicleId:""});assert.equal(autoListing.status,200,await autoListing.clone().text());assert.equal((await autoListing.json()).prepared.donorId,"13","No saved donor uses the same transfer matching");
  reset();bulk=true;
  const nativeBody={operation:"prepare",productId:"40000000-0000-4000-8000-000000000001",vehicleId:"",categoryId:"",source:{title:originalTitle,notes:"Opis & uwagi + numer",images:snapshot.images,stock:2,condition:"used",number:"0281010038",price:"100.00",currency:"PLN"}};
  const native=body=>handleOvokoApi(new Request("https://publish.test/api/ovoko/workspace-native",{method:"POST",headers:{Authorization:"Bearer fixture",Origin:"https://publish.test","Content-Type":"application/json"},body:JSON.stringify(body)}),env);
  const nativePrepare=await native(nativeBody);assert.equal(nativePrepare.status,200,await nativePrepare.clone().text());
  const nativePlan=await nativePrepare.json();assert.equal(nativePlan.prepared.donorId,"13");
  assert.ok(!calls.some(call=>call.url.startsWith("https://api.allegro.pl")),"Ovoko-only preparation never reads or creates an Allegro offer");
  const nativeItem={...nativeBody,operation:"item",ticket:nativePlan.ticket};
  assert.equal((await native({...nativeItem,productId:"40000000-0000-4000-8000-000000000002"})).status,409);assert.equal(writes,0);
  assert.equal((await native({...nativeItem,ticket:nativePlan.ticket.slice(0,-4)+"xxxx"})).status,400);assert.equal(writes,0);
  assert.equal((await native({...nativeItem,source:{...nativeBody.source,price:"99.00"}})).status,409);assert.equal(writes,0);
  const firstNative=await native(nativeItem);assert.equal(firstNative.status,200,await firstNative.clone().text());assert.equal((await firstNative.json()).moreUnits,true);assert.equal(writes,1);
  const lastNative=await native(nativeItem);assert.equal(lastNative.status,200,await lastNative.clone().text());assert.equal((await lastNative.json()).moreUnits,false);assert.equal(writes,2);
  assert.equal((await native(nativeItem)).status,200);assert.equal(writes,2);assert.equal(nativeRow.part_ids.length,2);
  assert.ok(!calls.some(call=>call.url.startsWith("https://api.allegro.pl")),"Ovoko-only publication never creates or mutates Allegro");
  reset();bulk=true;mode="timeout";
  const uncertainNative=await native(nativeBody);assert.equal(uncertainNative.status,200);
  const uncertainItem={...nativeBody,operation:"item",ticket:(await uncertainNative.json()).ticket};
  assert.equal((await native(uncertainItem)).status,409);assert.equal(nativeRow.state,"uncertain");assert.equal(writes,1);
  assert.equal((await native(uncertainItem)).status,409);assert.equal(writes,1);
  reset();bulk=true;
  const raceTicket=(await (await native(nativeBody)).json()).ticket;
  const races=await Promise.all([native({...nativeBody,operation:"item",ticket:raceTicket}),native({...nativeBody,operation:"item",ticket:raceTicket})]);
  assert.deepEqual(races.map(row=>row.status).sort(),[200,409]);assert.equal(writes,1,"Concurrent native publication reserves one ordinal once");
  reset();bulk=true;
  const cleanTicket=(await (await native(nativeBody)).json()).ticket;
  const cleanPlan=await openConnection(cleanTicket,key,`ovoko-draft:v1:${owner()}`);
  nativeRow={owner_id:owner(),product_id:nativeBody.productId,ovoko_account:await ovokoWriteDigest(credentials.username),snapshot_hash:cleanPlan.hash,quantity:2,completed:0,part_ids:[],state:"ready",attempt_id:crypto.randomUUID()};
  const corrected=await native({...nativeBody,source:{...nativeBody.source,price:"99.00"}});assert.equal(corrected.status,200,await corrected.clone().text());
  assert.notEqual(nativeRow.snapshot_hash,cleanPlan.hash);assert.equal(writes,0,"Unsent drafts can be corrected without manual unlocking");
  assert.equal((await native({...nativeBody,operation:"item",ticket:cleanTicket})).status,409,"Old preparation cannot send after correction");assert.equal(writes,0);
  console.log("Native Ovoko: shared transfer matching, no Allegro offers, signed preparation, snapshot fencing, multi-unit progress, replay and uncertain no-retry passed.");
  }
  console.log("Ovoko single + bulk publication: guards, source/target binding, prices, multi-make model lookup, constrained fallback and generation/brand conflicts, car reuse, full photos, durable duplicate locks and uncertain no-retry passed. All services mocked; nothing published live.");
} finally { globalThis.fetch = originalFetch; Date.now = originalNow; }
