import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import nodemailer from "nodemailer";

const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const url = source => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const confirmation = url(compile(await readFile(new URL("../lib/order-confirmation.ts", import.meta.url), "utf8")));
const configUrl = url(compile(await readFile(new URL("../lib/order-mail-config.ts", import.meta.url), "utf8")));
const smtpUrl = url(compile(await readFile(new URL("../lib/order-smtp.ts", import.meta.url), "utf8")).replace('"nodemailer"', JSON.stringify(import.meta.resolve("nodemailer"))));
const mail = url(compile(await readFile(new URL("../lib/order-mail.ts", import.meta.url), "utf8")).replace('"./order-confirmation"', JSON.stringify(confirmation)).replace('"./order-mail-config"', JSON.stringify(configUrl)).replace('"./order-smtp"', JSON.stringify(smtpUrl)));
const { deliverOrderMail } = await import(mail);
const { orderConfirmation } = await import(confirmation);
const { orderSmtpConfig } = await import(configUrl);
const { smtpFailureIsRetryable } = await import(smtpUrl);

const payload = { id: "00000000-0000-0000-0000-000000000002", environment: "sandbox", status: "paid", amount_grosz: 50000, currency: "PLN", transaction_title: "TR-TEST", created_at: "2026-10-28T22:56:36Z", paid_at: "2026-10-28T22:56:49Z", access_until: null, checkout_acceptance: { statements: { terms: "Historical statement" }, documents: { terms: { version: "old", text: "Historical terms" }, privacy: { version: "old", text: "Historical privacy" } } } };
const job = { order_id: payload.id, recipient: "buyer@example.test", payload, lease: "lease-test" };
const env = { ORDER_MAIL_ENABLED: "true", ORDER_SMTP_PASSWORD: "test-password", SUPABASE_SERVICE_ROLE_KEY: "test-db", NEXT_PUBLIC_SUPABASE_URL: "https://db.example.test" };
assert.equal(orderSmtpConfig(env).host, "serwer2684289.hosting-home.pl");
assert.equal(orderSmtpConfig(env).user, "biuro@tymogarage.pl");
for (const bad of [{}, { ...env, ORDER_MAIL_ENABLED: "false" }, { ...env, ORDER_SMTP_PASSWORD: "" }, { ...env, ORDER_SMTP_HOST: "evil.test" }, { ...env, ORDER_SMTP_USER: "a@example.test\r\nBcc: bad@example.test" }]) assert.equal(orderSmtpConfig(bad), null);
for (const error of [{ command: "CONN" }, { command: "AUTH PLAIN" }, { responseCode: 451, command: "DATA" }, { responseCode: 550 }]) assert.equal(smtpFailureIsRetryable(error), true);
for (const error of [null, {}, { command: "DATA", code: "ETIMEDOUT" }, { command: "DATA", responseCode: 250 }]) assert.equal(smtpFailureIsRetryable(error), false);

const previous = globalThis.fetch, previousError = console.error, previousTransport = nodemailer.createTransport;
let claims = 0, sends = 0, closed = 0, completions = [], failures = [], smtpError = null, queueError = false, saveError = false;
console.error = () => {};
nodemailer.createTransport = options => {
  assert.equal(options.host, "serwer2684289.hosting-home.pl");
  assert.equal(options.port, 465); assert.equal(options.secure, true);
  assert.equal(options.tls.rejectUnauthorized, true); assert.equal(options.tls.minVersion, "TLSv1.2");
  assert.equal(options.auth.user, "biuro@tymogarage.pl");
  assert.equal(options.auth.pass, "test-password");
  assert.equal(options.logger, false); assert.equal(options.debug, false);
  assert.equal(options.disableFileAccess, true); assert.equal(options.disableUrlAccess, true);
  return { async sendMail(message) {
    sends++;
    assert.deepEqual(message.envelope, { from: "biuro@tymogarage.pl", to: [job.recipient] });
    assert.equal(message.messageId, `<order-confirmation-${job.order_id}@tymogarage.pl>`);
    assert.equal(message.date.toISOString(), new Date(payload.paid_at).toISOString());
    assert.match(message.subject, /^TEST:/);
    assert.equal(message.text, orderConfirmation(payload));
    assert.equal(message.attachments[0].content.toString(), message.text);
    if (smtpError) throw smtpError;
    const mime = await previousTransport({ streamTransport: true, buffer: true }).sendMail(message);
    const raw = mime.message.toString();
    assert.match(raw, /multipart\/mixed/);
    assert.match(raw, /Content-Disposition: attachment/);
    assert.match(raw, /Historical terms/);
    return { accepted: [job.recipient] };
  }, close() { closed++; } };
};
globalThis.fetch = async (input, init) => {
  const target = String(input);
  assert.ok(target.startsWith("https://db.example.test/rest/v1/rpc/"));
  assert.equal(init.headers.Authorization, "Bearer test-db");
  if (target.endsWith("/claim_order_smtp_mail")) {
    claims++;
    return queueError ? new Response("", { status: 404 }) : Response.json([job]);
  }
  const body = JSON.parse(init.body);
  assert.equal(body.p_id, job.order_id); assert.equal(body.p_lease, job.lease);
  if (target.endsWith("/finish_order_mail")) {
    if (saveError) return new Response("", { status: 503 });
    completions.push(body.p_provider_id); return Response.json({ ok: true });
  }
  if (target.endsWith("/fail_order_smtp_mail")) {
    failures.push(body.p_retryable); return Response.json({ ok: true });
  }
  throw Error("Unexpected network request");
};
try {
  await deliverOrderMail({});
  await deliverOrderMail({ ...env, ORDER_MAIL_ENABLED: "false" });
  await deliverOrderMail({ ...env, ORDER_SMTP_PASSWORD: "" });
  assert.equal(claims, 0);
  await deliverOrderMail(env);
  assert.equal(sends, 1); assert.equal(completions.length, 1); assert.equal(failures.length, 0);
  smtpError = { command: "AUTH PLAIN", responseCode: 535 };
  await deliverOrderMail(env); assert.deepEqual(failures, [true]);
  smtpError = { command: "DATA", code: "ETIMEDOUT" };
  await deliverOrderMail(env); assert.deepEqual(failures, [true, false]);
  smtpError = null; saveError = true;
  await deliverOrderMail(env); assert.equal(failures.length, 2);
  assert.equal(closed, 4);
  queueError = true;
  await deliverOrderMail(env); assert.equal(sends, 4);
  const sql = await readFile(new URL("../supabase/009_order_mail_smtp.sql", import.meta.url), "utf8");
  assert.match(sql, /state='sending' and retry_at<=now/);
  assert.match(sql, /state='pending' and retry_at<=now\(\) and attempts<5/);
  assert.match(sql, /for update skip locked limit 1/);
  assert.match(sql, /lease=p_lease/);
  assert.match(sql, /return '\[\]'::jsonb/);
} finally { globalThis.fetch = previous; console.error = previousError; nodemailer.createTransport = previousTransport; }
console.log("Home.pl SMTP: TLS config, real MIME/attachment composition, immutable text, no external provider, safe rejection retry and ambiguous-send review OK (mock SMTP, no real mail).");
