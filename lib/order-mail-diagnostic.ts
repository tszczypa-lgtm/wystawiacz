export function orderMailDiagnostic(error: unknown) {
  const value = error as { code?: unknown; responseCode?: unknown; command?: unknown } | null;
  const codes = new Set(["EAUTH", "ECONNECTION", "ESOCKET", "ETIMEDOUT", "EDNS", "ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ECONNRESET", "EPROTOCOL", "EENVELOPE", "EMESSAGE", "ETLS", "CERT_HAS_EXPIRED", "ERR_TLS_CERT_ALTNAME_INVALID", "DEPTH_ZERO_SELF_SIGNED_CERT"]);
  const code = typeof value?.code === "string" && codes.has(value.code) ? value.code : "SMTP_ERROR";
  const smtpStatus = typeof value?.responseCode === "number" && Number.isInteger(value.responseCode) && value.responseCode >= 400 && value.responseCode <= 599 ? value.responseCode : null;
  const command = typeof value?.command === "string" ? value.command : "";
  const stage = command.startsWith("AUTH") ? "AUTH" : ["CONN", "EHLO", "HELO", "STARTTLS", "MAIL FROM", "RCPT TO", "DATA"].includes(command) ? command : "UNKNOWN";
  const hint = code === "EAUTH" || stage === "AUTH" ? "Home.pl odrzucil logowanie. Sprawdz sekret ORDER_SMTP_PASSWORD: to haslo skrzynki biuro@tymogarage.pl, nie panelu home.pl."
    : ["EDNS", "ENOTFOUND", "EAI_AGAIN"].includes(code) ? "Nie udalo sie odczytac adresu serwera SMTP. Sprawdz host i polaczenie z Cloudflare."
    : code.includes("TLS") || code.includes("CERT") ? "Nie udalo sie zweryfikowac szyfrowanego polaczenia SMTP. Nie wylaczaj sprawdzania certyfikatu."
    : "Polaczenie SMTP nie powiodlo sie. Zglos wyswietlony kod; nie ponawiaj platnosci.";
  return { code, smtpStatus, stage, hint };
}
