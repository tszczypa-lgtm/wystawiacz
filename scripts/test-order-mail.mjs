import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const url = source => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const confirmation = url(compile(await readFile(new URL("../lib/order-confirmation.ts", import.meta.url), "utf8")));
const mail = url(compile(await readFile(new URL("../lib/order-mail.ts", import.meta.url), "utf8")).replace('"./order-confirmation"', JSON.stringify(confirmation)));
const { deliverOrderMail } = await import(mail);
const { orderConfirmation } = await import(confirmation);
const payload = { id: "00000000-0000-0000-0000-000000000002", environment: "sandbox", status: "paid", amount_grosz: 50000, currency: "PLN", transaction_title: "TR-TEST", created_at: "2026-10-28T22:56:36Z", paid_at: "2026-10-28T22:56:49Z", access_until: null, checkout_acceptance: { statements: { terms: "Historical statement" }, documents: { terms: { version: "old", text: "Historical terms" }, privacy: { version: "old", text: "Historical privacy" } } } };
const job = { order_id: payload.id, recipient: "buyer@example.test", payload, lease: "lease-test" };
const env = { ORDER_MAIL_ENABLED: "true", RESEND_API_KEY: "test-only", ORDER_MAIL_FROM: "Test <test@example.test>", SUPABASE_SERVICE_ROLE_KEY: "test-db", NEXT_PUBLIC_SUPABASE_URL: "https://db.example.test" };
const previous = globalThis.fetch, previousError = console.error;
let claims = 0, sends = 0, completions = [], providerError = false, networkError = false, queueError = false;
console.error = () => {};
globalThis.fetch = async (input, init) => {
  const target = String(input);
  if (target.endsWith("/claim_order_mail")) {
    claims++;
    if (queueError) return new Response("", { status: 503 });
    assert.equal(init.headers.Authorization, "Bearer test-db");
    return Response.json([job]);
  }
  if (target === "https://api.resend.com/emails") {
    sends++;
    assert.equal(init.headers["Idempotency-Key"], `order-confirmation/${payload.id}`);
    const body = JSON.parse(init.body);
    assert.deepEqual(body.to, [job.recipient]);
    assert.match(body.subject, /^TEST:/);
    assert.equal(body.text, orderConfirmation(payload));
    assert.equal(Buffer.from(body.attachments[0].content, "base64").toString(), body.text);
    assert.match(body.text, /Historical terms/);
    assert.match(body.text, /Historical privacy/);
    if (networkError) throw Error("Ambiguous network result");
    return providerError ? new Response("", { status: 429 }) : Response.json({ id: "provider-test-id" });
  }
  if (target.endsWith("/finish_order_mail")) {
    const body = JSON.parse(init.body);
    assert.equal(body.p_id, job.order_id); assert.equal(body.p_lease, job.lease);
    completions.push(body.p_provider_id);
    return Response.json({ ok: true });
  }
  throw Error("Unexpected network request");
};
try {
  await deliverOrderMail({});
  await deliverOrderMail({ ...env, ORDER_MAIL_ENABLED: "false" });
  await deliverOrderMail({ ...env, RESEND_API_KEY: "" });
  assert.equal(claims, 0);
  await deliverOrderMail(env);
  assert.equal(sends, 1); assert.deepEqual(completions, ["provider-test-id"]);
  providerError = true;
  await deliverOrderMail(env);
  assert.deepEqual(completions, ["provider-test-id", null]);
  networkError = true;
  await deliverOrderMail(env);
  assert.equal(completions.length, 2); // Ambiguous sends retain the lease, never mark as accepted.
  queueError = true;
  await deliverOrderMail(env); // Outbox failure must not turn successful settlement into a failed payment.
  assert.equal(sends, 3);
  const sql = await readFile(new URL("../supabase/008_order_confirmation_mail.sql", import.meta.url), "utf8");
  assert.match(sql, /on conflict\(order_id\) do nothing/);
  assert.match(sql, /for update skip locked/);
  assert.match(sql, /interval '23 hours'/);
  assert.match(sql, /lease=p_lease/);
  assert.match(sql, /revoke all on public.order_confirmation_mail from public,anon,authenticated/);
} finally { globalThis.fetch = previous; console.error = previousError; }
console.log("Order mail: immutable documents, explicit opt-in, scoped recipient, idempotency, provider failures and queue guards OK (mocked network).");
