import type { AccountEnv } from "./account-api";
import { orderConfirmation, type ConfirmedOrder } from "./order-confirmation";

export type OrderMailEnv = AccountEnv & { ORDER_MAIL_ENABLED?: string; RESEND_API_KEY?: string; ORDER_MAIL_FROM?: string };

// Explicit opt-in: no account is created and no customer data is sent without configuration.
export async function deliverOrderMail(env: OrderMailEnv) {
  if (env.ORDER_MAIL_ENABLED !== "true" || !env.RESEND_API_KEY || !env.ORDER_MAIL_FROM || !env.SUPABASE_SERVICE_ROLE_KEY) return;
  const db = async (rpc: string, body: unknown) => {
    const response = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL || "https://wgshalvkjfefavnbccil.supabase.co"}/rest/v1/rpc/${rpc}`, {
      method: "POST", headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY!, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error("ORDER_MAIL_DB");
    return response.json();
  };
  try {
    const jobs = await db("claim_order_mail", {}) as { order_id: string; recipient: string; payload: ConfirmedOrder; lease: string }[];
    for (const job of jobs) {
      try {
        const text = orderConfirmation(job.payload);
        const result = await fetch("https://api.resend.com/emails", {
          method: "POST", redirect: "error", signal: AbortSignal.timeout(15000),
          headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": `order-confirmation/${job.order_id}` },
          body: JSON.stringify({ from: env.ORDER_MAIL_FROM, to: [job.recipient],
            subject: `${job.payload.environment === "sandbox" ? "TEST: " : ""}Potwierdzenie zamowienia Wystawiacz by Tymo`,
            text, attachments: [{ filename: `zamowienie-${job.order_id}.txt`, content: Buffer.from(text).toString("base64") }] }),
        });
        const answer = result.ok ? await result.json() as { id?: string } : null;
        // Accepted by the provider is not proof of delivery to the recipient's inbox.
        await db("finish_order_mail", { p_id: job.order_id, p_lease: job.lease, p_provider_id: typeof answer?.id === "string" && answer.id.length <= 200 ? answer.id : null });
      } catch {
        // Lease expiry retries with the same provider idempotency key and immutable body.
        console.error(JSON.stringify({ event: "order_mail_attempt_failed" }));
      }
    }
  } catch { console.error(JSON.stringify({ event: "order_mail_queue_unavailable" })); }
}
