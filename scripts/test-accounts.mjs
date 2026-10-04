import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const validationUrl = moduleUrl(compile(await readFile(new URL("../lib/account-validation.ts", import.meta.url), "utf8")));
const { validateCompany, validateSignup } = await import(validationUrl);
const accountSource = compile(await readFile(new URL("../lib/account-api.ts", import.meta.url), "utf8")).replace('"./account-validation"', JSON.stringify(validationUrl));
const { handleAccountApi, accountAccess, protectAllegroRequest, verifyStripeSignature } = await import(moduleUrl(accountSource));

const company = { name: "Test Company", nip: "5260250274", street: "Testowa 1", postcode: "00-001", city: "Warszawa", country: "PL" };
assert.equal(validateSignup("a-strong-password", "a-strong-password", company).nip, company.nip);
assert.throws(() => validateSignup("strong-password", "different-password", company), /takie same/);
assert.throws(() => validateSignup("short", "short", company), /10 znak/);
assert.throws(() => validateCompany({ ...company, nip: "5260250275" }), /NIP/);
assert.throws(() => validateCompany({ ...company, nip: "0000000000" }), /NIP/);
assert.throws(() => validateCompany({ ...company, postcode: "12345" }), /pocztowy/);
assert.throws(() => validateCompany({ ...company, country: "DE" }), /Polski/);
assert.deepEqual(validateCompany({ ...company, role: "admin", access_mode: "free" }), company);

const owner = "00000000-0000-0000-0000-000000000001";
const other = "00000000-0000-0000-0000-000000000002";
const account = { owner_id: owner, email: "test@example.com", company, access_mode: "standard", free_until: null, suspended: false, stripe_customer_id: null, stripe_subscription_id: null, subscription_status: "none", paid_until: null, cancel_at_period_end: false };
assert.equal(accountAccess(account, false).allowed, true);
assert.equal(accountAccess(account, true).allowed, false);
assert.equal(accountAccess({ ...account, suspended: true, access_mode: "free" }, false, true).allowed, false);
assert.equal(accountAccess({ ...account, access_mode: "free" }, true).allowed, true);
assert.equal(accountAccess({ ...account, access_mode: "free", free_until: "2020-01-01" }, true).allowed, false);
assert.equal(accountAccess({ ...account, subscription_status: "active", paid_until: "2099-01-01" }, true).allowed, true);
assert.equal(accountAccess({ ...account, subscription_status: "past_due", paid_until: "2099-01-01" }, true).allowed, false);
assert.equal(accountAccess({ ...account, subscription_status: "active", paid_until: "2020-01-01" }, true).allowed, false);

