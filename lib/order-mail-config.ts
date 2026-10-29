export type OrderMailSettings = {
  ORDER_MAIL_ENABLED?: string;
  ORDER_SMTP_HOST?: string;
  ORDER_SMTP_USER?: string;
  ORDER_SMTP_PASSWORD?: string;
};

export function orderSmtpConfig(env: OrderMailSettings) {
  const host = env.ORDER_SMTP_HOST || "serwer2684289.hosting-home.pl";
  const user = env.ORDER_SMTP_USER || "biuro@tymogarage.pl";
  if (env.ORDER_MAIL_ENABLED !== "true" || !env.ORDER_SMTP_PASSWORD
    || !/^[a-z0-9-]+\.(?:hosting-home|home)\.pl$/i.test(host)
    || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(user)) return null;
  return { host, port: 465, secure: true as const, user, password: env.ORDER_SMTP_PASSWORD };
}
