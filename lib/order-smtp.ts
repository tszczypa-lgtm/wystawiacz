import nodemailer from "nodemailer";
import type { orderSmtpConfig } from "./order-mail-config";

export type OrderMessage = { id: string; recipient: string; subject: string; text: string; date: string };

export function smtpFailureIsRetryable(error: unknown) {
  const failure = error as { command?: string; responseCode?: number } | null;
  // A negative SMTP reply means rejection. A disconnect after DATA may instead mean acceptance.
  if (typeof failure?.responseCode === "number" && failure.responseCode >= 400 && failure.responseCode < 600) return true;
  return typeof failure?.command === "string" && /^(?:CONN|EHLO|HELO|STARTTLS|AUTH(?: .*)?|MAIL FROM|RCPT TO)$/.test(failure.command);
}

function orderTransport(config: NonNullable<ReturnType<typeof orderSmtpConfig>>) {
  const senderDomain = config.user.split("@")[1];
  return nodemailer.createTransport({
    host: config.host, port: config.port, secure: true,
    auth: { user: config.user, pass: config.password },
    tls: { servername: config.host, minVersion: "TLSv1.2", rejectUnauthorized: true },
    name: senderDomain, pool: false, logger: false, debug: false,
    connectionTimeout: 8000, greetingTimeout: 5000, socketTimeout: 8000, dnsTimeout: 5000,
    disableFileAccess: true, disableUrlAccess: true,
  });
}

export async function verifyOrderSmtp(config: NonNullable<ReturnType<typeof orderSmtpConfig>>) {
  const transport = orderTransport(config);
  try { await transport.verify(); } finally { transport.close(); }
}

export async function sendOrderSmtp(config: NonNullable<ReturnType<typeof orderSmtpConfig>>, message: OrderMessage) {
  const senderDomain = config.user.split("@")[1];
  const messageId = `<order-confirmation-${message.id}@${senderDomain}>`;
  const transport = orderTransport(config);
  try {
    const result = await transport.sendMail({
      from: { name: "Wystawiacz by Tymo", address: config.user },
      to: [{ address: message.recipient, name: "" }],
      envelope: { from: config.user, to: [message.recipient] },
      messageId, date: new Date(message.date), subject: message.subject, text: message.text,
      attachments: [{ filename: `zamowienie-${message.id}.txt`, content: Buffer.from(message.text), contentType: "text/plain; charset=utf-8" }],
    });
    if (!result.accepted?.length) throw new Error("SMTP_NOT_ACCEPTED");
    return messageId;
  } finally { transport.close(); }
}
