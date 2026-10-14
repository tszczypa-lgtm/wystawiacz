import { createHash, timingSafeEqual, verify, X509Certificate } from "node:crypto";
import { accountContext, type AccountEnv } from "./account-api";
import { validateCompany } from "./account-validation";

export type TpayEnv = AccountEnv & {
  TPAY_ENABLED?: string; TPAY_ENVIRONMENT?: string; TPAY_LIVE_APPROVED?: string;
  TPAY_CLIENT_ID?: string; TPAY_CLIENT_SECRET?: string;
  TPAY_MERCHANT_ID?: string; TPAY_SECURITY_CODE?: string;
};
class PaymentError extends Error {
  constructor(public status: number, message: string, public code = "TPAY_ERROR") { super(message); }
}
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
const uuid = /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;
export function tpayConfig(env: TpayEnv) {
  const sandbox = env.TPAY_ENVIRONMENT === "sandbox";
  if (!sandbox && env.TPAY_ENVIRONMENT !== "production") throw new PaymentError(503, "Nie wybrano srodowiska Tpay.");
  if (!env.TPAY_CLIENT_ID || !env.TPAY_CLIENT_SECRET || !/^\d+$/.test(env.TPAY_MERCHANT_ID || "") || !env.TPAY_SECURITY_CODE || !env.SUPABASE_SERVICE_ROLE_KEY) throw new PaymentError(503, "Tpay nie jest jeszcze skonfigurowany.");
  const origin = new URL(env.APP_ORIGIN || "https://invalid.local");
  if (!env.APP_ORIGIN || origin.protocol !== "https:" || origin.origin !== env.APP_ORIGIN) throw new PaymentError(503, "Nieprawidlowa domena platnosci.");
  return { sandbox, origin: origin.origin, environment: sandbox ? "sandbox" : "production", api: sandbox ? "https://openapi.sandbox.tpay.com" : "https://api.tpay.com", secure: sandbox ? "https://secure.sandbox.tpay.com" : "https://secure.tpay.com" };
}
export function paymentUrl(raw: string, secure: string) {
  const url = new URL(raw);
  if (url.origin !== secure || url.username || url.password) throw new PaymentError(503, "Nieprawidlowy adres platnosci.");
  return url.href;
}
export function amountInGrosz(value: string) {
  if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(value)) return -1;
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
function sameHex(expected: string, received: string) {
  return /^[a-f\d]{32}$/i.test(received) && timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(received, "hex"));
}
export function verifyNotificationFields(raw: string, env: TpayEnv) {
  const config = tpayConfig(env);
  const fields = new URLSearchParams(raw);
  for (const key of new Set(fields.keys())) if (fields.getAll(key).length !== 1) throw new PaymentError(400, "Powtorzone pole powiadomienia.", "TPAY_FIELD_DUPLICATE");
  const get = (key: string) => fields.get(key) || "";
  if (get("id") !== env.TPAY_MERCHANT_ID) throw new PaymentError(400, "Nieprawidlowy akceptant.", "TPAY_MERCHANT_MISMATCH");
  if (!uuid.test(get("tr_crc"))) throw new PaymentError(400, "Nieprawidlowy identyfikator zamowienia.", "TPAY_ORDER_FORMAT");
  if (!/^TR-[A-Z0-9-]{1,80}$/i.test(get("tr_id"))) throw new PaymentError(400, "Nieprawidlowy tytul transakcji.", "TPAY_TITLE_FORMAT");
  // test_mode is a transaction flag, not the identity of the sandbox environment.
  // Environment isolation is enforced by the preceding JWS certificate and the DB order.
  if (!["0", "1"].includes(get("test_mode")) || (!config.sandbox && get("test_mode") !== "0")) throw new PaymentError(400, "Nieprawidlowy tryb transakcji.", "TPAY_TEST_MODE_MISMATCH");
  if (amountInGrosz(get("tr_amount")) !== 50000) throw new PaymentError(400, "Nieprawidlowa kwota transakcji.", "TPAY_AMOUNT_MISMATCH");
  if (amountInGrosz(get("tr_paid")) !== 50000) throw new PaymentError(400, "Nieprawidlowa zaplacona kwota.", "TPAY_PAID_MISMATCH");
  if (get("tr_currency") && get("tr_currency") !== "PLN") throw new PaymentError(400, "Nieprawidlowa waluta.", "TPAY_CURRENCY_MISMATCH");
  if (get("tr_error") !== "none") throw new PaymentError(400, "Blad transakcji.", "TPAY_TRANSACTION_ERROR");
  const checksum = createHash("md5").update(get("id") + get("tr_id") + get("tr_amount") + get("tr_crc") + env.TPAY_SECURITY_CODE).digest("hex");
  if (!sameHex(checksum, get("md5sum"))) throw new PaymentError(400, "Nieprawidlowa suma kontrolna.", "TPAY_CHECKSUM_MISMATCH");
  const status = get("tr_status").toLowerCase();
  if (!["true", "chargeback"].includes(status)) throw new PaymentError(400, "Nieprawidlowy status.", "TPAY_STATUS_INVALID");
  return { order: get("tr_crc"), title: get("tr_id"), refunded: status === "chargeback", environment: config.environment };
}
// Only the exact Tpay certificate endpoint is fetched; untrusted x5u cannot redirect.
export async function verifyTpayJws(raw: string, signature: string, secure: string) {
  if (signature.length > 8192) throw new PaymentError(400, "Nieprawidlowy podpis.");
  const parts = signature.split(".");
  if (parts.length !== 3 || parts[1] !== "" || !/^[\w-]+$/.test(parts[0]) || !/^[\w-]+$/.test(parts[2])) throw new PaymentError(400, "Brak podpisu JWS.");
  const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  if (header.alg !== "RS256" || header.x5u !== `${secure}/x509/notifications-jws.pem` || header.crit || header.b64 === false) throw new PaymentError(400, "Nieprawidlowy naglowek JWS.");
  const certificate = async (url: string) => {
    let response;
    try { response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(15000) }); }
    catch { throw new PaymentError(503, "Nie mozna pobrac certyfikatu Tpay.", "TPAY_CERT_NETWORK"); }
    if (response.status >= 300 && response.status < 400) throw new PaymentError(503, "Odrzucono przekierowanie certyfikatu Tpay.", "TPAY_CERT_REDIRECT");
    if (!response.ok) throw new PaymentError(503, "Nie mozna sprawdzic certyfikatu Tpay.", `TPAY_CERT_HTTP_${response.status}`);
    const pem = await response.text();
    if (pem.length > 20000) throw new PaymentError(400, "Nieprawidlowy certyfikat.");
    try { return new X509Certificate(pem); }
    catch { throw new PaymentError(503, "Nie mozna odczytac certyfikatu Tpay.", "TPAY_CERT_PARSE"); }
  };
  const leaf = await certificate(header.x5u);
  const root = await certificate(`${secure}/x509/tpay-jws-root.pem`);
  for (const cert of [leaf, root]) if (Date.parse(cert.validFrom) > Date.now() || Date.parse(cert.validTo) < Date.now()) throw new PaymentError(400, "Certyfikat poza okresem waznosci.");
  let valid;
  try { valid = root.ca && leaf.verify(root.publicKey) && verify("RSA-SHA256", Buffer.from(`${parts[0]}.${Buffer.from(raw).toString("base64url")}`), leaf.publicKey, Buffer.from(parts[2], "base64url")); }
  catch { throw new PaymentError(503, "Nie mozna wykonac weryfikacji podpisu.", "TPAY_CRYPTO_RUNTIME"); }
  if (!valid) throw new PaymentError(400, "Nieprawidlowy podpis Tpay.");
}
function database(env: TpayEnv) {
  return async (path: string, body: unknown) => {
    const response = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL || "https://wgshalvkjfefavnbccil.supabase.co"}/rest/v1/${path}`, {
      method: "POST", headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY!, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({})) as { code?: string };
      const code = typeof error.code === "string" && /^[A-Z0-9]{1,10}$/.test(error.code) ? error.code : String(response.status);
      throw new PaymentError(503, "Nie zapisano platnosci. Sprawdz migracje 005; nie ponawiaj zaplaty.", `TPAY_DB_${code}`);
    }
    return response.json();
  };
}
export async function handleTpayApi(request: Request, env: TpayEnv): Promise<Response> {
  let webhookStage = "";
  try {
    const path = new URL(request.url).pathname.slice("/api/account/tpay".length);
    if (path === "/webhook" && request.method === "POST") {
      webhookStage = "configuration";
      const config = tpayConfig(env);
      if (!request.headers.get("Content-Type")?.startsWith("application/x-www-form-urlencoded")) throw new PaymentError(400, "Nieprawidlowy typ danych.");
      if (Number(request.headers.get("Content-Length")) > 16384) throw new PaymentError(413, "Zbyt duzo danych.");
      const raw = await request.text();
      if (Buffer.byteLength(raw) > 16384) throw new PaymentError(413, "Zbyt duzo danych.");
      webhookStage = "signature";
      await verifyTpayJws(raw, request.headers.get("X-JWS-Signature") || "", config.secure);
      webhookStage = "fields";
      const data = verifyNotificationFields(raw, env);
      webhookStage = "settlement";
      await database(env)("rpc/settle_tpay_order", { p_id: data.order, p_environment: data.environment, p_title: data.title, p_refunded: data.refunded });
      return new Response("TRUE", { headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
    }
    const context = await accountContext(request, env);
    if (request.method === "GET" && path === "/status") {
      let enabled = false, sandbox = true;
      let issue = "";
      try {
        const config = tpayConfig(env); sandbox = config.sandbox;
        enabled = env.TPAY_ENABLED === "true" && (sandbox || env.TPAY_LIVE_APPROVED === "true");
        if (!enabled) issue = env.TPAY_ENABLED !== "true" ? "TPAY_ENABLED musi miec wartosc true." : "Platnosci produkcyjne nie zostaly zatwierdzone. Testy wymagaja TPAY_ENVIRONMENT=sandbox.";
      } catch (error) {
        const required = ["TPAY_CLIENT_ID", "TPAY_CLIENT_SECRET", "TPAY_MERCHANT_ID", "TPAY_SECURITY_CODE", "SUPABASE_SERVICE_ROLE_KEY", "APP_ORIGIN"] as const;
        const missing = required.filter(name => !env[name]);
        issue = missing.length ? `Brakuje ustawien Cloudflare: ${missing.join(", ")}.` : error instanceof PaymentError ? error.message : "Sprawdz APP_ORIGIN i konfiguracje Tpay.";
        if (env.TPAY_MERCHANT_ID && !/^\d+$/.test(env.TPAY_MERCHANT_ID)) issue = "TPAY_MERCHANT_ID musi zawierac tylko cyfry, bez spacji.";
      }
      return json({ enabled, sandbox, amount: 50000, currency: "PLN", ...(context.isAdmin ? { issue } : {}) });
    }
    if (path !== "/checkout" || request.method !== "POST") return json({ message: "Nieznana trasa platnosci." }, 404);
    const config = tpayConfig(env);
    if (env.TPAY_ENABLED !== "true" || (!config.sandbox && env.TPAY_LIVE_APPROVED !== "true")) throw new PaymentError(503, "Zakup przez Tpay nie jest jeszcze uruchomiony.");
    if (request.headers.get("Origin") !== config.origin || new URL(request.url).origin !== config.origin) throw new PaymentError(403, "Nieprawidlowa domena.");
    if (context.account.suspended) throw new PaymentError(403, "Konto zawieszone.");
    if (config.sandbox && !context.isAdmin) throw new PaymentError(403, "Platnosci testowe sa dostepne tylko administratorowi.");
    if (context.account.stripe_subscription_id) throw new PaymentError(409, "Najpierw wyjasnij istniejacy abonament z administratorem.");
    let company;
    try { company = validateCompany(context.account.company); }
    catch { throw new PaymentError(400, "Uzupelnij poprawne dane firmy przed zakupem."); }
    const db = database(env);
    const claim = await db("rpc/claim_tpay_order", { p_owner: context.user.id, p_environment: config.environment }) as { id: string; created: boolean; payment_url?: string };
    if (!claim.created) {
      if (claim.payment_url) return json({ url: paymentUrl(claim.payment_url, config.secure) });
      throw new PaymentError(409, "Platnosc jest przygotowywana lub jej wynik jest niepewny. Nie tworzymy drugiej; skontaktuj sie z administratorem.");
    }
    const auth = await fetch(`${config.api}/oauth/auth`, { method: "POST", signal: AbortSignal.timeout(15000), headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: env.TPAY_CLIENT_ID!, client_secret: env.TPAY_CLIENT_SECRET! }) });
    if (!auth.ok) { await db("rpc/fail_tpay_order", { p_id: claim.id }); throw new PaymentError(503, "Nie udalo sie uwierzytelnic w Tpay."); }
    const token = await auth.json() as { access_token?: string };
    if (!token.access_token) throw new PaymentError(503, "Nieprawidlowa odpowiedz Tpay.");
    // Never automatically retry this POST: a lost response may still mean an order exists.
    const response = await fetch(`${config.api}/transactions`, { method: "POST", signal: AbortSignal.timeout(25000), headers: { Authorization: `Bearer ${token.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({
      amount: 500, currency: "PLN", description: "Wystawiacz by Tymo - miesiac dostepu", hiddenDescription: claim.id,
      payer: { email: context.account.email, name: company.name },
      callbacks: { notification: { url: `${config.origin}/api/account/tpay/webhook` }, payerUrls: { success: `${config.origin}/panel/billing?tpay=return`, error: `${config.origin}/panel/billing?tpay=error` } },
    }) });
    if (!response.ok) {
      if ([400, 401, 403, 422].includes(response.status)) await db("rpc/fail_tpay_order", { p_id: claim.id });
      throw new PaymentError(503, "Tpay nie potwierdzil utworzenia platnosci. Nie ponawiaj zaplaty bez sprawdzenia.");
    }
    const transaction = await response.json() as { result: string; transactionId: string; title: string; transactionPaymentUrl: string };
    if (transaction.result !== "success" || !/^[A-Z\d]{26}$/.test(transaction.transactionId) || !/^TR-[A-Z0-9-]{1,80}$/i.test(transaction.title)) throw new PaymentError(503, "Nieprawidlowa odpowiedz operatora.");
    const url = paymentUrl(transaction.transactionPaymentUrl, config.secure);
    await db("rpc/attach_tpay_transaction", { p_id: claim.id, p_transaction: transaction.transactionId, p_title: transaction.title, p_url: url });
    return json({ url });
  } catch (error) {
    if (webhookStage) console.error(JSON.stringify({ event: "tpay_webhook_failed", stage: webhookStage, code: error instanceof PaymentError ? error.code : "TPAY_UNEXPECTED", status: error instanceof PaymentError ? error.status : 503 }));
    if (!(error instanceof PaymentError) && (error as { status?: number })?.status === 401) return json({ message: "Zaloguj sie ponownie." }, 401);
    return json({ message: error instanceof PaymentError ? error.message : "Nie udalo sie obsluzyc platnosci. Nie ponawiaj zaplaty; sprawdz status lub skontaktuj sie z administratorem." }, error instanceof PaymentError ? error.status : 503);
  }
}