const now = Date.now();
const raw = JSON.stringify({ id: "evt_1" });
const sign = async (body, time = Math.floor(now / 1000)) => {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("webhook-secret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = Buffer.from(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${time}.${body}`))).toString("hex");
  return `t=${time},v1=${signature}`;
};
const signature = await sign(raw);
assert.equal(await verifyStripeSignature(raw, signature, "webhook-secret", now), true);
assert.equal(await verifyStripeSignature(raw + " ", signature, "webhook-secret", now), false);
assert.equal(await verifyStripeSignature(raw, signature, "wrong-secret", now), false);
assert.equal(await verifyStripeSignature(raw, await sign(raw, Math.floor(now / 1000) - 301), "webhook-secret", now), false);
assert.equal(await verifyStripeSignature(raw, "t=abc,v1=fake", "webhook-secret", now), false);

const originalFetch = globalThis.fetch;
const env = { SUPABASE_SERVICE_ROLE_KEY: "server-only", APP_ORIGIN: "https://example.test", BILLING_ENABLED: "true", BILLING_ENFORCED: "true", STRIPE_SECRET_KEY: "stripe-test", STRIPE_PRICE_ID: "price_test", STRIPE_WEBHOOK_SECRET: "webhook-secret" };
const request = (path, method = "GET", payload, extra = {}) => new Request(`https://example.test/api/account${path}`, { method, headers: { Authorization: "Bearer user-session", Origin: "https://example.test", "Content-Type": "application/json", ...extra }, body: payload ? JSON.stringify(payload) : undefined });
let admin = false;
let confirmed = true;
let current = { ...account };
const calls = [];
const price = { active: true, currency: "pln", type: "recurring", recurring: { interval: "month", interval_count: 1 }, unit_amount: 1000, tax_behavior: "inclusive" };
let subscriptions = [];
globalThis.fetch = async (input, options = {}) => {
  const url = String(input); const headers = new Headers(options.headers);
  calls.push({ url, options, headers });
  if (url.endsWith("/auth/v1/user")) {
    assert.equal(headers.get("Authorization"), "Bearer user-session");
    return Response.json({ id: owner, email_confirmed_at: confirmed ? "2026-01-01" : null, user_metadata: { role: "admin", suspended: false } });
  }
  if (url.includes("/rest/v1/")) {
    assert.equal(headers.get("Authorization"), "Bearer server-only");
    if (url.includes("/account_admins?")) return Response.json(admin && !url.includes(`eq.${other}`) ? [{ owner_id: owner }] : []);
    if (url.includes("/customer_accounts?")) {
      if (options.method === "PATCH") {
        assert.ok(url.includes(`owner_id=eq.${owner}`));
        Object.assign(current, JSON.parse(options.body)); return new Response(null, { status: 204 });
      }
      return Response.json([current]);
    }
    if (url.includes("/rpc/claim_checkout")) return Response.json({ key: "durable-attempt", expires_at: Math.floor(Date.now() / 1000) + 86400 });
    if (url.includes("/rpc/")) return Response.json(null);
    if (url.includes("/account_audit")) return Response.json([]);
    throw new Error(`Unexpected DB URL: ${url}`);
  }
  assert.ok(url.startsWith("https://api.stripe.com/v1/"));
  assert.equal(headers.get("Authorization"), "Bearer stripe-test");
  assert.equal(headers.get("Stripe-Version"), "2025-03-31.basil");
  if (url.includes("/prices/")) return Response.json(price);
  if (url.includes("/subscriptions?")) return Response.json({ has_more: false, data: subscriptions });
  if (url.endsWith("/customers")) return Response.json({ id: "cus_test" });
  if (url.includes("/customers/cus_test")) return Response.json({ id: "cus_test" });
  if (url.endsWith("/checkout/sessions")) return Response.json({ url: "https://checkout.stripe.com/test" });
  if (url.endsWith("/billing_portal/sessions")) return Response.json({ url: "https://billing.stripe.com/test" });
  throw new Error(`Unexpected URL: ${url}`);
};
try {
  assert.equal((await handleAccountApi(new Request("https://example.test/api/account/me"), env)).status, 401);
  confirmed = false; assert.equal((await handleAccountApi(request("/me"), env)).status, 401); confirmed = true;
  assert.equal((await handleAccountApi(request("/admin/accounts"), env)).status, 403);
  assert.equal((await handleAccountApi(request("/admin/action", "POST", { target: other, action: "grant_free", reason: "test" }), env)).status, 403);
  assert.equal((await handleAccountApi(request("/company", "PUT", { company }, { Origin: "https://evil.test" }), env)).status, 403);
  assert.equal((await handleAccountApi(request("/company", "PUT", { company: { ...company, nip: "bad" } }), env)).status, 400);
  assert.equal((await handleAccountApi(request("/company", "PUT", { company, suspended: false, access_mode: "free", role: "admin" }), env)).status, 200);
  const patch = calls.filter(call => call.options.method === "PATCH").at(-1);
  assert.deepEqual(Object.keys(JSON.parse(patch.options.body)).sort(), ["company", "updated_at"]);
  const me = await (await handleAccountApi(request("/me"), env)).json();
  assert.equal(me.isAdmin, false); assert.equal(me.access.allowed, false); assert.equal(me.price.amount, 1000);
  assert.ok(!JSON.stringify(me).includes("server-only")); assert.ok(!JSON.stringify(me).includes("cus_test"));
  current.suspended = true;
  let reached = false;
  assert.equal((await protectAllegroRequest(request("/me"), env, async () => { reached = true; return Response.json({}); })).status, 403);
  assert.equal(reached, false);
  assert.equal((await handleAccountApi(request("/checkout", "POST"), env)).status, 403);
  current.stripe_customer_id = "cus_test";
  assert.equal((await handleAccountApi(request("/portal", "POST"), { ...env, BILLING_ENABLED: "false" })).status, 200, "Suspension cannot trap a paying customer");
  current.suspended = false;
  assert.equal((await handleAccountApi(request("/checkout", "POST", { priceId: "malicious-price", owner_id: other }), env)).status, 200);
  const checkout = calls.find(call => call.url.endsWith("/checkout/sessions"));
  const form = new URLSearchParams(checkout.options.body);
  assert.equal(form.get("line_items[0][price]"), "price_test"); assert.equal(form.get("client_reference_id"), owner);
  assert.equal(form.get("success_url"), "https://example.test/panel/billing?payment=returned");
  assert.ok(checkout.headers.get("Idempotency-Key").startsWith(`checkout-${owner}-`));
  subscriptions = [{ id: "sub_test", status: "active", items: { data: [{ price: { id: "price_test" }, quantity: 1, current_period_end: 4102444800 }] }, latest_invoice: { status: "paid" } }];
  assert.equal((await handleAccountApi(request("/checkout", "POST"), env)).status, 409, "Cannot buy a second subscription");
  admin = true;
  assert.equal((await handleAccountApi(request("/admin/accounts"), env)).status, 200);
  assert.equal((await handleAccountApi(request("/admin/accounts?offset=-1"), env)).status, 400);
  assert.equal((await handleAccountApi(request("/admin/action", "POST", { target: owner, action: "suspend", reason: "test" }), env)).status, 400);
  assert.equal((await handleAccountApi(request("/admin/action", "POST", { target: other, action: "promote_admin", reason: "test" }), env)).status, 400);
  assert.equal((await handleAccountApi(request("/admin/action", "POST", { target: other, action: "grant_free", reason: "ok", freeUntil: "2020-01-01" }), env)).status, 400);
  assert.equal((await handleAccountApi(request("/admin/action", "POST", { target: other, action: "grant_free", reason: "Partner testowy", freeUntil: "2099-01-01" }), env)).status, 200);
  const adminCall = calls.find(call => call.url.endsWith("/rpc/admin_account_action"));
  assert.equal(JSON.parse(adminCall.options.body).p_actor, owner);
  const webhookRaw = JSON.stringify({ id: "evt_paid", type: "invoice.paid", created: Math.floor(Date.now() / 1000), data: { object: { customer: "cus_test" } } });
  const webhookRequest = (signature) => new Request("https://example.test/api/account/stripe-webhook", { method: "POST", headers: { "Stripe-Signature": signature }, body: webhookRaw });
  assert.equal((await handleAccountApi(webhookRequest("invalid"), env)).status, 400);
  assert.equal((await handleAccountApi(webhookRequest(await sign(webhookRaw)), env)).status, 200);
  const billing = calls.filter(call => call.url.endsWith("/rpc/apply_billing_event")).at(-1);
  const billingData = JSON.parse(billing.options.body);
  assert.equal(billingData.p_customer, "cus_test"); assert.equal(billingData.p_status, "active"); assert.ok(billingData.p_paid_until.startsWith("2100"));
  assert.ok(!("suspended" in billingData)); assert.ok(!("access_mode" in billingData));
  subscriptions[0].latest_invoice.status = "open";
  await handleAccountApi(webhookRequest(await sign(webhookRaw)), env);
  assert.equal(JSON.parse(calls.filter(call => call.url.endsWith("/rpc/apply_billing_event")).at(-1).options.body).p_paid_until, null);
} finally { globalThis.fetch = originalFetch; }
const sql = await readFile(new URL("../supabase/003_accounts_and_billing.sql", import.meta.url), "utf8");
assert.ok(sql.includes("enable row level security"));
assert.ok(sql.includes("from anon, authenticated"));
assert.ok(sql.includes("on conflict do nothing;\n  if not found then return;"));
assert.ok(sql.includes("for update"));
assert.ok(!sql.includes("raw_user_meta_data -> 'role'"));
console.log("Accounts: signup/company validation, role isolation, suspension, free/paid expiry, admin actions, Stripe config/idempotency/signatures and webhook mock checks passed. No live payments or SQL execution.");
