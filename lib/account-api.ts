import { validateCompany } from "./account-validation";

export type AccountEnv = {
  SUPABASE_SERVICE_ROLE_KEY?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
  BILLING_ENFORCED?: string;
  BILLING_ENABLED?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_PRICE_ID?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  APP_ORIGIN?: string;
};
export type CustomerAccount = {
  owner_id: string; email: string; company: unknown; suspended: boolean;
  access_mode: "standard" | "free"; free_until: string | null;
  subscription_status: string; paid_until: string | null; cancel_at_period_end: boolean;
  stripe_customer_id: string | null; stripe_subscription_id: string | null;
};
class AccountError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
function json(value: unknown, status = 200) { return Response.json(value, { status, headers: { "Cache-Control": "no-store" } }); }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const encoder = new TextEncoder();
type StripePrice = { active: boolean; currency: string; type: string; recurring?: { interval: string; interval_count: number }; unit_amount: number; tax_behavior: string };
type StripeSubscription = { id: string; status: string; pause_collection?: unknown; cancel_at_period_end: boolean; latest_invoice?: { status: string }; items: { data: { price: { id: string }; quantity: number; current_period_end: number }[] } };
type StripeSubscriptions = { has_more: boolean; data: StripeSubscription[] };

function database(env: AccountEnv) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) throw new AccountError(503, "Administrator musi skonfigurować bazę kont na serwerze.");
  const base = env.NEXT_PUBLIC_SUPABASE_URL || "https://wgshalvkjfefavnbccil.supabase.co";
  return async (path: string, options: RequestInit = {}) => {
    const response = await fetch(`${base}/rest/v1/${path}`, { ...options, headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY!, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json", ...options.headers,
    } });
    if (!response.ok) throw new AccountError(503, "Nie udało się odczytać lub zapisać konta. Sprawdź migrację 003 w Supabase.");
    return response.status === 204 ? null : response.json();
  };
}
export async function accountContext(request: Request, env: AccountEnv) {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) throw new AccountError(401, "Zaloguj się do Wystawiacza.");
  const base = env.NEXT_PUBLIC_SUPABASE_URL || "https://wgshalvkjfefavnbccil.supabase.co";
  const response = await fetch(`${base}/auth/v1/user`, { headers: { Authorization: authorization, apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_Tc8J1YDoJoslkenvJJ8e5w_eMa9GEet" } });
  if (!response.ok) throw new AccountError(401, "Sesja wygasła. Zaloguj się ponownie.");
  const user = await response.json() as { id: string; email_confirmed_at?: string };
  if (!uuid.test(user.id) || !user.email_confirmed_at) throw new AccountError(401, "Potwierdź adres e-mail konta.");
  const db = database(env);
  const accounts = await db(`customer_accounts?owner_id=eq.${user.id}&select=*`) as CustomerAccount[];
  if (!accounts[0]) throw new AccountError(503, "Brak profilu konta. Administrator musi wykonać migrację bazy.");
  const roles = await db(`account_admins?owner_id=eq.${user.id}&select=owner_id`) as { owner_id: string }[];
  return { user, account: accounts[0], isAdmin: roles.length > 0, db };
}
export function accountAccess(account: CustomerAccount, enforced: boolean, isAdmin = false, now = Date.now()) {
  if (account.suspended) return { allowed: false, reason: "Konto zawieszone. Skontaktuj się z administratorem." };
  if (isAdmin) return { allowed: true, reason: "Administrator" };
  if (account.access_mode === "free" && (!account.free_until || Date.parse(account.free_until) > now)) return { allowed: true, reason: "Darmowy dostęp od administratora" };
  if (account.subscription_status === "active" && account.paid_until && Date.parse(account.paid_until) > now) return { allowed: true, reason: "Opłacony abonament" };
  if (!enforced) return { allowed: true, reason: "Dostęp roboczy (płatności nie są wymagane)" };
  return { allowed: false, reason: "Brak aktywnego abonamentu lub darmowego dostępu." };
}
export async function protectAllegroRequest(request: Request, env: AccountEnv, next: () => Promise<Response>) {
  // OAuth callback has no bearer token; no seller API operation happens there.
  if (new URL(request.url).pathname === "/api/allegro/auth/callback") return next();
  try {
    const context = await accountContext(request, env);
    const access = accountAccess(context.account, env.BILLING_ENFORCED === "true", context.isAdmin);
    if (!access.allowed) return json({ message: access.reason }, 403);
    return next();
  } catch (error) { return failure(error); }
}
function failure(error: unknown) { return json({ message: error instanceof AccountError ? error.message : "Nie udało się obsłużyć żądania. Spróbuj ponownie." }, error instanceof AccountError ? error.status : 503); }
async function body(request: Request) {
  if (Number(request.headers.get("Content-Length")) > 8192) throw new AccountError(413, "Zbyt dużo danych.");
  const raw = await request.text();
  if (encoder.encode(raw).length > 8192) throw new AccountError(413, "Zbyt dużo danych.");
  try { return JSON.parse(raw) as Record<string, unknown>; } catch { throw new AccountError(400, "Nieprawidłowe dane."); }
}
function checkOrigin(request: Request, env: AccountEnv) {
  if (request.headers.get("Origin") !== new URL(request.url).origin || (env.APP_ORIGIN && new URL(request.url).origin !== env.APP_ORIGIN)) throw new AccountError(403, "Nieprawidłowe źródło żądania.");
}

async function stripe<T>(env: AccountEnv, path: string, values?: Record<string, string>, idempotency?: string): Promise<T> {
  if (!env.STRIPE_SECRET_KEY) throw new AccountError(503, "Płatności nie są jeszcze skonfigurowane.");
  const response = await fetch(`https://api.stripe.com/v1/${path}`, { method: values ? "POST" : "GET", headers: {
    Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "Stripe-Version": "2025-03-31.basil",
    ...(values ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    ...(idempotency ? { "Idempotency-Key": idempotency } : {}),
  }, body: values ? new URLSearchParams(values) : undefined });
  if (!response.ok) throw new AccountError(502, "Operator płatności odrzucił żądanie. Spróbuj ponownie lub skontaktuj się z administratorem.");
  return await response.json() as T;
}
async function configuredPrice(env: AccountEnv) {
  if (env.BILLING_ENABLED !== "true" || !env.STRIPE_PRICE_ID || !env.STRIPE_WEBHOOK_SECRET || !env.APP_ORIGIN?.startsWith("https://")) throw new AccountError(503, "Zakup abonamentu nie jest jeszcze uruchomiony.");
  const price = await stripe<StripePrice>(env, `prices/${encodeURIComponent(env.STRIPE_PRICE_ID)}`);
  if (!price.active || price.currency !== "pln" || price.type !== "recurring" || price.recurring?.interval !== "month" || price.recurring?.interval_count !== 1 || price.tax_behavior !== "inclusive" || !Number.isInteger(price.unit_amount) || price.unit_amount <= 0) throw new AccountError(503, "Nieprawidłowa konfiguracja miesięcznego planu PLN z podatkiem w cenie.");
  return price;
}
async function customer(context: Awaited<ReturnType<typeof accountContext>>, env: AccountEnv) {
  let details;
  try { details = validateCompany(context.account.company); } catch (error) { throw new AccountError(400, (error as Error).message); }
  const values = { email: context.account.email, name: details.name, "address[line1]": details.street, "address[postal_code]": details.postcode, "address[city]": details.city, "address[country]": "PL", "metadata[nip]": details.nip, "metadata[owner_id]": context.user.id };
  if (context.account.stripe_customer_id) {
    await stripe(env, `customers/${encodeURIComponent(context.account.stripe_customer_id)}`, values);
    return context.account.stripe_customer_id;
  }
  const created = await stripe<{ id: string }>(env, "customers", values, `customer-${context.user.id}`);
  await context.db(`customer_accounts?owner_id=eq.${context.user.id}`, { method: "PATCH", body: JSON.stringify({ stripe_customer_id: created.id }) });
  return created.id as string;
}

export async function verifyStripeSignature(raw: string, header: string | null, secret: string, now = Date.now()) {
  const parts = (header || "").split(",").map(part => part.split("="));
  const timestamp = parts.find(([key]) => key === "t")?.[1];
  if (!timestamp || !/^\d+$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  for (const [type, value] of parts) {
    if (type !== "v1" || !/^[a-f0-9]{64}$/i.test(value)) continue;
    const bytes = Uint8Array.from(value.match(/../g)!, hex => parseInt(hex, 16));
    if (await crypto.subtle.verify("HMAC", key, bytes, encoder.encode(`${timestamp}.${raw}`))) return true;
  }
  return false;
}
async function webhook(request: Request, env: AccountEnv) {
  if (!env.STRIPE_WEBHOOK_SECRET || !env.STRIPE_SECRET_KEY || !env.STRIPE_PRICE_ID) throw new AccountError(503, "Webhook nie jest skonfigurowany.");
  if (Number(request.headers.get("Content-Length")) > 1024 * 1024) throw new AccountError(413, "Zbyt duże zdarzenie.");
  const raw = await request.text();
  if (encoder.encode(raw).length > 1024 * 1024) throw new AccountError(413, "Zbyt duże zdarzenie.");
  if (!await verifyStripeSignature(raw, request.headers.get("Stripe-Signature"), env.STRIPE_WEBHOOK_SECRET)) throw new AccountError(400, "Nieprawidłowy podpis zdarzenia.");
  const event = JSON.parse(raw);
  if (!event.id || !Number.isInteger(event.created)) throw new AccountError(400, "Nieprawidłowe zdarzenie.");
  if (!["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted", "invoice.paid", "invoice.payment_failed", "checkout.session.completed"].includes(event.type)) return json({ received: true });
  const object = event.data?.object;
  const customerId = typeof object?.customer === "string" ? object.customer : object?.customer?.id;
  if (!customerId) return json({ received: true });
  const db = database(env);
  const accounts = await db(`customer_accounts?stripe_customer_id=eq.${encodeURIComponent(customerId)}&select=owner_id`) as CustomerAccount[];
  if (!accounts.length) return json({ received: true });
  // Re-fetch current subscriptions rather than trusting an old/reordered event.
  const subscriptions = await stripe<StripeSubscriptions>(env, `subscriptions?customer=${encodeURIComponent(customerId)}&status=all&limit=100&expand[]=data.latest_invoice`);
  if (subscriptions.has_more) throw new AccountError(503, "Zbyt wiele abonamentów; wymagana kontrola administratora.");
  const matching = subscriptions.data.filter((sub: { items: { data: { price: { id: string } }[] } }) => sub.items.data.some(item => item.price.id === env.STRIPE_PRICE_ID));
  const selected = matching.find((sub: { status: string }) => sub.status === "active") || matching[0];
  if (!selected) return json({ received: true });
  const item = selected.items.data.find((entry: { price: { id: string } }) => entry.price.id === env.STRIPE_PRICE_ID);
  const end = item?.current_period_end;
  const paid = selected.status === "active" && !selected.pause_collection && selected.latest_invoice?.status === "paid" && item?.quantity === 1 && Number.isFinite(end);
  await db("rpc/apply_billing_event", { method: "POST", body: JSON.stringify({ p_event_id: event.id, p_created: event.created, p_customer: customerId, p_subscription: selected.id, p_status: selected.status, p_paid_until: paid && end ? new Date(end * 1000).toISOString() : null, p_cancel: Boolean(selected.cancel_at_period_end) }) });
  return json({ received: true });
}

export async function handleAccountApi(request: Request, env: AccountEnv): Promise<Response> {
  try {
    const url = new URL(request.url);
    const path = url.pathname.slice("/api/account".length);
    if (path === "/stripe-webhook" && request.method === "POST") return await webhook(request, env);
    if (request.method !== "GET") checkOrigin(request, env);
    const context = await accountContext(request, env);
    const { account, isAdmin, db } = context;
    if (request.method === "GET" && path === "/me") {
      let price = null;
      let billingIssue = false;
      if (env.BILLING_ENABLED === "true") {
        try {
          const configured = await configuredPrice(env);
          price = { amount: configured.unit_amount, currency: configured.currency, interval: "month" };
        } catch { billingIssue = true; }
      }
      return json({ account: { email: account.email, company: account.company, access_mode: account.access_mode, free_until: account.free_until, suspended: account.suspended, subscription_status: account.subscription_status, paid_until: account.paid_until, cancel_at_period_end: account.cancel_at_period_end }, isAdmin, access: accountAccess(account, env.BILLING_ENFORCED === "true", isAdmin), billingEnabled: Boolean(price), billingIssue, price, hasCustomer: Boolean(account.stripe_customer_id) });
    }
    if (request.method === "PUT" && path === "/company") {
      const payload = await body(request);
      let company;
      try { company = validateCompany(payload.company); } catch (error) { throw new AccountError(400, (error as Error).message); }
      await db(`customer_accounts?owner_id=eq.${context.user.id}`, { method: "PATCH", body: JSON.stringify({ company, updated_at: new Date().toISOString() }) });
      return json({ ok: true });
    }
    if (request.method === "POST" && ["/checkout", "/portal"].includes(path)) {
      if (!env.APP_ORIGIN?.startsWith("https://") || url.origin !== env.APP_ORIGIN) throw new AccountError(403, "Nieprawidłowa domena płatności.");
      if (path === "/portal") {
        // Suspended customers must still be able to cancel and manage billing.
        if (!account.stripe_customer_id) throw new AccountError(409, "Nie masz jeszcze konta rozliczeniowego.");
        const portal = await stripe<{ url: string }>(env, "billing_portal/sessions", { customer: account.stripe_customer_id, return_url: `${env.APP_ORIGIN}/panel/billing` });
        return json({ url: portal.url });
      }
      if (account.suspended) throw new AccountError(403, "Konto jest zawieszone. Płatność nie odwiesza konta.");
      await configuredPrice(env);
      if (accountAccess(account, true, isAdmin).allowed) throw new AccountError(409, "Masz już aktywny lub darmowy dostęp. Nie pobieramy kolejnej opłaty.");
      const customerId = await customer(context, env);
      const subscriptions = await stripe<StripeSubscriptions>(env, `subscriptions?customer=${encodeURIComponent(customerId)}&status=all&limit=100`);
      if (subscriptions.has_more || subscriptions.data.some((sub: { status: string }) => !["canceled", "incomplete_expired"].includes(sub.status))) throw new AccountError(409, "Istnieje już abonament. Zarządzaj nim w panelu płatności zamiast zakładać drugi.");
      const attempt = await db("rpc/claim_checkout", { method: "POST", body: JSON.stringify({ p_owner: context.user.id }) }) as { key: string; expires_at: number };
      const session = await stripe<{ url: string }>(env, "checkout/sessions", { mode: "subscription", customer: customerId,
        "line_items[0][price]": env.STRIPE_PRICE_ID!, "line_items[0][quantity]": "1",
        "subscription_data[metadata][owner_id]": context.user.id, client_reference_id: context.user.id,
        billing_address_collection: "required", "tax_id_collection[enabled]": "true", "customer_update[address]": "auto", "customer_update[name]": "auto",
        expires_at: String(attempt.expires_at),
        success_url: `${env.APP_ORIGIN}/panel/billing?payment=returned`, cancel_url: `${env.APP_ORIGIN}/panel/billing`,
      }, `checkout-${context.user.id}-${attempt.key}`);
      return json({ url: session.url });
    }
    if (path.startsWith("/admin/")) {
      if (!isAdmin || account.suspended) throw new AccountError(403, "Brak uprawnień administratora.");
      if (request.method === "GET" && path === "/admin/accounts") {
        const offset = Number(url.searchParams.get("offset") || 0);
        if (!Number.isInteger(offset) || offset < 0 || offset > 100000) throw new AccountError(400, "Nieprawidłowa strona.");
        const accounts = await db(`customer_accounts?select=owner_id,email,company,access_mode,free_until,suspended,subscription_status,paid_until,created_at&order=created_at.desc&limit=25&offset=${offset}`) as CustomerAccount[];
        const admins = await db("account_admins?select=owner_id") as { owner_id: string }[];
        return json({ accounts: accounts.map((entry: CustomerAccount) => ({ ...entry, isAdmin: admins.some(admin => admin.owner_id === entry.owner_id) })), offset });
      }
      if (request.method === "GET" && path === "/admin/audit") return json({ entries: await db("account_audit?select=*&order=created_at.desc&limit=100") });
      if (request.method === "POST" && path === "/admin/action") {
        const payload = await body(request);
        if (typeof payload.target !== "string" || !uuid.test(payload.target) || !["suspend", "resume", "grant_free", "revoke_free"].includes(String(payload.action)) || typeof payload.reason !== "string" || payload.reason.trim().length < 3 || payload.reason.length > 500) throw new AccountError(400, "Wybierz konto, działanie i podaj powód (3–500 znaków).");
        if (payload.target === context.user.id) throw new AccountError(400, "Nie możesz zmieniać własnych uprawnień.");
        let expiry: string | null = null;
        if (payload.action === "grant_free" && payload.freeUntil) {
          if (typeof payload.freeUntil !== "string" || !Number.isFinite(Date.parse(payload.freeUntil)) || Date.parse(payload.freeUntil) <= Date.now()) throw new AccountError(400, "Podaj przyszłą datę końca dostępu.");
          expiry = new Date(payload.freeUntil).toISOString();
        }
        const targetRoles = await db(`account_admins?owner_id=eq.${payload.target}&select=owner_id`) as { owner_id: string }[];
        if (targetRoles.length) throw new AccountError(400, "Nie zmieniamy dostępu administratorów w tym panelu.");
        await db("rpc/admin_account_action", { method: "POST", body: JSON.stringify({ p_actor: context.user.id, p_target: payload.target, p_action: payload.action, p_reason: payload.reason.trim(), p_free_until: expiry }) });
        return json({ ok: true });
      }
    }
    throw new AccountError(404, "Nieznana operacja.");
  } catch (error) { return failure(error); }
}
