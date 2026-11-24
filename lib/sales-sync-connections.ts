import { openConnection, sealConnection } from "./allegro-api";
import { ovokoConnectionKey, validateOvokoCredentials, type OvokoKeyEnv } from "./ovoko-connection";
import { ovokoWriteClient, ovokoWriteDigest } from "./ovoko-write-client";
import { OvokoError } from "./ovoko-read";
import { syncRows, type SyncDb } from "./sales-sync-store";
import { accountAccess, type CustomerAccount, type AccountEnv } from "./account-api";
import { validateCompany } from "./account-validation";

export type SalesSyncEnv = AccountEnv & OvokoKeyEnv & {
  SALES_SYNC_ENABLED?: string; OVOKO_TEST_ENABLED?: string; ALLEGRO_CLIENT_ID?: string; ALLEGRO_CLIENT_SECRET?: string;
};
type Connection = { accessToken: string; refreshToken?: string; expiresAt: number; clientId: string; sellerId?: string };
export async function syncAuthorization(db: SyncDb, owner: string, env: AccountEnv = {}) {
  const roles = syncRows<{ owner_id: string }>(await db(`account_admins?owner_id=eq.${owner}&select=owner_id`));
  const accounts = syncRows<CustomerAccount>(await db(`customer_accounts?owner_id=eq.${owner}&select=*`));
  const account = accounts[0], company = account?.company as { customerType?: string; nip?: string } | null;
  let trial = false;
  if (env.TRIAL_ENABLED === "true" && company) {
    if (company.customerType === "person") { try { trial = validateCompany(company).customerType === "person"; } catch { /* Incomplete profiles do not retain a trial. */ } }
    else trial = typeof company.nip === "string" && /^\d{10}$/.test(company.nip) && account.trial_claimed_nip === company.nip;
  }
  if (accounts.length !== 1 || account.suspended !== false || !accountAccess({ ...account, trial_until: trial ? account.trial_until : null }, env.BILLING_ENFORCED === "true", roles.length === 1).allowed) throw new OvokoError(403, "Synchronizacja wstrzymana: konto nie ma aktywnego dostepu.");
}
export async function syncConnections(db: SyncDb, owner: string, env: SalesSyncEnv) {
  await syncAuthorization(db, owner, env);
  const rows = syncRows<{ sealed: string }>(await db(`allegro_connections?owner_id=eq.${owner}&select=sealed`));
  if (rows.length !== 1) throw new OvokoError(409, "Brak polaczenia Allegro.");
  let allegroSealed = rows[0].sealed;
  const key = await ovokoConnectionKey({ ALLEGRO_ENCRYPTION_KEY: env.ALLEGRO_ENCRYPTION_KEY });
  let connection = await openConnection<Connection>(rows[0].sealed, key, owner);
  if (!connection.clientId || connection.clientId !== env.ALLEGRO_CLIENT_ID) throw new OvokoError(409, "Polaczenie aplikacji Allegro zmienilo sie; odnow zgode na automat.");
  if (!Number.isFinite(connection.expiresAt) || connection.expiresAt <= Date.now() + 30000) {
    if (!connection.refreshToken || !env.ALLEGRO_CLIENT_SECRET) throw new OvokoError(409, "Odnow polaczenie Allegro.");
    const response = await fetch("https://allegro.pl/auth/oauth/token", { method: "POST", redirect: "manual", signal: AbortSignal.timeout(15000), headers: { Authorization: `Basic ${btoa(`${connection.clientId}:${env.ALLEGRO_CLIENT_SECRET}`)}`, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: connection.refreshToken }) });
    const token = await response.json() as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown };
    if (!response.ok || typeof token.access_token !== "string" || typeof token.refresh_token !== "string" || typeof token.expires_in !== "number" || !Number.isFinite(token.expires_in) || token.expires_in <= 60) throw new OvokoError(409, "Allegro odrzucilo odnowienie tokenu; odnow polaczenie.");
    connection = { ...connection, accessToken: token.access_token, refreshToken: token.refresh_token, expiresAt: Date.now() + (token.expires_in - 60) * 1000 };
    allegroSealed = await sealConnection(connection, key, owner);
    const updated = syncRows(await db(`allegro_connections?owner_id=eq.${owner}&sealed=eq.${encodeURIComponent(rows[0].sealed)}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ sealed: allegroSealed, updated_at: new Date().toISOString() }) }));
    if (updated.length !== 1) throw new OvokoError(409, "Polaczenie Allegro zmienilo sie podczas odnowienia. Ponowimy sam odczyt.");
  }
  if (typeof connection.accessToken !== "string" || !connection.accessToken) throw new OvokoError(409, "Brak tokenu Allegro.");
  const allegro = async (path: string, init: RequestInit = {}) => {
    if (!path.startsWith("/") || path.startsWith("//") || /[\\\r\n#]/.test(path)) throw new OvokoError(400, "Nieprawidlowa sciezka operacji.");
    const response = await fetch(`https://api.allegro.pl${path}`, { ...init, redirect: "manual", signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${connection.accessToken}`, Accept: "application/vnd.allegro.public.v1+json", ...init.headers } });
    if (!response.ok) { await response.body?.cancel(); throw new OvokoError(502, `Odczyt Allegro HTTP ${response.status}. Automat nie uznal bledu odczytu za sprzedaz.`); }
    return await response.json() as Record<string, unknown>;
  };
  const seller = await allegro("/me");
  if (typeof seller.id !== "string" || !/^\d{1,30}$/.test(seller.id) || connection.sellerId && connection.sellerId !== seller.id) throw new OvokoError(409, "Nie potwierdzono konta sprzedawcy Allegro.");
  const saved = syncRows<{ sealed: string }>(await db(`ovoko_connections?owner_id=eq.${owner}&select=sealed`));
  if (saved.length !== 1) throw new OvokoError(409, "Brak zapisanego polaczenia Ovoko.");
  const credentials = validateOvokoCredentials(await openConnection<Record<string, unknown>>(saved[0].sealed, await ovokoConnectionKey(env), `ovoko:v1:${owner}`));
  return { sellerId: seller.id, clientId: connection.clientId, allegro, ovoko: ovokoWriteClient(credentials),
    account: await ovokoWriteDigest(credentials.username.trim().toLowerCase()), fingerprint: await ovokoWriteDigest(JSON.stringify(credentials)), allegroSealed, ovokoSealed: saved[0].sealed };
}
