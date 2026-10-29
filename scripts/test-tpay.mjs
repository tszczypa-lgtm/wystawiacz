import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import ts from "typescript";
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const url = source => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const validation = url(compile(await readFile(new URL("../lib/account-validation.ts", import.meta.url), "utf8")));
const account = url(compile(await readFile(new URL("../lib/account-api.ts", import.meta.url), "utf8")).replace('"./account-validation"', JSON.stringify(validation)));
const policy = url(compile(await readFile(new URL("../lib/sales-policy.ts", import.meta.url), "utf8")));
const documents = url(compile(await readFile(new URL("../lib/sales-documents.ts", import.meta.url), "utf8")).replace('"./sales-policy"', JSON.stringify(policy)));
const checkout = url(compile(await readFile(new URL("../lib/checkout-policy.ts", import.meta.url), "utf8")).replace('"./sales-policy"', JSON.stringify(policy)).replace('"./sales-documents"', JSON.stringify(documents)));
const { checkoutPolicy, checkoutAcceptance } = await import(checkout);
const confirmation = url(compile(await readFile(new URL("../lib/order-confirmation.ts", import.meta.url), "utf8")));
const mailConfig = url(compile(await readFile(new URL("../lib/order-mail-config.ts", import.meta.url), "utf8")));
const mailDiagnostic = url(compile(await readFile(new URL("../lib/order-mail-diagnostic.ts", import.meta.url), "utf8")));
const smtp = url('export async function verifyOrderSmtp() { globalThis.__smtpVerifyCalls++; if (globalThis.__smtpVerifyError) throw globalThis.__smtpVerifyError; }');
const source = compile(await readFile(new URL("../lib/tpay-api.ts", import.meta.url), "utf8")).replace('"./account-api"', JSON.stringify(account)).replace('"./account-validation"', JSON.stringify(validation)).replace('"./sales-policy"', JSON.stringify(policy)).replace('"./checkout-policy"', JSON.stringify(checkout)).replace('"./order-confirmation"', JSON.stringify(confirmation)).replace('"./order-mail-config"', JSON.stringify(mailConfig)).replace('"./order-mail-diagnostic"', JSON.stringify(mailDiagnostic)).replace('"./order-smtp"', JSON.stringify(smtp));
const { handleTpayApi, verifyNotificationFields, verifyTpayJws, amountInGrosz, paymentUrl } = await import(url(source));
const owner = "00000000-0000-0000-0000-000000000001";
const order = "00000000-0000-0000-0000-000000000002";
const env = { APP_ORIGIN: "https://example.test", TPAY_ENABLED: "true", TPAY_ENVIRONMENT: "sandbox", TPAY_CLIENT_ID: "test-id", TPAY_CLIENT_SECRET: "test-secret", TPAY_MERCHANT_ID: "123", TPAY_SECURITY_CODE: "test-code", SUPABASE_SERVICE_ROLE_KEY: "test-db" };
const consent = { version: checkoutPolicy.version, termsVersion: checkoutPolicy.termsVersion, acceptTerms: true, requestEarlyStart: true };
for (const bad of [null, [], {}, { ...consent, acceptTerms: "true" }, { ...consent, requestEarlyStart: false }, { ...consent, version: "old" }, { ...consent, termsVersion: "old" }]) assert.equal(checkoutAcceptance(bad, "sandbox"), null);
assert.equal(checkoutAcceptance({ ...consent, statements: "forged", recordedAt: "forged" }, "sandbox").statements.terms, checkoutPolicy.terms);
const snapshot = checkoutAcceptance({ ...consent, documents: { terms: { text: "forged" } } }, "sandbox");
assert.ok(snapshot.documents.terms.text.includes("Nie oferujemy dodatkowej gwarancji zwrotu"));
assert.ok(snapshot.documents.privacy.text.includes("Administrator i kontakt"));
assert.equal(snapshot.documents.terms.version, consent.termsVersion);
assert.ok(!snapshot.documents.terms.text.includes("forged"));
assert.equal(snapshot.draft, false);
function notification(changes = {}) {
  const fields = { id: "123", tr_id: "TR-TEST-123", tr_crc: order, tr_amount: "500.00", tr_paid: "500.00", tr_currency: "PLN", tr_status: "true", tr_error: "none", test_mode: "1", ...changes };
  fields.md5sum = createHash("md5").update(fields.id + fields.tr_id + fields.tr_amount + fields.tr_crc + env.TPAY_SECURITY_CODE).digest("hex");
  return new URLSearchParams(fields).toString();
}
assert.equal(amountInGrosz("500.00"), 50000);
for (const value of ["500,00", "5e2", "500.001", "-500", "Infinity"]) assert.equal(amountInGrosz(value), -1);
assert.equal(verifyNotificationFields(notification(), env).order, order);
assert.equal(verifyNotificationFields(notification({ test_mode: "0" }), env).environment, "sandbox");
assert.equal(verifyNotificationFields(notification({ test_mode: "0" }), { ...env, TPAY_ENVIRONMENT: "production" }).environment, "production");
assert.throws(() => verifyNotificationFields(notification({ test_mode: "1" }), { ...env, TPAY_ENVIRONMENT: "production" }), error => error.code === "TPAY_TEST_MODE_MISMATCH");
assert.throws(() => verifyNotificationFields(notification({ test_mode: "" }), env));
assert.equal(verifyNotificationFields(notification({ tr_status: "chargeback" }), env).refunded, true);
assert.equal(verifyNotificationFields(notification({ tr_status: "TRUE" }), env).refunded, false);
assert.equal(verifyNotificationFields(notification({ tr_status: "CHARGEBACK" }), env).refunded, true);
for (const status of ["PAID", "paid", "FALSE", "PENDING", "true ", "1"]) {
  assert.throws(() => verifyNotificationFields(notification({ tr_status: status }), env), error => error.code === "TPAY_STATUS_INVALID");
}
for (const change of [{ tr_paid: "499.99" }, { tr_amount: "1.00" }, { tr_currency: "EUR" }, { id: "999" }, { test_mode: "2" }, { tr_crc: "bad" }, { tr_status: "pending" }]) assert.throws(() => verifyNotificationFields(notification(change), env));
assert.throws(() => verifyNotificationFields(notification() + "&tr_paid=500.00", env));
assert.throws(() => verifyNotificationFields(notification().replace(/md5sum=[^&]+/, "md5sum=00000000000000000000000000000000"), env));
for (const [change, code] of [
  [{ id: "999" }, "TPAY_MERCHANT_MISMATCH"],
  [{ test_mode: "2" }, "TPAY_TEST_MODE_MISMATCH"],
  [{ tr_amount: "1.00" }, "TPAY_AMOUNT_MISMATCH"],
  [{ tr_paid: "495.05" }, "TPAY_PAID_MISMATCH"],
  [{ tr_currency: "EUR" }, "TPAY_CURRENCY_MISMATCH"],
  [{ tr_error: "error" }, "TPAY_TRANSACTION_ERROR"],
]) assert.throws(() => verifyNotificationFields(notification(change), env), error => error.code === code);
for (const value of ["https://secure.tpay.com.evil.test/", "https://secure.tpay.com@evil.test/", "javascript:alert(1)", "https://secure.tpay.com/"]) assert.throws(() => paymentUrl(value, "https://secure.sandbox.tpay.com"));
const previous = globalThis.fetch;
const previousError = console.error;
const errors = [];
console.error = message => errors.push(message);
// Generate disposable certificates in memory; no fixture private keys are persisted.
const der = (tag, ...items) => {
  const data = Buffer.concat(items);
  const length = data.length < 128 ? Buffer.from([data.length]) : (() => {
    let hex = data.length.toString(16); if (hex.length % 2) hex = "0" + hex;
    const bytes = Buffer.from(hex, "hex"); return Buffer.concat([Buffer.from([0x80 | bytes.length]), bytes]);
  })();
  return Buffer.concat([Buffer.from([tag]), length, data]);
};
const seq = (...items) => der(0x30, ...items);
const algorithm = seq(Buffer.from("06092a864886f70d01010b", "hex"), der(5));
const name = seq(der(0x31, seq(Buffer.from("0603550403", "hex"), der(12, Buffer.from("Test Tpay CA")))));
const rootKey = generateKeyPairSync("rsa", { modulusLength: 2048 });
const leafKey = generateKeyPairSync("rsa", { modulusLength: 2048 });
function certificate(key, ca) {
  const fields = [der(0xa0, der(2, Buffer.from([2]))), der(2, Buffer.from([ca ? 1 : 2])), algorithm, name,
    seq(der(0x17, Buffer.from("250101000000Z")), der(0x17, Buffer.from("350101000000Z"))), name,
    key.publicKey.export({ type: "spki", format: "der" })];
  if (ca) fields.push(der(0xa3, seq(seq(Buffer.from("0603551d13", "hex"), der(1, Buffer.from([255])), der(4, seq(der(1, Buffer.from([255]))))))));
  const tbs = seq(...fields);
  const cert = seq(tbs, algorithm, der(3, Buffer.from([0]), sign("RSA-SHA256", tbs, rootKey.privateKey)));
  return `-----BEGIN CERTIFICATE-----\n${cert.toString("base64").match(/.{1,64}/g).join("\n")}\n-----END CERTIFICATE-----`;
}
const rootPem = certificate(rootKey, true), leafPem = certificate(leafKey, false);
const signedHeader = Buffer.from(JSON.stringify({ alg: "RS256", x5u: "https://secure.sandbox.tpay.com/x509/notifications-jws.pem" })).toString("base64url");
const signedRaw = notification({ tr_status: "TRUE", test_mode: "0" });
const signedJws = signedHeader + ".." + sign("RSA-SHA256", Buffer.from(signedHeader + "." + Buffer.from(signedRaw).toString("base64url")), leafKey.privateKey).toString("base64url");
globalThis.fetch = async (input, options) => {
  // Workers rejects redirect:error before making any network request.
  assert.equal(options.redirect, "manual");
  return new Response(String(input).endsWith("tpay-jws-root.pem") ? rootPem : leafPem);
};
await verifyTpayJws(signedRaw, signedJws, "https://secure.sandbox.tpay.com");
await assert.rejects(verifyTpayJws(signedRaw, signedJws, "https://secure.tpay.com"));
await assert.rejects(verifyTpayJws(signedRaw + "&tampered=yes", signedJws, "https://secure.sandbox.tpay.com"));
let redirectFetches = 0;
globalThis.fetch = async (_input, options) => {
  assert.equal(options.redirect, "manual"); redirectFetches++;
  return new Response(null, { status: 302, headers: { Location: "https://evil.test/certificate.pem" } });
};
await assert.rejects(verifyTpayJws(signedRaw, signedJws, "https://secure.sandbox.tpay.com"), error => error.code === "TPAY_CERT_REDIRECT");
assert.equal(redirectFetches, 1);
globalThis.fetch = async () => new Response(rootPem);
await assert.rejects(verifyTpayJws(signedRaw, signedJws, "https://secure.sandbox.tpay.com"));
let external = 0, transactions = 0, claims = 0, settlements = 0, attached = false, suspended = false, admin = true, lost = false;
let privateCustomer = false, acceptanceConflict = false;
let historyRows = [];
globalThis.fetch = async (input, init = {}) => {
  const target = String(input);
  if (target.endsWith("/x509/notifications-jws.pem")) { assert.equal(init.redirect, "manual"); return new Response(leafPem); }
  if (target.endsWith("/x509/tpay-jws-root.pem")) { assert.equal(init.redirect, "manual"); return new Response(rootPem); }
  if (target.includes("/rpc/settle_tpay_order")) {
    const data = JSON.parse(init.body); assert.equal(data.p_id, order); assert.equal(data.p_environment, "sandbox"); assert.equal(data.p_refunded, false);
    settlements++; return Response.json({ paid: true });
  }
  if (target.endsWith("/auth/v1/user")) return Response.json({ id: owner, email_confirmed_at: "2026-01-01" });
  if (target.includes("/customer_accounts")) return Response.json([{ owner_id: owner, email: "test@example.test", suspended, company: { name: privateCustomer ? "Jan Kowalski" : "Test", nip: privateCustomer ? "" : "5260250274", street: "Test 1", postcode: "00-001", city: "Warszawa", country: "PL", ...(privateCustomer ? { customerType: "person" } : {}) } }]);
  if (target.includes("/account_admins")) return Response.json(admin ? [{ owner_id: owner }] : []);
  if (target.includes("/tpay_orders?")) {
    const query = new URL(target).searchParams;
    assert.equal(query.get("owner_id"), `eq.${owner}`);
    assert.ok(["1", "10"].includes(query.get("limit")));
    assert.ok(!query.get("select").includes("payment_url"));
    const id = query.get("id");
    return Response.json(historyRows.filter(row => !id || id === `eq.${row.id}`));
  }
  if (target.includes("/rpc/claim_tpay_order_with_acceptance")) {
    if (acceptanceConflict) return Response.json({ code: "P0002" }, { status: 400 });
    const data = JSON.parse(init.body);
    assert.equal(data.p_owner, owner);
    const { buyer, ...acceptance } = data.p_acceptance;
    assert.deepEqual(acceptance, checkoutAcceptance(consent, "sandbox"));
    assert.equal(buyer.email, "test@example.test");
    return Response.json({ id: order, created: ++claims === 1, payment_url: attached ? "https://secure.sandbox.tpay.com/test" : null });
  }
  if (target.includes("/rpc/attach_tpay_transaction")) { attached = true; return Response.json({ ok: true }); }
  if (target.endsWith("/oauth/auth")) { external++; return Response.json({ access_token: "test-token" }); }
  if (target.endsWith("/transactions")) {
    transactions++; const data = JSON.parse(init.body); assert.equal(data.amount, 500); assert.equal(data.hiddenDescription, order);
    assert.equal(data.callbacks.notification.url, "https://example.test/api/account/tpay/webhook");
    assert.equal(data.pay, undefined); // No recurring alias or saved card.
    if (lost) throw Error("response lost");
    return Response.json({ result: "success", transactionId: "01K5BK4HEPB0WBCGT51FMTYSYJ", title: "TR-TEST-123", transactionPaymentUrl: "https://secure.sandbox.tpay.com/test" });
  }
  throw Error(`Unexpected fetch ${target}`);
};
const request = (path = "/checkout", origin = env.APP_ORIGIN, body = consent) => new Request(`${env.APP_ORIGIN}/api/account/tpay${path}`, { method: path === "/status" ? "GET" : "POST", headers: { Authorization: "Bearer test-user", Origin: origin, "Content-Type": "application/json" }, ...(path === "/status" ? {} : { body: JSON.stringify(body) }) });
try {
  globalThis.__smtpVerifyCalls = 0;
  const mailEnv = { ...env, ORDER_MAIL_ENABLED: "true", ORDER_SMTP_PASSWORD: "private-smtp-secret" };
  assert.equal((await handleTpayApi(request("/mail-check"), mailEnv)).status, 200);
  assert.equal(globalThis.__smtpVerifyCalls, 1);
  admin = false;
  assert.equal((await handleTpayApi(request("/mail-check"), mailEnv)).status, 403);
  admin = true;
  assert.equal((await handleTpayApi(request("/mail-check", "https://evil.test"), mailEnv)).status, 403);
  assert.equal(globalThis.__smtpVerifyCalls, 1, "Only same-origin admin can check SMTP");
  assert.equal((await (await handleTpayApi(request("/mail-check"), env)).json()).ok, false);
  globalThis.__smtpVerifyError = { code: "EAUTH", responseCode: 535, command: "AUTH PLAIN", message: "private-smtp-secret" };
  const authFailure = await (await handleTpayApi(request("/mail-check"), mailEnv)).json();
  assert.equal(authFailure.code, "EAUTH"); assert.equal(authFailure.smtpStatus, 535); assert.equal(authFailure.stage, "AUTH");
  assert.ok(!JSON.stringify(authFailure).includes("private-smtp-secret"));
  delete globalThis.__smtpVerifyError;
  delete globalThis.__smtpVerifyCalls;
  const paidOrder = { id: order, environment: "sandbox", status: "paid", amount_grosz: 50000, currency: "PLN", transaction_title: "TR-TEST-123", created_at: "2026-10-28T22:56:36Z", paid_at: "2026-10-28T22:56:49Z", access_until: null, checkout_acceptance: snapshot };
  historyRows = [paidOrder];
  const getOrder = path => handleTpayApi(new Request(`${env.APP_ORIGIN}/api/account/tpay${path}`, { headers: { Authorization: "Bearer test-user" } }), env);
  const history = await (await getOrder("/orders")).json();
  assert.equal(history.orders[0].hasConfirmation, true);
  assert.equal(history.orders[0].checkout_acceptance, undefined);
  const receipt = await getOrder(`/confirmation/${order}`);
  assert.equal(receipt.headers.get("Cache-Control"), "no-store");
  assert.match((await receipt.json()).text, /TEST ZAMOWIENIA/);
  assert.equal((await getOrder("/confirmation/00000000-0000-0000-0000-000000000099")).status, 404);
  assert.equal((await getOrder("/confirmation/invalid")).status, 404);
  historyRows = [{ ...paidOrder, status: "pending" }];
  assert.equal((await getOrder(`/confirmation/${order}`)).status, 404);
  assert.equal((await handleTpayApi(new Request(`${env.APP_ORIGIN}/api/account/tpay/orders`), env)).status, 401);
  historyRows = [];
  let status = await (await handleTpayApi(request("/status"), { ...env, TPAY_SECURITY_CODE: undefined })).json();
  assert.equal(status.enabled, false); assert.match(status.issue, /TPAY_SECURITY_CODE/);
  assert.ok(!JSON.stringify(status).includes(env.TPAY_CLIENT_SECRET));
  status = await (await handleTpayApi(request("/status"), { ...env, TPAY_ENABLED: "false" })).json();
  assert.match(status.issue, /TPAY_ENABLED/);
  admin = false;
  status = await (await handleTpayApi(request("/status"), { ...env, TPAY_SECURITY_CODE: undefined })).json();
  assert.equal(status.issue, undefined); admin = true;
  const reviewEnv = { ...env, TPAY_SANDBOX_REVIEWER_IDS: owner, TPAY_SANDBOX_REVIEWER_UNTIL: new Date(Date.now() + 86400000).toISOString() };
  admin = false;
  for (const restricted of [env, { ...reviewEnv, TPAY_SANDBOX_REVIEWER_IDS: "*" }, { ...reviewEnv, TPAY_SANDBOX_REVIEWER_IDS: owner + "x" }, { ...reviewEnv, TPAY_SANDBOX_REVIEWER_IDS: "" }, { ...reviewEnv, TPAY_SANDBOX_REVIEWER_UNTIL: "" }, { ...reviewEnv, TPAY_SANDBOX_REVIEWER_UNTIL: "invalid" }, { ...reviewEnv, TPAY_SANDBOX_REVIEWER_UNTIL: "2020-01-01T00:00:00Z" }]) {
    const denied = await (await handleTpayApi(request("/status"), restricted)).json();
    assert.equal(denied.canCheckout, false);
    assert.equal((await handleTpayApi(request(), restricted)).status, 403);
  }
  const reviewerStatus = await (await handleTpayApi(request("/status"), reviewEnv)).json();
  assert.equal(reviewerStatus.canCheckout, true);
  assert.equal(reviewerStatus.issue, undefined, "Reviewers never receive administrator diagnostics");
  assert.ok(!JSON.stringify(reviewerStatus).includes(owner), "The reviewer allowlist stays server-side");
  assert.equal((await handleTpayApi(request(), { ...reviewEnv, TPAY_ENVIRONMENT: "production", TPAY_LIVE_APPROVED: "true" })).status, 503);
  suspended = true;
  assert.equal((await (await handleTpayApi(request("/status"), reviewEnv)).json()).canCheckout, false);
  assert.equal((await handleTpayApi(request(), reviewEnv)).status, 403);
  suspended = false; admin = true;
  const rejected = Buffer.from(JSON.stringify({ alg: "RS256", x5u: "https://secure.sandbox.tpay.com.evil.test/x509/notifications-jws.pem" })).toString("base64url") + "..abc";
  await assert.rejects(verifyTpayJws(notification(), rejected, "https://secure.sandbox.tpay.com"));
  assert.equal(external, 0);
  for (const bad of [{}, { ...consent, acceptTerms: false }, { ...consent, requestEarlyStart: "true" }, { ...consent, version: "old" }]) assert.equal((await handleTpayApi(request("/checkout", env.APP_ORIGIN, bad), env)).status, 400);
  assert.equal(claims, 0); assert.equal(external, 0);
  const malformed = new Request(`${env.APP_ORIGIN}/api/account/tpay/checkout`, { method: "POST", headers: { Authorization: "Bearer test-user", Origin: env.APP_ORIGIN, "Content-Type": "application/json" }, body: "{" });
  assert.equal((await handleTpayApi(malformed, env)).status, 400);
  assert.equal((await handleTpayApi(request("/checkout", env.APP_ORIGIN, "x".repeat(4096)), env)).status, 413);
  acceptanceConflict = true;
  assert.equal((await handleTpayApi(request(), env)).status, 409);
  assert.equal(claims, 0); assert.equal(external, 0);
  acceptanceConflict = false;
  assert.equal((await handleTpayApi(request(), { ...env, TPAY_ENABLED: "false" })).status, 503);
  assert.equal((await handleTpayApi(request(), { ...env, TPAY_ENVIRONMENT: "production" })).status, 503);
  assert.equal((await handleTpayApi(request(), { ...env, TPAY_ENVIRONMENT: "production", TPAY_LIVE_APPROVED: "true" })).status, 503);
  assert.equal((await handleTpayApi(request("/checkout", "https://evil.test"), env)).status, 403);
  admin = false; assert.equal((await handleTpayApi(request(), env)).status, 403); admin = true;
  suspended = true; assert.equal((await handleTpayApi(request(), env)).status, 403); suspended = false;
  assert.equal(external, 0);
  admin = false;
  let result = await handleTpayApi(request(), reviewEnv); assert.equal(result.status, 200); assert.equal((await result.json()).url, "https://secure.sandbox.tpay.com/test");
  admin = true;
  result = await handleTpayApi(request(), env); assert.equal(result.status, 200); assert.equal(transactions, 1);
  claims = 0; attached = false; lost = true;
  assert.equal((await handleTpayApi(request(), env)).status, 503);
  assert.equal((await handleTpayApi(request(), env)).status, 409); assert.equal(transactions, 2);
  claims = 0; attached = false; lost = false; privateCustomer = true;
  assert.equal((await handleTpayApi(request(), env)).status, 200); assert.equal(transactions, 3);
  const badWebhook = new Request(`${env.APP_ORIGIN}/api/account/tpay/webhook`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: notification() });
  assert.equal((await handleTpayApi(badWebhook, env)).status, 400);
  assert.equal(settlements, 0);
  const signedWebhook = () => new Request(`${env.APP_ORIGIN}/api/account/tpay/webhook`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "X-JWS-Signature": signedJws }, body: signedRaw });
  const settled = await handleTpayApi(signedWebhook(), env);
  assert.equal(settled.status, 200); assert.equal(await settled.text(), "TRUE"); assert.equal(settlements, 1);
  const changed = new Request(`${env.APP_ORIGIN}/api/account/tpay/webhook`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "X-JWS-Signature": signedJws }, body: signedRaw + "&tampered=yes" });
  assert.equal((await handleTpayApi(changed, env)).status, 400); assert.equal(settlements, 1);
  assert.ok(errors.some(message => JSON.parse(message).stage === "signature"));
  for (const message of errors) {
    assert.ok(!message.includes(env.TPAY_CLIENT_SECRET));
    assert.ok(!message.includes(env.TPAY_SECURITY_CODE));
    assert.ok(!message.includes(order));
  }
} finally { globalThis.fetch = previous; console.error = previousError; }
console.log("Tpay tests passed: strict acceptance, expiring exact-ID sandbox reviewer without admin diagnostics, disabled production, origin, suspension, reused link, uncertain creation and signed webhook (mocked HTTP; no SQL execution).");
