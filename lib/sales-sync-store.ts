import type { AccountEnv } from "./account-api";
import { OvokoError } from "./ovoko-read";

export type SyncDb = (path: string, init?: RequestInit) => Promise<unknown>;
export type SyncSubscription = {
  owner_id: string; epoch: string; enabled: boolean; seller_id: string; ovoko_account: string;
  fingerprint: string; client_id: string; armed_at: string; cursor: string | null; caught_up: boolean;
  lease: string | null; lease_until: string | null; last_checked_at: string | null; last_error: string | null;
};
export type SyncAction = {
  id: string; owner_id: string; epoch: string; seller_id: string; offer_id: string; part_id: string;
  publication_hash: string; item_id: string; order_id: string | null; bought_at: string; state: string;
};
export const syncRows = <T>(value: unknown): T[] => {
  if (!Array.isArray(value)) throw new OvokoError(503, "Nie potwierdzono rejestru automatu. Sprawdz migracje 016.");
  return value as T[];
};
const databaseReasons = ["physical account ownership conflict", "link recovery pending", "synchronization check in progress", "pending sale action for this offer", "connection changed", "operation too recent", "operation changed", "no stale attempt to release", "pause synchronization and settle writes", "conflicting part ids", "vehicle operation in progress"] as const;
export class SyncDbError extends OvokoError {
  constructor(public databaseStatus: number, public databaseCode?: string, public databaseReason?: string) {
    super(503, "Nie potwierdzono rejestru automatu. Sprawdz migracje 016; nie ponawiamy niepewnych zapisow.");
  }
}
export function salesSyncDb(env: AccountEnv): SyncDb {
  return async (path, init = {}) => {
    if (!env.SUPABASE_SERVICE_ROLE_KEY) throw new OvokoError(503, "Brak konfiguracji bazy automatu.");
    const response = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL || "https://wgshalvkjfefavnbccil.supabase.co"}/rest/v1/${path}`, {
      ...init, redirect: "manual", signal: AbortSignal.timeout(15000), headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json", ...init.headers },
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { code?: unknown; message?: unknown } | null;
      const code = typeof body?.code === "string" && /^(?:[A-Z0-9]{5}|PGRST\d{3})$/.test(body.code) ? body.code : undefined;
      const reason = databaseReasons.find(value => body?.message === value);
      throw new SyncDbError(response.status, code, reason);
    }
    return response.status === 204 ? null : response.json();
  };
}
export const syncJson = (value: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(value) });
