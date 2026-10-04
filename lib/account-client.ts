import { createSupabaseBrowserClient } from "./supabase";
import type { CompanyDetails } from "./account-validation";

export type AccountInfo = {
  account: { email: string; company: Partial<CompanyDetails>; suspended: boolean; access_mode: string; free_until: string | null; subscription_status: string; paid_until: string | null; cancel_at_period_end: boolean };
  isAdmin: boolean; access: { allowed: boolean; reason: string }; billingEnabled: boolean; billingIssue: boolean;
  price: { amount: number; currency: string; interval: string } | null; hasCustomer: boolean;
};
export async function accountRequest<T>(path: string, method = "GET", payload?: unknown): Promise<T> {
  const { data } = await createSupabaseBrowserClient().auth.getSession();
  if (!data.session) throw new Error("Zaloguj się ponownie.");
  const response = await fetch(`/api/account${path}`, { method, headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" }, body: payload ? JSON.stringify(payload) : undefined, cache: "no-store" });
  const result = await response.json().catch(() => ({})) as T & { message?: string };
  if (!response.ok) throw new Error(result.message || "Nie udało się odczytać konta.");
  return result as T;
}
export function accountDate(value: string | null) { return value ? new Date(value).toLocaleDateString("pl-PL", { timeZone: "Europe/Warsaw" }) : "bezterminowo"; }
