import type { AccountEnv } from "./account-api";
import { orderConfirmation, type ConfirmedOrder } from "./order-confirmation";
import { orderSmtpConfig, type OrderMailSettings } from "./order-mail-config";
import { sendOrderSmtp, smtpFailureIsRetryable } from "./order-smtp";

export type OrderMailEnv = AccountEnv & OrderMailSettings;

// Explicit opt-in: no account is created and no customer data is sent without configuration.
export async function deliverOrderMail(env: OrderMailEnv) {
  const config = orderSmtpConfig(env);
  if (!config || !env.SUPABASE_SERVICE_ROLE_KEY) return;
  const db = async (rpc: string, body: unknown) => {
    const response = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL || "https://wgshalvkjfefavnbccil.supabase.co"}/rest/v1/rpc/${rpc}`, {
      method: "POST", headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY!, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error("ORDER_MAIL_DB");
    return response.json();
  };
  try {
    // Separate RPC: old migration 008 retries ambiguous sends, which is unsafe without API idempotency.
    const jobs = await db("claim_order_smtp_mail", {}) as { order_id: string; recipient: string; payload: ConfirmedOrder; lease: string }[];
    for (const job of jobs) {
      let accepted = false;
      try {
        const text = orderConfirmation(job.payload);
        const messageId = await sendOrderSmtp(config, {
          id: job.order_id, recipient: job.recipient, text, date: job.payload.paid_at || job.payload.created_at,
          subject: `${job.payload.environment === "sandbox" ? "TEST: " : ""}Potwierdzenie zamowienia Wystawiacz by Tymo`,
        });
        accepted = true;
        await db("finish_order_mail", { p_id: job.order_id, p_lease: job.lease, p_provider_id: messageId });
      } catch (error) {
        // SMTP has no idempotency key. Ambiguous delivery and lost DB acknowledgements need review.
        if (!accepted) {
          try { await db("fail_order_smtp_mail", { p_id: job.order_id, p_lease: job.lease, p_retryable: smtpFailureIsRetryable(error) }); }
          catch { /* Expired leases move to review, never automatic resend. */ }
        }
        const failure = error as { code?: unknown; responseCode?: unknown } | null;
        console.error(JSON.stringify({ event: accepted ? "order_mail_result_unrecorded" : "order_mail_attempt_failed",
          code: typeof failure?.code === "string" && /^[A-Z_]{2,30}$/.test(failure.code) ? failure.code : "UNKNOWN",
          ...(typeof failure?.responseCode === "number" && Number.isInteger(failure.responseCode) ? { smtpStatus: failure.responseCode } : {}),
        }));
      }
    }
  } catch { console.error(JSON.stringify({ event: "order_mail_queue_unavailable" })); }
}
